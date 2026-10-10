"""
Router tests — no network, no keys, no API calls.

Run with:  .venv/Scripts/python -m pytest test_providers.py -q
       or: .venv/Scripts/python test_providers.py
"""

import os
import time

os.environ.setdefault("GROQ_API_KEY", "test-groq")
os.environ.setdefault("NVIDIA_API_KEY", "test-nvidia")

import providers as P  # noqa: E402

failures = []


def check(label, condition, detail=None):
    if condition:
        print(f"  ok   {label}")
    else:
        failures.append(label)
        print(f"  FAIL {label}   {detail if detail is not None else ''}")


def chain(*labels):
    return P.parse_chain(",".join(labels))


class FakeRouter(P.ModelRouter):
    """Router with the HTTP call replaced by a scripted response per slot."""

    def __init__(self, slots, script):
        super().__init__(slots)
        self.script = script          # label -> list of outcomes
        self.tried = []
        self.sent = []

    def _call(self, slot, messages, temperature, max_tokens):
        self.tried.append(slot.label)
        self.sent.append(messages)
        outcomes = self.script.get(slot.label, ["ok"])
        outcome = outcomes.pop(0) if outcomes else "ok"
        if outcome == "ok":
            return f"reply from {slot.label}"
        raise outcome


# ------------------------------------------------------------------- parsing

print("chain parsing")
slots = chain("groq:llama-3.3-70b-versatile", "nvidia:meta/llama-3.3-70b-instruct")
check("parses provider:model pairs", [s.label for s in slots] == [
    "groq:llama-3.3-70b-versatile",
    "nvidia:meta/llama-3.3-70b-instruct",
])
check("nvidia model ids keep their slash", slots[1].model == "meta/llama-3.3-70b-instruct")
check("unknown provider is dropped", len(chain("groq:a", "wat:b", "nvidia:c")) == 2)
check("empty config falls back to the default chain", len(P.parse_chain("")) == len(P.DEFAULT_CHAIN))
check("every default slot names a known provider",
      all(s.provider.id in P.PROVIDERS for s in P.parse_chain("")))

# ------------------------------------------------------------ retry parsing

print("retry-after parsing")
check("reads Groq's 'try again in 56m29.472s'",
      abs(P.parse_retry_after({}, "Please try again in 56m29.472s") - 3389.472) < 0.01,
      P.parse_retry_after({}, "Please try again in 56m29.472s"))
check("reads a bare seconds form",
      abs(P.parse_retry_after({}, "try again in 1.5s") - 1.5) < 0.01)
check("reads an hours form",
      abs(P.parse_retry_after({}, "try again in 2h30m0s") - 9000) < 0.01)
check("prefers the Retry-After header", P.parse_retry_after({"retry-after": "42"}, "") == 42)
check("no hint means no number", P.parse_retry_after({}, "something else broke") is None)

# ---------------------------------------------------------------- failover

print("failover")
slots = chain("groq:a", "nvidia:b", "nvidia:c")
router = FakeRouter(slots, {"groq:a": [P._SlotExhausted("rate limited", 900)]})
text, model, notes = router.complete([{"role": "user", "content": "hi"}])
check("falls through to the next provider", model == "nvidia:b", model)
check("exhausted slot is reported", any("groq:a" in n for n in notes), notes)
check("the answer comes from the slot that replied", text.endswith("nvidia:b"))
check("a rate-limited slot is put to rest", router.state["groq:a"].resting)
check("cooldown length comes from the provider",
      850 < router.state["groq:a"].rest_seconds <= 900, router.state["groq:a"].rest_seconds)

print("cooldown is remembered")
router2 = FakeRouter(chain("groq:a", "nvidia:b"), {"groq:a": [P._SlotExhausted("rate limited", 900)]})
router2.complete([{"role": "user", "content": "1"}])
router2.tried.clear()
_, model2, _ = router2.complete([{"role": "user", "content": "2"}])
check("a resting slot is not tried again", "groq:a" not in router2.tried, router2.tried)
check("the next request goes straight to the fallback", model2 == "nvidia:b")

print("recovery")
router3 = FakeRouter(chain("groq:a", "nvidia:b"), {"groq:a": [P._SlotExhausted("blip", 900)]})
router3.complete([{"role": "user", "content": "1"}])
router3.state["groq:a"].cooldown_until = time.time() - 1  # cooldown expires
_, model3, _ = router3.complete([{"role": "user", "content": "2"}])
check("the preferred model is used again once rested", model3 == "groq:a", model3)
check("a success clears the cooldown", not router3.state["groq:a"].resting)

print("everything exhausted")
# Within one request every slot is tried once; if they all fail, say so.
router4 = FakeRouter(
    chain("groq:a", "nvidia:b"),
    {
        "groq:a": [P._SlotExhausted("rate limited", 900)],
        "nvidia:b": [P._SlotExhausted("rate limited", 900)],
    },
)
try:
    router4.complete([{"role": "user", "content": "1"}])
    check("a fully exhausted chain raises", False)
except RuntimeError as exc:
    check("a fully exhausted chain raises", True)
    check("every slot was tried before giving up",
          router4.tried == ["groq:a", "nvidia:b"], router4.tried)
    check("the error names what went wrong", "rate limited" in str(exc), str(exc))

# The next request must still try, even though both are resting — a stale
# cooldown must never turn into a permanently dead board.
router4.tried.clear()
router4.script = {"groq:a": [P._SlotExhausted("still limited", 900)], "nvidia:b": ["ok"]}
_, model4, notes4 = router4.complete([{"role": "user", "content": "2"}])
check("resting slots are still attempted next time", model4 == "nvidia:b", model4)
check("soonest-free slot is tried first", router4.tried[0] == "groq:a", router4.tried)
check("the wait is reported to the caller", any("resting" in n for n in notes4), notes4)

# ------------------------------------------------------ oversize prompts

print("prompt too large")
# A small model rejecting the full reference should get one more go with the
# short one, not be written off.
router9 = FakeRouter(
    chain("groq:small", "nvidia:b"),
    {"groq:small": [P._SlotExhausted("too large", 300, oversize=True)]},
)
_, model9, notes9 = router9.complete(
    lambda slot, compact: [{"role": "system", "content": "SHORT" if compact else "LONG"}]
)
check("the same slot is retried after a size refusal", model9 == "groq:small", model9)
check("the retry carries the compact prompt",
      router9.sent[0][0]["content"] == "LONG" and router9.sent[1][0]["content"] == "SHORT",
      [m[0]["content"] for m in router9.sent])
check("the fallback was never needed", "nvidia:b" not in router9.tried, router9.tried)
check("the compact retry is reported", any("compact" in n for n in notes9), notes9)

router10 = FakeRouter(
    chain("groq:small", "nvidia:b"),
    {"groq:small": [P._SlotExhausted("too large", 300, oversize=True),
                    P._SlotExhausted("too large", 300, oversize=True)]},
)
_, model10, _ = router10.complete(lambda slot, compact: [{"role": "system", "content": "x"}])
check("still too large means move on", model10 == "nvidia:b", model10)
check("the oversize slot is not retried a third time",
      router10.tried.count("groq:small") == 2, router10.tried)

# ---------------------------------------------------------------- key gating

print("missing keys")
saved = os.environ.pop("NVIDIA_API_KEY")
try:
    router6 = FakeRouter(chain("nvidia:b", "groq:a"), {})
    _, model6, _ = router6.complete([{"role": "user", "content": "1"}])
    check("a slot with no key is skipped", model6 == "groq:a", model6)

    os.environ.pop("GROQ_API_KEY")
    router7 = FakeRouter(chain("nvidia:b", "groq:a"), {})
    try:
        router7.complete([{"role": "user", "content": "1"}])
        check("no keys at all raises", False)
    except RuntimeError as exc:
        check("no keys at all raises", True)
        check("the error says which keys to set",
              "GROQ_API_KEY" in str(exc) and "NVIDIA_API_KEY" in str(exc), str(exc))
finally:
    os.environ["NVIDIA_API_KEY"] = saved
    os.environ["GROQ_API_KEY"] = "test-groq"

# ------------------------------------------------------------------- status

print("status")
router8 = FakeRouter(chain("groq:a", "nvidia:b"), {"groq:a": [P._SlotExhausted("rate limited", 900)]})
router8.complete([{"role": "user", "content": "1"}])
status = {row["model"]: row for row in router8.status()}
check("status reports the rest time", status["groq:a"]["resting_for"] > 0)
check("status reports the reason", "rate limited" in status["groq:a"]["reason"])
check("status counts successful calls", status["nvidia:b"]["calls"] == 1)
check("status never leaks a key", all("key" not in str(v).lower() or k == "key_env" or k == "key_present"
                                      for row in router8.status() for k, v in row.items()))

print("\nAll checks passed." if not failures else f"\n{len(failures)} check(s) failed.")
raise SystemExit(1 if failures else 0)
