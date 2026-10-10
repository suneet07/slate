# AI Whiteboard

An infinite-canvas classroom whiteboard with a scene graph designed to be driven
by a language model — including small, cheap ones. No tldraw, no licence, no
screenshots sent to a model.

```bash
npm install
npm run dev
```

```bash
cd backend && .venv/Scripts/python -m uvicorn main:app --port 8000
```

Copy `backend/.env.example` to `backend/.env` and fill in at least one key —
`GROQ_API_KEY` ([console.groq.com/keys](https://console.groq.com/keys)) or
`NVIDIA_API_KEY` ([build.nvidia.com](https://build.nvidia.com/)). Keys live in
that file and nowhere else; it is gitignored.

---

## Why it is built this way

The board is never rasterised for the model. It is read as a text digest and
written to with a flat command list. Three decisions do the heavy lifting:

**1. The board is a spreadsheet grid.** Positions are `"C3"`, sizes are `"4x2"`.
Models are far better at cell references than at pixel arithmetic, and a wrong
cell is off by one square instead of off the screen. The grid and its column
letters are drawn on the canvas, so the teacher reads the same addresses.

**2. Every shape has a short name.** `box1`, `title`, `evap` — never a uuid.
Follow-up requests ("make the fox box red") become `{"op":"set","target":"fox"}`.
Names are auto-assigned per shape kind when the model omits them, and returned
in the result so they can be chained.

**3. Layout is a verb.** `align`, `stack`, `grid`, `distribute` compute the
coordinates. The model expresses intent — "put these in a row" — and never does
the arithmetic. Same for `connect`: arrows bind to shapes by name and follow
them when they move.

Two more things make weak models workable:

- **Omitting a position is legal.** The engine finds free space itself, so the
  cheapest correct answer is also the shortest one.
- **Errors come back as repair instructions.** Every command is validated
  individually; a bad one fails with a message naming the offending field, and
  the panel automatically sends those messages back for one correction pass.
- **Near-misses are corrected, not rejected.** A slightly wrong shape beats a
  missing one mid-lesson, so off-palette colours (`brown`, `purple`) map to the
  nearest listed one, `fill:"yellow"` is read as a yellow solid fill, an `add`
  of an arrow with `from`/`to` runs as a `connect`, and an `add` carrying
  `points` runs as a `draw`. Each correction comes back as a warning.

## What the model sees

```
BOARD grid 24x14 cells (columns A..X, rows 1..14); 1 cell = 100 units
SHAPES (5):
grass      rect    B2   3x1   green  tint "Grass"
rabbit     rect    E2   3x1   orange tint "Rabbit"
fox        rect    I2   3x1   red    solid "Fox"
arrow1     arrow   grass -> rabbit black "eats"
arrow2     arrow   rabbit -> fox black "eats"
FREE ROWS: 4-14
```

## Reading what the teacher drew

A bounding box tells a model nothing — "ink1 at C3, 5x5" could be a circle, a
word, or a scribble, which is why an early build answered "draw hair on the
smiley" by doing nothing. So strokes are measured instead
(`src/ai/inkAnalysis.ts`) and described:

```
DRAWING d1 (teacher pen, 5 strokes) spans C3..H8, centre E5, 5x5 cells
  ink1     large closed circle           at C3..H8
  ink2     small closed ellipse          inside ink1, upper-left   mirrors ink3
  ink3     small closed ellipse          inside ink1, upper-right  mirrors ink2
  ink5     small vertical straight line  inside ink1, centre
  ink4     medium arc opening up         inside ink1, lower-middle
```

Per stroke: closed or open, circularity, straightness, corner count, and for
curves which way they open — "opening up" is a smile, "opening down" is a
frown. Then containment and where within (`upper-left`, `lower-middle`), and
mirrored pairs, which is what turns *two small marks* into *a pair of eyes*.
Touching strokes are grouped into one drawing, listed frame-first then in
reading order.

Nothing here names a face. The model is handed the geometry and works it out —
and `say`s it back:

> *what is on the screen* → "A smiley face: a large circle with two eyes and a smile."

To add to a drawing it uses `draw` with `relativeTo`, where points are fractions
of the named stroke's box, so `[0.4, -0.2]` is above and left of centre:

```json
{"op":"draw","relativeTo":"ink1","points":[[0.42,0],[0.40,-0.20],[0.52,-0.06]]}
```

Three coarse points per stroke; a Catmull-Rom pass smooths them into a curve.
That is how "draw hair on the smiley" lands four strokes across the top of the
head without a single pixel being sent anywhere.

## What it answers with

```json
{"commands":[
  {"op":"add","shape":"rect","name":"fox","size":"3x1","text":"Fox","color":"orange","fill":"tint"},
  {"op":"stack","target":["grass","rabbit","fox"],"dir":"right","gap":40,"at":"B2"},
  {"op":"connect","from":"rabbit","to":"fox","text":"eats"}
]}
```

## The instructions

`shared/` holds five markdown files. The backend concatenates them into its
system prompt; the app shows the same files verbatim in the **commands** panel.
One source, so the docs can never drift from what the model was told.

| file | what it teaches |
|---|---|
| `board-commands.md` | the verbs and their fields |
| `board-coordinates.md` | cells, sizes, relative placement, fractions, converting "in the middle" into a cell |
| `board-reading.md` | how to read the digest, every stroke class, working out what a drawing depicts |
| `board-drawing.md` | worked answers to copy — smiley, sun, house, flowchart, graph axes, process |
| `board-mistakes.md` | the slips models actually make, wrong-vs-right |

That is ~26k characters, about 7k tokens per call, which exhausts a Groq free
daily allowance in roughly a dozen requests. So the backend picks sections per
request — `WHITEBOARD_SPEC` in `backend/.env`:

- `auto` (default) — reading only when the board has pen strokes, the cookbook
  only when something is being drawn. 15k–27k chars.
- `core` — commands + mistakes only, ~10k chars. Cheapest, noticeably worse at
  pictures.
- `full` — everything, every time.

`GET /api/health` reports the mode and the size of each file.

## Model routing

Free tiers run out mid-lesson, so `backend/providers.py` holds an ordered chain
of model slots across providers and walks down it as allowances are spent.

```
WHITEBOARD_MODELS=groq:llama-3.3-70b-versatile,nvidia:meta/llama-3.3-70b-instruct,nvidia:nvidia/llama-3.1-nemotron-70b-instruct,groq:llama-3.1-8b-instant
```

Both providers speak the OpenAI chat-completions dialect, so one HTTP client
serves them; adding a third is three lines in `PROVIDERS`. A slot whose key is
missing is skipped, so either provider works alone.

What happens on failure:

| response | what the router does |
|---|---|
| `429` | rests the slot for the time the provider names — Groq's *"try again in 56m29.472s"* is parsed — and moves down the chain |
| `413` / "too large" | retries the **same** model once with the compact reference, then moves on |
| `401` / `403` | rests it an hour; the key is wrong, not busy |
| `404` | rests it a day; the model id is wrong for that provider |
| `5xx`, timeout | rests it five minutes |

Cooldowns are remembered across requests, so a spent slot is not re-tried on
every prompt. When everything is resting it still tries the soonest-free one —
a stale cooldown must never mean a dead board. The reply says which slot
answered, and the AI panel prints it under each message.

`WHITEBOARD_ROUTING=round_robin` starts one slot further along each request to
spread load instead of always preferring the best model.

`GET /api/health` lists every slot, whether its key is present, and how long it
is resting and why. It never returns key values.

## Layout

```
src/engine/     framework-free canvas engine — types, store, renderer, geometry, grid
src/ai/         commands.ts   command schema + validating executor
                serialize.ts  board -> text digest
                inkAnalysis.ts  stroke geometry, relations, clustering
src/components/ Whiteboard canvas, toolbar, AI panel
shared/         five markdown files — the AI-facing instructions
backend/        main.py       FastAPI; assembles the prompt, parses the reply
                providers.py  model chain across Groq and NVIDIA, with cooldowns
```

The engine has no React and no dependencies; React only observes the store.

## Using the board

| | |
|---|---|
| Pen, shapes, text, sticky note | toolbar; stylus pressure is captured |
| Arrow | pick the arrow tool, drag from one shape to another |
| Pan / zoom | space-drag or middle-drag; `Ctrl` + wheel to zoom |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Nudge | arrow keys; `Shift` + arrow moves a whole cell |
| Edit text | double-click a shape |
| See what the AI sees | the 🏷 button shows every shape's name |

The board autosaves to `localStorage`.

## Scripts

```bash
npm run dev     # vite dev server
npm run build   # typecheck + production build
npm test        # headless smoke test of the command layer
npm run lint    # oxlint
```

`npm test` exercises the layer the model talks to: placement, naming, arrow
binding, layout verbs, selectors, validation, undo, the digest, and stroke
reading — it builds a smiley from raw points and asserts the description comes
back as a circle with mirrored eyes and an upward arc.

The backend reads `shared/*.md` once at import, so **restart uvicorn after
editing them**. Router tests are separate and need no keys or network:

```bash
cd backend && .venv/Scripts/python test_providers.py
```

In dev, `window.board` exposes `run(commands)`, `digest()` and `store`, so the
whole command language can be driven from the browser console.

## Not done yet

- Handwriting recognition reads printed writing, not joined-up cursive. Letters
  are cut apart at the gaps between them, which a joined hand does not leave;
  those words come back marked uncertain and drawn out as a grid instead.
- Voice uses the browser's built-in speech recognition (Chrome/Edge only).
- Images: the `image` shape renders a `src` URL; there is no upload flow.
