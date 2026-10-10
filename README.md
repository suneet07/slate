# Slate — AI-Native Whiteboard for Teaching

A structured whiteboard the model reads and writes as a **scene graph** rather than pixels.
Voice or text commands come back as graph diffs (`add`, `connect`, `update`, `delete`) which
are applied to the board. Teacher PDFs are indexed locally with a vectorless BM25 retriever,
so the model can quote from and place figures out of the instructor's own notes.

Design rationale lives in [slateplan.md](slateplan.md).

## Run it

```bash
npm install
```

```bash
npm run dev
```

Opens on <http://localhost:3000>.

Other commands:

```bash
npm test
```

```bash
npm run build
```

## Connecting AI

Settings (⚙) offers two ways in. Pick one; you can switch at any time.

### 1. Signed-in CLI — no key

Use an AI CLI you have already signed in to on this computer through OAuth. Slate runs it
headless and never sees or stores a key.

| CLI | Sign in once with | Models |
| --- | --- | --- |
| Antigravity (`agy`) | run `agy` in a terminal and sign in with Google | Gemini 3.x, Claude 5.5, GPT-OSS — listed live from `agy models` |
| Claude Code (`claude`) | `claude auth login` | `sonnet`, `opus`, `haiku` |

The Settings panel shows each CLI's real state (signed in, signed out, not installed),
checked by asking the CLI itself, with the sign-in step when one is needed. The Gemini CLI
is not offered: Google has retired its OAuth sign-in for individuals in favour of
Antigravity.

How it runs, and why it is safe to point at your notes —
[server/cliBridge.ts](server/cliBridge.ts) is a dev-server middleware that:

- runs only the CLIs it knows by name, never a command from the request;
- passes the prompt on stdin, launches without a shell, and validates model ids;
- runs each CLI in an empty scratch folder with its **tools switched off** (agy in
  read-only plan mode, claude with no tools). These CLIs are agents: given the project folder
  and tool access, agy's first move on a Slate prompt was to run `dir`. With tools off, text
  injected through an uploaded PDF gets a reply, never an action;
- only answers requests carrying `X-Slate-Bridge`, so other sites in the browser cannot
  reach it.

The bridge lives in `npm run dev`; a bare static build cannot run CLIs.

### 2. API key

Paste a key; it is kept in this browser's `localStorage` and sent only to that provider.

| Feature | Key | Where to get it |
| --- | --- | --- |
| Default models (DeepSeek etc.) | NVIDIA NIM (`nvapi-…`) | build.nvidia.com |
| LLaMA / Mixtral | Groq (`gsk_…`) | console.groq.com |
| GPT-4o / 4o-mini / o3-mini | OpenAI (`sk-…`) | platform.openai.com |
| Local / self-hosted model | endpoint + model id | e.g. Ollama on `http://localhost:11434/v1` |

NVIDIA calls are proxied through Vite (`/api/nvidia`) to avoid CORS.

### Voice, in either mode

Voice commands use Groq Whisper, so set a Groq key if you want voice — even on the CLI
connection. With a Groq key present, a failed request also falls back to LLaMA 3.3 70B.

### Handwriting

Handwriting is read **locally by default** — no key, no GPU, no network. Each line of ink is
cut into letters at the gaps between them and matched against a coordinate alphabet
([src/lib/ocr/glyphs.ts](src/lib/ocr/glyphs.ts)) in a couple of milliseconds. Letters that
are genuinely the same drawing reach the model as alternatives, `H[I|l|1]`, and it picks
from the word. Pictures are kept out: a line must read well, its letters must be one height,
and boxes and triangles never count as letters.

It reads printed writing. Joined-up cursive leaves no gaps to cut at; for that, run the
optional TrOCR server — [colab/trocr_colab_server.py](colab/trocr_colab_server.py), a Colab T4
behind a Cloudflare tunnel — and paste its URL into Settings. When it is set it is used
first, and the local reader takes over whenever it is unreachable.

## How retrieval works

Upload PDFs, `.txt` or `.md` through the document button. On upload each file is parsed
entirely in the browser:

- **Text** is split into 250-word windows with 40% overlap and tokenized (stopword-filtered,
  lightly stemmed) for BM25.
- **Figures and tables** are detected by finding caption lines, then cropping the region the
  caption actually describes — downward through the rows for a table, upward across the
  blank band for a figure. Two-column pages are split at the gutter so a crop never picks up
  the neighbouring column.

At command time:

1. Commands that are pure board manipulation ("connect n1 to n2") skip retrieval entirely.
2. Otherwise BM25 runs over the query, weighted above board labels (0.35) and handwriting
   (0.2), and returns up to 5 passages with a relative score cutoff and per-page diversity.
3. The prompt also carries a **note index** — one line per page, with an ID.
4. If the excerpts don't cover the question, the model replies with `fetch <noteId>` lines,
   those pages are read in full, and it is asked once more. One extra round trip, never a
   loop.

Figures are placed by exact ID. If no diagram matches, nothing is placed and the chat says
so — it will not substitute an unrelated page.

## Tests

```bash
npm test
```

Five suites covering the pure logic — PDF caption geometry and column detection, BM25
scoring and tokenizing, the retrieval gate, diff parsing and layout, and the note
fetch protocol. Each is bundled with esbuild (already present via Vite) and run in Node;
`tests/run.mjs` exits non-zero if any assertion fails.

They are not covered by `npm run build`, since `tsconfig.json` only includes `src`.

## Known issues

- **Konva logs `drawImage … width or height of 0` on load.** Pre-existing; the board still
  renders. Not yet traced.
- **Uploaded documents are not persisted.** They live in memory only, so a refresh clears
  them. Only API keys and settings survive in `localStorage`.
- **Cross-page tables are stitched by row shape, not by ruling lines.** A table cut off by a
  page break is rejoined with its continuation rows, but the join is inferred from text
  layout, so a continuation that repeats its header row will include that header mid-image.
- **No undo for an AI turn.** [slateplan.md](slateplan.md) calls for one AI turn = one undo
  step; not built yet.
- **No provenance marking.** Nodes derived from the notes look identical to nodes the model
  invented.
- **Diff application is not streamed**, so a large diagram appears all at once after the
  round trip rather than drawing progressively.
