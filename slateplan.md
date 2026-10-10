# Slate

**An AI-native whiteboard for teaching.**

A board that the model can read and write as structured objects rather than pixels — so a teacher can speak a request mid-lecture and have a correct diagram appear, drawn from their own notes.

**Scope: personal portfolio project.** Not a Starhane product. Optimized for a working demo and a README that explains a non-obvious architectural choice, not for distribution, procurement, or scale. Target: 4–6 weeks of evenings. Anything longer dies half-finished, which is worse for a profile than something small that works.

---

## Naming

**Slate** is the recommendation. A slate is the original classroom surface; it's one syllable, monochrome by association, and it sits cleanly next to Tyson, Lumen, Vantage, and Ember. The domain shape `starhane.com/teach/slate` works, as does standalone.

Alternates, if Slate reads too plain:

| Name | Reasoning | Risk |
|---|---|---|
| **Verso** | The left-hand page of an open book — the working side | Obscure without explanation |
| **Vellum** | Writing surface, warm and editorial | Suggests documents more than boards |
| **Lattice** | The structure underneath the drawing | Reads more infra than classroom |
| **Ferrule** | The metal band on a chalk holder | Too obscure |

---

## Core thesis

Every AI whiteboard on the market screenshots the canvas and sends pixels. That forces the model to re-derive objects it could have been told about, costs 3–5× the tokens, and — critically — leaves the model unable to *reference* anything it sees. It can describe the board. It cannot edit it.

Slate sends a **scene graph**: a text serialization of the board's object model, with stable IDs. The model reads structure and writes structure. The same protocol works in both directions, which is what makes editing possible at all.

Cost savings are a side effect. Addressability is the point.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  CANVAS (custom — Konva render layer)                    │
│  document model · ink capture · draw-time recognition    │
└───────────────┬─────────────────────────┬───────────────┘
                │ serialize (incremental)  │ apply diff
                ▼                          ▲
        ┌───────────────┐          ┌───────────────┐
        │  SCENE GRAPH  │          │   VALIDATOR   │
        └───────┬───────┘          └───────▲───────┘
                │                          │
                ▼                          │
        ┌────────────────────────────────────────┐
        │  ORCHESTRATOR                          │
        │  transcript + graph + note index       │
        └───┬────────────────────────────┬───────┘
            │                            │
            ▼                            ▼
     ┌─────────────┐            ┌─────────────────┐
     │  STT        │            │  NOTES (tool)   │
     │  Groq/Web   │            │  index + FTS5   │
     └─────────────┘            └─────────────────┘
```

**Request path:** button press → STT → transcript + pre-serialized graph + note index → LLM turn → optional `get_note` tool call → diff → validate → apply → animate.

---

## 0. Canvas foundation — build custom

**tldraw is disqualified.** SDK 4.0 restricts free use to development only; production requires a domain-scoped license key at **$6,000/year** after a 100-day trial, the SDK refuses to run without one, the license forbids distributing modifications as a standalone product, and it includes environment detection that phones home. A whiteboard that stops working mid-class when a key lapses is not an acceptable dependency for a bootstrapped product.

**The distinction that matters:** own the document model, don't rewrite rendering.

The document model *is* the differentiator — semantic connectors, explicit containment, stroke retention, confidence fields. Any existing whiteboard's model would be something to fight. But canvas rendering, hit testing, transform math, and pan/zoom are solved and MIT-licensed.

| Layer | Library | License |
|---|---|---|
| Canvas engine — shapes, hit detection, transformers, events | **Konva** | MIT |
| Ink smoothing | **Perfect Freehand** | MIT |
| Layout | **dagre** or **elk** | MIT |
| Multiplayer (later) | **Yjs** | MIT |

**Alternative:** fork **Excalidraw** (MIT, free forever). Faster to a working editor, slower once the model needs reshaping — bindings are weaker and the codebase is more monolithic. Worth an afternoon of reading before committing.

**Estimate:** Konva path ≈ 3–5 weeks to a usable editor. From absolute scratch, months — no reason for it.

**Audit every dependency's license before adopting it.** This one nearly went unchecked.

---

## 1. Scene graph format

Flat, line-per-entity. No JSON — braces and repeated keys cost 2–3× for identical content.

```
n1  box       "HTTP Request"     @ A1
n2  box       "Load Balancer"    @ B1
n3  cylinder  "Postgres"         @ C2
n4  box       "Redis"            @ B2  ?0.72
t1  text      "check timeout"    @ D4
g1  frame     "Backend" { n2 n3 n4 }

n1 -> n2
n2 -> n4  "cache check"
n4 -> n3  "miss"
```

**Include:** type, label, connections, containment, coarse grid position, count, semantic color (`error`, not `#e11d48`), recognition confidence.

**Exclude:** float coordinates, bezier handles, stroke width, z-order, styling, generated IDs.

**Rules**

- Connectors are first-class objects (`{from, to, label}`), never inferred from path geometry. Geometry is derived at render time.
- Containment is stored explicitly on drop, never recovered by bounding-box math.
- Positions quantize to a coarse grid. Preserves above/beside without paying for precision.
- Serialize incrementally on every board edit so the graph is ready the instant the button is pressed.
- Version the format. It will change.

### Model output — diffs only

The model emits operations, never a full board. Full rewrites silently destroy the instructor's own work.

```
add     n5 box "Retry Queue" @ B3
delete  edge n2->n3
connect n2 -> n5
connect n5 -> n3  "after backoff"
update  n1 label "HTTPS Request"
```

Validate before applying: unknown IDs, dangling edges, cycles where illegal. Reject the whole diff rather than half-applying.

**Layout is not the model's job.** It emits nodes, edges, and coarse hints (`row 1`, `below n3`); dagre or elk resolves positions client-side. Better diagrams, fewer tokens, snaps to grid.

---

## 2. Ink and handwriting

Handwriting becomes a text label in the scene graph. The board still renders the instructor's actual ink — two representations of one element, and only the export uses text.

### Division of labour: tools draw shapes, the pen writes words

**Shapes come from tools.** A box drawn with the box tool is an object from birth; the scene graph knows its type for free. No recognition, no error surface.

**Freehand shape recognition, if added later, is geometry — not ML.** Corner detection, closure, aspect ratio, stroke count. The $1 recognizer and Rubine are a few hundred lines and well documented. Solvable in-house.

**Only handwritten text needs a recognizer.** This is the single decision that removes the platform lock — no InkAnalyzer, no WinRT, no C#. Web frontend, Python inference, existing stack throughout.

### Pipeline

```
strokes → group by containing shape → crop each group
       → TrOCR (batched) → labels + confidence
       → merge with tool-drawn objects → scene graph → LLM
```

Containment gives grouping for free when handwriting sits inside a shape. **v1 supports in-shape labels only**; floating annotations need real segmentation and can wait.

### Recognizer: TrOCR, server-side

Start with **`trocr-large-handwritten`** — the ceiling, then cut down once the real failure modes are visible.

| Model | Params | IAM CER | Runs on |
|---|---|---|---|
| trocr-large-handwritten | 334M+ | **2.89%** | GPU |
| trocr-base-handwritten | 334M | 3.42% | GPU, slow CPU |
| trocr-small-handwritten | ~62M | higher | CPU (INT8 ONNX, ~100–200ms) |

**Development stage: Google Colab (T4 GPU) via Cloudflare Tunnel.** During development, TrOCR runs on a free Colab T4 instance exposed via `cloudflared` — same pattern as the existing Ollama setup. Free, no request caps, quick to iterate on. The tunnel URL changes each session, so the frontend takes the TrOCR endpoint as a configurable setting (env var or settings panel), never hardcoded.

**This is intentionally temporary.** Colab sessions are ephemeral and not suitable for production. The Colab setup exists to unblock development and test the recognition pipeline without infra overhead.

**Production target: client-side inference.** The final deployment moves recognition into the browser — `trocr-small` quantized to INT8 ONNX, or **transformers.js** running ONNX Runtime Web via WASM/WebGPU. No server, nothing leaves the device, works offline, and a genuinely strong README line. The configurable endpoint means the migration is a settings change, not a rewrite.

### The known weakness — plan around it

TrOCR degrades on **short lines where context is limited**, and it fails by emitting *valid but wrong words* (its decoder is a RoBERTa-class LM). Whiteboard labels are one or two words: exactly the worst case. "Redis" → "Reds" with no signal that anything went wrong.

Root cause worth noting: the autoregressive decoder is both what makes it slow and what makes it confabulate. A non-autoregressive CTC model would be better on both counts — no equally good pretrained option exists today, but it's the right direction for a v2.

**Mitigation is the escalation layer, and it is the interesting part of this project:**

1. TrOCR on the crop → text + confidence
2. High confidence → accept
3. Low confidence → escalate to **Gemini Flash** with board vocabulary and neighbouring labels in the prompt
4. Agreement → high confidence. Disagreement → flag for one-tap correction.

Frontier VLMs top current cursive benchmarks, and unlike TrOCR they can be handed board context — so the LLM can read "Postgies" and correct it because "Postgres" appears three nodes away. Ensemble recognition with confidence-based routing is architecture, not API-calling, and it is the part that reads well on a profile.

### Accuracy

Realistic ceiling ~95–98% on clean print, lower on cursive. **100% exists only where the user confirms.**

- **Vocabulary biasing** — board labels plus retrieved note terms, injected into the escalation prompt. Highest-leverage single change.
- **Correction UI** — recognized text near the ink, one tap to fix. Where the last few percent actually live.
- **Confidence in the export** (`?0.72`) plus the ink crop, so the model can reconcile.
- **Never silently rewrite.** Model corrections surface as suggestions.
- **Keep raw strokes permanently.** Recognition is a derived field; re-run as models improve.

**Constraint this creates:** the model can only edit what has a name. Unrecognized ink is a hole in the addressable surface — though retrieval tolerates approximate reads where editing does not.

---

## 3. Speech

Two modes, different requirements.

**Command mode** — push-to-talk, short, high precision, errors immediately visible. This is v1.

**Ambient mode** — continuous lecture transcription feeding notes and context. Long-running, noisy, multi-speaker, and errors stay invisible until they poison retrieval. Defer. Also raises classroom consent and recording questions that need answering before shipping.

### Provider

**Groq Whisper (free tier)** — same key already in use for Tyson.

- 20 RPM · 2,000 RPD · 7,200 audio-sec/hour · 28,800 audio-sec/day
- 25MB upload cap, **10-second minimum billed per request**
- Limits are per organization, not per key

The 10s minimum is the binding constraint, not the hourly cap: a 4-second command burns 10 seconds of quota. Effective ceiling ≈ **2,000 commands/day** (RPD binds first). At ~30 commands per class that's 60+ classes of headroom — ample for one instructor, insufficient for a school.

**Fallbacks:** Web Speech API (free, unlimited, lower quality) on 429. **Parakeet-TDT-0.6B-v3** self-hosted on the VPS when ambient mode arrives — Apache 2.0, ~6.3% WER, near-2000× realtime, no quota.

Apply the same vocabulary biasing as handwriting: board labels and lecture terms as keyword boosts.

---

## 4. Model routing

| Path | Model | Why |
|---|---|---|
| Board edits (95% of calls) | **DeepSeek V4 Flash** | ~$0.15/$0.29 per M. Strong agentic/tool scores. 1M context. OpenAI- and Anthropic-compatible. |
| Vision — ink crops, "look at the board" | **Gemini 3.6 Flash** | V4 Flash is **text-only input**. No vision path without it. |
| Handwriting | **TrOCR** (Colab T4 + Cloudflare Tunnel) | Free GPU inference, no per-call cost. See §2. |
| Development | **agy CLI** | Continue existing practice for writing the codebase. |

**Do not run `agy -p` as the production runtime.** It's an interactive dev CLI: process-spawn per request, subscription quota, no concurrency guarantee, and serving other users on a personal-tier subscription is outside its terms. Fine for prototyping; wrong under an instructor mid-lecture with thirty students watching. Runtime goes on metered APIs.

**Data residency:** not a concern at portfolio scope. Would become one if this were ever sold into education.

---

## 5. Retrieval — vectorless

**No embeddings, no vector DB.** The model navigates an index and reads what it decides it needs.

**Why, for this corpus:**

1. Notes change before every class — vector RAG re-embeds on every save; an index update is one line.
2. Metadata already exists (title, date, topic, has-diagram) — an index falls out free.
3. Queries need reasoning, not similarity. "The diagram from last week" is a temporal filter; cosine distance can't express it.
4. Corpus is hundreds of documents. Vector RAG's only advantage is scale that isn't present.
5. It collapses into the call already being made — index in system prompt, `get_note` as a tool. No separate retrieval step.

**Build:**

- Persistent index in the system prompt: `id | title | date | topics | has_diagram | one-line summary`
- `get_note(id)` tool
- **SQLite FTS5** keyword search added when navigation starts missing. Instructors search exact terms — "Dijkstra", "three-way handshake" — precisely where BM25 beats embeddings.

**Store retrieved diagrams as scene-graph fragments, not prose.** Retrieval becomes paste, not regeneration.

**Revisit when:** multi-instructor shared pools, or corpus past ~1,000 documents. Then add embeddings as a first-pass filter *over* the index, not a replacement. Self-host BGE-M3 or Nomic — Gemini's free embedding tier permits training on submitted content, which is wrong for classroom material.

**Query expansion is free here.** "Add the retry logic" is a useless retrieval query alone; paired with a board showing Queue, Worker, and Postgres it becomes rich and disambiguated. Always retrieve on transcript *plus* board labels. This does more for quality than any embedding choice would.

---

## 6. Interaction rules

**One turn, not three.** Give the model the note index and `get_note` in the same call it's already making. Roughly half of requests ("connect these two boxes") need no notes at all.

**Latency budget.** STT ~1s + LLM ~2s + optional fetch + second turn ~3s = 6s of dead air mid-lecture. Mitigations:

- Serialize the board incrementally, never at request time
- Note index stays in the cached system prompt
- Stream the diff; apply nodes as they arrive — first box at 2s, not 6
- Start STT on button-down, stream partials, fire on final with no gap

**Animate insertion.** Stagger node appearance along graph order so it draws like a person would. An instantly-appearing diagram is disorienting and students miss the structure.

**One AI turn = one undo step.** Instructors will ask, dislike, and need it gone in one action mid-class.

**Provenance.** Tag nodes that came from notes distinctly from nodes the model invented. When retrieval finds nothing, the model will happily improvise from general knowledge — which is arguably fine, but the instructor must be able to tell. Admitting improvisation increases trust rather than reducing it.

**The editing experience comes first.** It's easy to build a whiteboard optimized for the model that's worse for the human. If shape recognition fights the instructor, or connectors won't attach where they want, they go back to Miro and the token efficiency is worth nothing.

---

## 7. Build order

**Phase 0 — Foundation**
Custom editor on Konva. Define the document model first — connectors as first-class bound objects, explicit containment on drop, coarse grid, stroke retention on ink elements. Then rendering, selection, undo, pan/zoom. Full-canvas render kept behind a flag permanently — needed for "just look at the picture" cases and for measuring whether the scene graph is losing anything.

**Phase 1 — Serialization**
Scene graph export from the document model. No ML, pure serialization pass. Test against real diagrams drawn by hand. On a typical architecture diagram this is most of the token savings already.

**Phase 2 — Read path**
Transcript + graph → model → prose answer. Proves the format is legible before anything is written back.

**Phase 3 — Write path**
Diff format, validator, apply, undo integration, layout engine, streaming animation. This is where the product becomes real.

**Phase 4 — Voice**
Push-to-talk, Groq Whisper, Web Speech fallback, board-label biasing.

**Phase 5 — Notes**
Index, `get_note`, provenance tagging. FTS5 when navigation misses.

**Phase 6 — Ink**
TrOCR service on Google Colab (T4 GPU, exposed via Cloudflare Tunnel), crop-and-batch from stroke groups, Gemini escalation on low confidence, correction UI. Demo-able without this — ship typed-labels-only first and treat ink as the stretch that makes the project distinctive.

---

## 8. Open questions

1. **Segmentation for floating annotations** — in-shape labels are free via containment; loose notes are not. Deferred past v1.
2. **Layout quality** — dagre on lecture-style diagrams needs testing; teaching diagrams are often deliberately non-hierarchical.
3. **TrOCR on rendered ink** — fine-tuned on scanned pen-on-paper, not clean digital strokes. Domain shift is untested and could go either way.
4. **Escalation threshold** — what confidence level triggers the Gemini pass. Tune against real writing.

---

## 9. Risks

**Scope creep kills it.** The distinctive claim — scene graph, addressability, diff protocol, vectorless retrieval — is fully demonstrable with typed labels and no ink at all. Build that first and make sure it works before touching handwriting.

**Spatial semantics loss.** Text drops "these two things are near each other" in ways that sometimes matter — swimlanes, quadrant charts, anything position-dependent. Coarse grid covers most of it. Test hardest here before trusting the text path.

**Short-label confabulation.** TrOCR's documented weak spot lands exactly on whiteboard labels. The escalation layer is not optional polish; it is the fix.

**Latency.** Six seconds of silence between speaking and seeing anything appear reads as broken. Streaming the diff matters more than total time.

**Verify licenses before adopting dependencies.** tldraw was nearly adopted at $6,000/year with a production kill switch. Check first.

---

## Cost sketch — portfolio use

| Item | Cost |
|---|---|
| STT (Groq free tier) | $0 |
| TrOCR (Colab free tier T4 + Cloudflare Tunnel) | $0 |
| Board edits (DeepSeek V4 Flash) | cents/month at demo volume |
| Gemini escalation | negligible, rare by design |
| Canvas stack (Konva, Perfect Freehand, dagre, Yjs) | $0, all MIT |

Effectively free. Time is the only real budget.

---

## README — the part that matters

The demo is a GIF: speak, diagram appears. The differentiator is the writeup.

Most AI-whiteboard projects screenshot the canvas and send pixels. Explaining *why this one doesn't* — with the token comparison, and the argument that a screenshot leaves the model able to describe the board but not edit it — is what signals systems thinking rather than API wiring. Include:

- The scene graph format, with a worked example
- Token comparison: screenshot vs. graph on the same board
- The diff protocol and validator
- Why retrieval is vectorless given this corpus shape
- The recognition ensemble and confidence routing
- What you'd do next: CTC recognizer, in-browser inference, multiplayer