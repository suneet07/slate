# AI Whiteboard for Teachers — Project Plan

## The Core Idea
An interactive classroom whiteboard where the teacher writes and draws naturally with a stylus, and an AI can add diagrams, pull up notes, and respond to voice commands — all rendered live on the board.

The teacher presses a button, speaks a request (e.g. "let's look at a circle"), and the relevant diagram or note appears on the board. The AI also understands what the teacher has already written by hand.

## The Key Architectural Decision: No Screenshots
The board is **not** interpreted by taking screenshots and sending images to an AI. Instead, everything on the board lives as **structured data — a scene graph**.

- Every shape is stored as coordinates and properties (e.g. a circle = center point + radius).
- The AI **reads** this structured state directly and **writes back** new shapes as coordinates.
- This is far lighter and more precise than image interpretation — the model never has to guess what a blurry shape is; it knows exactly what's there.

## Hybrid Board: AI + Human Input
Two kinds of content live side by side as coordinate data:

1. **AI-generated objects** — the AI knows these perfectly, since it created them.
2. **Teacher's own pen strokes** — captured at the input layer as **vector strokes** (pen paths with coordinates, timing, and pressure), not pixels.

Because teachers use a **stylus/pen** on a touch display, the input is naturally vector-based. Handwriting recognition runs on these clean stroke paths — much lighter than image interpretation.

The AI polls/reads the board periodically so it stays aware of what the teacher is writing. (Polling rate still to be decided.)

## Functionality
- Draw diagrams on demand via button + voice trigger.
- Pull relevant paragraphs/notes onto the board on request.
- Understand and respond to what's already on the board.

## Tech Stack

### Canvas Layer
- **Custom engine** (`src/engine/`) — a dependency-free canvas whiteboard written for this project. tldraw was the original choice but is proprietary (paid in production) and its scene graph is shaped for humans, not models: opaque uuids, pixel coordinates, deeply nested props.
- The replacement is built around what a model is good at: a spreadsheet grid (`C3`, `4x2`), short shape names (`box1`), layout verbs instead of coordinate math, and arrows that bind to shapes by name.
- Stylus pressure is captured natively; strokes are stored as vector points, never pixels.
- See `README.md` for the design rationale and `shared/board-commands.md` for the AI-facing contract.

### AI — Two Different Jobs
The work splits into two parts with very different needs:

1. **Handwriting recognition (stroke → text)** — genuinely light. Runs well **locally**, no heavy model required.
2. **Reasoning (understand intent, decide what to draw and where)** — needs a properly capable model. A small local model would misplace things and misunderstand intent.

### Recommended Approach: Hybrid
- Light stuff (handwriting recognition) → **local**.
- Reasoning → **API / free-tier model**. Since the board is compact coordinate data (not images), these calls are cheap and fast.

### Free Models for Reasoning
Both providers are wired up and chained, so a spent allowance is not a stopped lesson:
- **Llama 3.3 70B on Groq** (free tier) — first choice. Comfortably reads structured coordinates and returns structured coordinates.
- **NVIDIA NIM** — `meta/llama-3.3-70b-instruct`, `nvidia/llama-3.1-nemotron-70b-instruct` and others, used automatically once Groq's daily cap is hit.
- **Llama 3.1 8B on Groq** — last resort. Keeps the board responsive but the output is noticeably cruder.
- The task isn't heavy multi-step logic — it's "read structured coordinates, return structured coordinates." Success depends more on **tight prompt + clean scene data structure** than raw model power.

Measured limits: the full instruction set is ~7k tokens per call, so Groq's free 100k tokens/day is about a dozen requests. The backend trims the instructions per request and falls through the chain on `429`.

## Status

Done:
- Custom canvas engine, scene graph, renderer, pen/shape/text tools, undo, autosave.
- Scene data structure for the model: grid cell refs, named shapes, text digest (`src/ai/serialize.ts`).
- Command language + validating executor with a self-repair round trip (`src/ai/commands.ts`, `shared/board-commands.md`).
- FastAPI backend with a failover chain across Groq and NVIDIA NIM: rate-limit cooldowns parsed from the provider's own message, oversize prompts retried compact, verified end to end.
- Voice trigger via the browser's speech recognition (Chrome/Edge).

## Open Questions / Next Steps
- Choose the local handwriting recognition approach — `ink` shapes already carry a `recognized` field and the digest reports it; nothing writes to it yet.
- Decide the polling rate for reading the teacher's live handwriting.
- Decide whether voice should stay browser-native or move to a local speech model.