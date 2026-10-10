"""
Reasoning backend for the AI whiteboard.

The model never sees pixels and never sees the scene graph as JSON. It sees a
compact text digest of the board and answers with a flat list of whiteboard
commands, documented in ../shared/*.md — the same files the frontend shows the
teacher. Keeping the contract in one place is what makes the whole thing
workable with small, cheap models.

Which model answers is decided by providers.py, which walks an ordered chain
across Groq and NVIDIA and steps down it as free-tier allowances run out.
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from providers import ROUTING, ModelRouter

load_dotenv()

# One router for the process: it remembers which models are resting, so the
# cooldown a provider hands back on request 12 is still respected on request 13.
router = ModelRouter()

SPEC_DIR = Path(__file__).resolve().parent.parent / "shared"

# Order matters: the contract, then how to place things, then how to read what
# is already there, then worked examples, then the mistake list last so it is
# the freshest thing in the model's context.
SPEC_FILES = [
    "board-commands.md",
    "board-coordinates.md",
    "board-reading.md",
    "board-drawing.md",
    "board-mistakes.md",
    "board-nano.md",
]

# The full reference is ~26k characters — roughly 7k tokens on every call,
# which exhausts a free-tier daily allowance in about a dozen requests.
#   auto (default) — send only the sections this request needs (~15-27k chars)
#   core           — commands + mistakes only (~10k chars), cheapest
#   nano           — ultra-compressed single file (~3k chars) for small models
#   full           — everything, every time
SPEC_MODE = os.getenv("WHITEBOARD_SPEC", "auto").lower()

ALWAYS = {"board-commands.md", "board-coordinates.md", "board-mistakes.md"}

QUESTION_RE = re.compile(
    r"^\s*(what|which|who|where|when|why|how|is|are|does|do|can|could|should|tell me|describe|explain)\b",
    re.IGNORECASE,
)

app = FastAPI(title="AI Whiteboard reasoning")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def read_doc(name: str) -> str:
    try:
        return (SPEC_DIR / name).read_text(encoding="utf-8")
    except OSError:
        return ""


DOCS = {name: read_doc(name) for name in SPEC_FILES}


def is_question(prompt: str) -> bool:
    return prompt.strip().endswith("?") or bool(QUESTION_RE.match(prompt))


def choose_docs(prompt: str, board: str, compact: bool = False) -> List[str]:
    """Which reference sections this request actually needs."""
    if SPEC_MODE == "nano":
        return ["board-nano.md"]
    # A model that rejected the full prompt for size gets the short version.
    if compact or SPEC_MODE == "core":
        return ["board-commands.md", "board-mistakes.md"]
    if SPEC_MODE == "full":
        return SPEC_FILES
    chosen = [n for n in SPEC_FILES if n in ALWAYS]
    # How to read pen strokes only matters when there are pen strokes — but
    # writing counts as pen strokes, and it is the half that needs the most
    # explaining, since the reading arrives hedged with alternatives.
    if "DRAWING" in board or "HANDWRITING" in board:
        chosen.append("board-reading.md")
    # Worked examples only matter when something is going to be drawn.
    if not is_question(prompt):
        chosen.append("board-drawing.md")
    return [n for n in SPEC_FILES if n in chosen]


def build_system_prompt(prompt: str, board: str, compact: bool = False) -> str:
    names = choose_docs(prompt, board, compact)
    body = "\n\n---\n\n".join(DOCS[n] for n in names if DOCS.get(n))
    if not body:
        body = 'Return {"commands": []}.'
    return (
        "You are the drawing engine behind a classroom whiteboard.\n"
        "A teacher speaks or types a request. You answer ONLY with a JSON object of the\n"
        'form {"commands": [...]} using the command language below.\n'
        "You never explain yourself, never use markdown fences, and never invent fields.\n\n"
        + body
    )


class Repair(BaseModel):
    previous: List[Dict[str, Any]] = []
    errors: List[str] = []


class ReasonRequest(BaseModel):
    prompt: str
    board: str = ""
    repair: Optional[Repair] = None


class ReasonResponse(BaseModel):
    commands: List[Dict[str, Any]] = []
    error: Optional[str] = None
    raw: Optional[str] = None
    """Which slot answered, e.g. "nvidia:meta/llama-3.3-70b-instruct"."""
    model: Optional[str] = None
    """Slots that were skipped or exhausted on the way to an answer."""
    routing: List[str] = []
    usage: Optional[Dict[str, Any]] = None


def build_human_message(req: ReasonRequest) -> str:
    parts = [
        "Current board:",
        req.board or "EMPTY — no shapes yet.",
        "",
        f"Teacher's request: {req.prompt}",
    ]
    if req.repair and req.repair.errors:
        # Second pass: show the model exactly what it got wrong. Small models
        # correct themselves reliably when the error names the offending field.
        parts += [
            "",
            "Your previous answer was rejected. These commands failed:",
            json.dumps(req.repair.previous, ensure_ascii=False),
            "Errors:",
            "\n".join(f"- {e}" for e in req.repair.errors),
            "",
            "Return a corrected {\"commands\": [...]} that fixes ONLY the failures.",
            "Commands that already succeeded have been applied — do not repeat them.",
        ]
    return "\n".join(parts)


def extract_json(text: str) -> Optional[Dict[str, Any]]:
    """Pull a JSON object out of a model reply, fences and preamble included."""
    cleaned = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Fall back to the first balanced {...} span in the reply.
    start = cleaned.find("{")
    while start != -1:
        depth = 0
        for i in range(start, len(cleaned)):
            if cleaned[i] == "{":
                depth += 1
            elif cleaned[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(cleaned[start : i + 1])
                    except json.JSONDecodeError:
                        break
        start = cleaned.find("{", start + 1)
    return None


def normalize(payload: Any) -> List[Dict[str, Any]]:
    """Accept the shapes a model actually produces, not just the ideal one."""
    if payload is None:
        return []
    if isinstance(payload, list):
        commands = payload
    elif isinstance(payload, dict):
        commands = payload.get("commands")
        if commands is None:
            # A lone command object is a common slip; wrap it.
            commands = [payload] if "op" in payload else []
    else:
        return []

    out: List[Dict[str, Any]] = []
    for cmd in commands:
        if not isinstance(cmd, dict):
            continue
        # Some models emit "action"/"command" instead of "op".
        if "op" not in cmd:
            for alias in ("action", "command", "type"):
                if alias in cmd:
                    cmd["op"] = cmd.pop(alias)
                    break
        if "op" in cmd:
            out.append(cmd)
    return out


@app.get("/api/health")
async def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "routing": ROUTING,
        "models": router.status(),
        "spec_mode": SPEC_MODE,
        "spec_files": {n: len(DOCS.get(n, "")) for n in SPEC_FILES},
    }


@app.post("/api/reason", response_model=ReasonResponse)
async def reason(request: ReasonRequest) -> ReasonResponse:
    human = build_human_message(request)

    def messages_for(_slot: Any, compact: bool) -> List[Dict[str, Any]]:
        return [
            {
                "role": "system",
                "content": build_system_prompt(request.prompt, request.board, compact),
            },
            {"role": "user", "content": human},
        ]

    try:
        text, model, notes, usage = await run_in_threadpool(router.complete, messages_for)
    except RuntimeError as exc:
        return ReasonResponse(error=str(exc))

    payload = extract_json(text)
    commands = normalize(payload)

    if not commands and payload is None:
        return ReasonResponse(
            error=f"{model} did not return JSON",
            raw=text[:500],
            model=model,
            routing=notes,
            usage=usage,
        )

    return ReasonResponse(commands=commands, raw=text[:2000], model=model, routing=notes, usage=usage)
