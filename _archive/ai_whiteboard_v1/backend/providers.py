"""
Model routing across providers.

Free tiers run out. Groq's is a daily token cap, NVIDIA's is a request rate —
either way a lesson should not stop because one allowance is spent. So the
backend holds an ordered list of model slots and moves down it whenever one is
exhausted, putting the spent slot on a cooldown parsed from the provider's own
"try again in ..." message.

Every provider here speaks the OpenAI chat-completions dialect, so one HTTP
client serves all of them. Adding a provider is three lines in PROVIDERS.

Keys live in backend/.env and nowhere else:

    GROQ_API_KEY=...
    NVIDIA_API_KEY=...

A slot whose key is missing is skipped, so you can run on either provider alone.
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import httpx


@dataclass(frozen=True)
class Provider:
    id: str
    base_url: str
    key_env: str
    docs: str


PROVIDERS: Dict[str, Provider] = {
    "groq": Provider(
        id="groq",
        base_url="https://api.groq.com/openai/v1",
        key_env="GROQ_API_KEY",
        docs="https://console.groq.com/keys",
    ),
    "nvidia": Provider(
        id="nvidia",
        base_url="https://integrate.api.nvidia.com/v1",
        key_env="NVIDIA_API_KEY",
        docs="https://build.nvidia.com/",
    ),
    "colab": Provider(
        id="colab",
        base_url="",  # Base URL is loaded dynamically from env to support ephemeral ngrok URLs
        key_env="COLAB_API_KEY", # Usually not needed for localtunnel/ngrok, but good for standardization
        docs="https://colab.research.google.com/",
    ),
    "gemini": Provider(
        id="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        key_env="GEMINI_API_KEY",
        docs="https://aistudio.google.com/app/apikey",
    ),
    "agy": Provider(
        id="agy",
        base_url="local",
        key_env="",
        docs="Antigravity CLI",
    ),
}

# Ordered best-first. Override with WHITEBOARD_MODELS, comma separated,
# each entry "provider:model".
#
# Every NVIDIA id here was probed against the live endpoint and returns clean
# JSON in `content`. Ones deliberately left out, and why:
#   meta/llama-3.3-70b-instruct              read timeout at 120s
#   nvidia/llama-3.1-nemotron-70b-instruct   404, listed but not enabled
#   mistralai/mistral-large-2-instruct       404, not enabled
#   *-nemotron-super-49b-v1.5, *-nano-9b-v2  reasoning models: they answer in
#     `reasoning_content` and spend the reply thinking aloud, which is wasted
#     latency for a task that is pure structured output.
DEFAULT_CHAIN = [
    "groq:llama-3.3-70b-versatile",
    "nvidia:nvidia/nemotron-3-super-120b-a12b",
    "nvidia:meta/llama-3.1-70b-instruct",
    "nvidia:nvidia/nemotron-3-nano-30b-a3b",
    "groq:llama-3.1-8b-instant",
]

# failover   — always start at the top of the chain, walk down on exhaustion
# round_robin — start one slot further along each request, spreading the load
ROUTING = os.getenv("WHITEBOARD_ROUTING", "failover").lower()

REQUEST_TIMEOUT = float(os.getenv("WHITEBOARD_TIMEOUT", "60"))

# How long a slot rests when the provider does not say.
DEFAULT_COOLDOWN = 300.0
RATE_LIMIT_COOLDOWN = 900.0
# A rejected key is not going to start working in a minute.
AUTH_COOLDOWN = 3600.0
MAX_COOLDOWN = 24 * 3600.0


@dataclass
class Slot:
    provider: Provider
    model: str

    @property
    def label(self) -> str:
        return f"{self.provider.id}:{self.model}"

    @property
    def key(self) -> Optional[str]:
        return os.getenv(self.provider.key_env) or None

    @property
    def usable(self) -> bool:
        if self.provider.id == "colab":
            return bool(os.getenv("COLAB_BASE_URL"))
        if self.provider.id == "agy":
            return True
        return bool(self.key)


@dataclass
class SlotState:
    cooldown_until: float = 0.0
    reason: str = ""
    calls: int = 0
    failures: int = 0

    @property
    def resting(self) -> bool:
        return time.time() < self.cooldown_until

    @property
    def rest_seconds(self) -> int:
        return max(0, int(self.cooldown_until - time.time()))


def parse_chain(raw: Optional[str]) -> List[Slot]:
    entries = [e.strip() for e in (raw or "").split(",") if e.strip()] or DEFAULT_CHAIN
    slots: List[Slot] = []
    for entry in entries:
        provider_id, _, model = entry.partition(":")
        provider = PROVIDERS.get(provider_id.strip().lower())
        if not provider or not model.strip():
            continue
        slots.append(Slot(provider=provider, model=model.strip()))
    return slots


# "Please try again in 56m29.472s" / "try again in 1.5s"
RETRY_RE = re.compile(
    r"try again in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?",
    re.IGNORECASE,
)


def parse_retry_after(headers: Any, body: str) -> Optional[float]:
    """Seconds until the provider says it will accept work again."""
    header = None
    try:
        header = headers.get("retry-after")
    except Exception:
        header = None
    if header:
        try:
            return min(MAX_COOLDOWN, float(header))
        except ValueError:
            pass

    match = RETRY_RE.search(body or "")
    if match and any(match.groups()):
        hours = float(match.group(1) or 0)
        minutes = float(match.group(2) or 0)
        seconds = float(match.group(3) or 0)
        total = hours * 3600 + minutes * 60 + seconds
        if total > 0:
            return min(MAX_COOLDOWN, total)
    return None


class ModelRouter:
    def __init__(self, chain: Optional[List[Slot]] = None) -> None:
        self.slots: List[Slot] = chain if chain is not None else parse_chain(
            os.getenv("WHITEBOARD_MODELS")
        )
        self.state: Dict[str, SlotState] = {s.label: SlotState() for s in self.slots}
        self._cursor = 0

    # ------------------------------------------------------------- ordering

    def _ordered(self) -> List[Slot]:
        usable = [s for s in self.slots if s.usable]
        if ROUTING == "round_robin" and usable:
            start = self._cursor % len(usable)
            self._cursor += 1
            usable = usable[start:] + usable[:start]
        return usable

    def candidates(self) -> List[Slot]:
        """Ready slots first; resting ones last, soonest-free first, as a
        last resort — a stale cooldown must never mean no answer at all."""
        ordered = self._ordered()
        ready = [s for s in ordered if not self.state[s.label].resting]
        resting = sorted(
            (s for s in ordered if self.state[s.label].resting),
            key=lambda s: self.state[s.label].cooldown_until,
        )
        return ready + resting

    def rest(self, slot: Slot, seconds: float, reason: str) -> None:
        st = self.state[slot.label]
        st.cooldown_until = time.time() + max(1.0, min(MAX_COOLDOWN, seconds))
        st.reason = reason
        st.failures += 1

    # ---------------------------------------------------------------- calls

    def complete(
        self,
        messages: Any,
        temperature: float = 0.0,
        max_tokens: int = 2048,
    ) -> Tuple[str, str, List[str], Optional[Dict[str, int]]]:
        """
        Returns (reply text, slot label that answered, notes about what was
        skipped, usage dictionary). Raises RuntimeError only when every slot has been tried.

        `messages` is either a message list, or a callable `(slot, compact) ->
        messages`. The callable form lets the caller shrink the prompt for a
        model with a smaller per-request limit — small free models routinely
        reject a full-size system prompt with HTTP 413.
        """
        build = messages if callable(messages) else (lambda _slot, _compact: messages)

        notes: List[str] = []
        slots = self.candidates()
        if not slots:
            missing = sorted({s.provider.key_env for s in self.slots})
            raise RuntimeError(
                "No usable model. Set one of " + ", ".join(missing) + " in backend/.env"
            )

        for slot in slots:
            st = self.state[slot.label]
            if st.resting:
                notes.append(f"{slot.label} resting {st.rest_seconds}s ({st.reason})")

            for compact in (False, True):
                try:
                    text, usage = self._call(slot, build(slot, compact), temperature, max_tokens)
                except _SlotExhausted as exc:
                    if exc.oversize and not compact:
                        # Same model, shorter prompt — worth one more try before
                        # writing the slot off.
                        notes.append(f"{slot.label}: prompt too large, retrying compact")
                        continue
                    self.rest(slot, exc.cooldown, exc.reason)
                    notes.append(f"{slot.label}: {exc.reason}")
                    break
                st.calls += 1
                st.cooldown_until = 0.0
                st.reason = ""
                if compact:
                    notes.append(f"{slot.label} answered with the compact reference")
                return text, slot.label, notes, usage

        raise RuntimeError("every model failed — " + "; ".join(notes))

    def _call(
        self,
        slot: Slot,
        messages: List[Dict[str, Any]],
        temperature: float,
        max_tokens: int,
    ) -> Tuple[str, Optional[Dict[str, int]]]:
        if slot.provider.id == "agy":
            import subprocess
            import json
            
            prompt = ""
            for m in messages:
                prompt += f"[{m['role'].upper()}]\n"
                prompt += str(m['content']) + "\n\n"
            prompt += "Respond ONLY with valid JSON. Do not use markdown blocks."
            cmd = ["agy", "--dangerously-skip-permissions", "--output-format", "stream-json"]
            if slot.model and slot.model != "agy":
                cmd.extend(["--model", slot.model, "--effort", "medium"])
            try:
                result = subprocess.run(
                    cmd,
                    input=prompt,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=REQUEST_TIMEOUT,
                    check=False
                )
            except subprocess.TimeoutExpired:
                raise _SlotExhausted("agy timed out", DEFAULT_COOLDOWN)
            except FileNotFoundError:
                raise _SlotExhausted("agy CLI not found", MAX_COOLDOWN)
            if result.returncode != 0:
                raise _SlotExhausted(f"agy error {result.returncode}: {result.stderr[:100]}", DEFAULT_COOLDOWN)
            if not result.stdout.strip():
                raise _SlotExhausted("agy returned empty response", DEFAULT_COOLDOWN)
            
            final_text = ""
            final_usage = None
            for line in result.stdout.strip().splitlines():
                if not line.strip(): continue
                try:
                    obj = json.loads(line)
                    if obj.get("event") == "result":
                        final_text = obj["result"].get("response", "")
                        u = obj["result"].get("usage", {})
                        if u:
                            final_usage = {
                                "prompt_tokens": u.get("input_tokens", 0),
                                "completion_tokens": u.get("output_tokens", 0),
                                "total_tokens": u.get("total_tokens", 0)
                            }
                except Exception:
                    pass

            if not final_text.strip():
                raise _SlotExhausted("agy returned empty response", DEFAULT_COOLDOWN)
                
            return final_text.strip(), final_usage

        base_url = slot.provider.base_url
        if slot.provider.id == "colab":
            base_url = os.getenv("COLAB_BASE_URL", "").rstrip("/")
            if not base_url:
                raise _SlotExhausted("COLAB_BASE_URL not set in .env", MAX_COOLDOWN)
        
        url = f"{base_url}/chat/completions"
        payload: Dict[str, Any] = {
            "model": slot.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {slot.key}",
            "Content-Type": "application/json",
        }

        try:
            response = httpx.post(
                url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT
            )
        except httpx.TimeoutException:
            raise _SlotExhausted("timed out", DEFAULT_COOLDOWN)
        except httpx.HTTPError as exc:
            raise _SlotExhausted(f"unreachable ({type(exc).__name__})", DEFAULT_COOLDOWN)

        if response.status_code == 200:
            try:
                data = response.json()
                message = data["choices"][0]["message"]
                usage = data.get("usage")
            except Exception as exc:
                raise _SlotExhausted(f"unreadable reply ({exc})", DEFAULT_COOLDOWN)
            # Reasoning models leave `content` null and put everything in
            # `reasoning_content`. Take it — there may be usable JSON at the end
            # of the thinking — but do not pretend an empty reply is an answer.
            text = message.get("content") or message.get("reasoning_content") or ""
            if not str(text).strip():
                raise _SlotExhausted("empty reply", DEFAULT_COOLDOWN)
            return str(text), usage

        body = response.text[:400]
        if response.status_code == 429:
            wait = parse_retry_after(response.headers, body) or RATE_LIMIT_COOLDOWN
            raise _SlotExhausted(f"rate limited, resting {int(wait)}s", wait)
        if response.status_code in (401, 403):
            raise _SlotExhausted(
                f"key rejected ({slot.provider.key_env})", AUTH_COOLDOWN
            )
        if response.status_code == 404:
            # Wrong model id for this provider — no point retrying it today.
            raise _SlotExhausted(f"model not found on {slot.provider.id}", MAX_COOLDOWN)
        if response.status_code in (413, 422) or "too large" in body.lower():
            raise _SlotExhausted(
                "request too large for this model", DEFAULT_COOLDOWN, oversize=True
            )
        if response.status_code >= 500:
            raise _SlotExhausted(f"provider error {response.status_code}", DEFAULT_COOLDOWN)
        raise _SlotExhausted(f"http {response.status_code}: {body[:120]}", DEFAULT_COOLDOWN)

    # --------------------------------------------------------------- status

    def status(self) -> List[Dict[str, Any]]:
        out = []
        for slot in self.slots:
            st = self.state[slot.label]
            out.append(
                {
                    "model": slot.label,
                    "key_env": slot.provider.key_env,
                    "key_present": slot.usable,
                    "resting_for": st.rest_seconds,
                    "reason": st.reason,
                    "calls": st.calls,
                    "failures": st.failures,
                }
            )
        return out


@dataclass
class _SlotExhausted(Exception):
    reason: str
    cooldown: float = DEFAULT_COOLDOWN
    """True when the model refused the size of the request, not the request
    itself — worth retrying the same slot with a shorter prompt."""
    oversize: bool = False
    args: tuple = field(default=(), init=False, repr=False)

    def __str__(self) -> str:  # pragma: no cover - debugging aid
        return self.reason
