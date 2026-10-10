import { SceneGraph, DocImage } from '../graph/types';
import { serializeSceneGraph, OcrHandwritingSnippet } from '../graph/serializer';
import { parseGraphDiff } from '../diff/diffParser';
import { applyDiffToGraph } from '../diff/layoutEngine';
import { useBoardStore } from '../../store/useBoardStore';
import { processClusteredInkOcr } from '../ocr/trocrClient';
import { readInkLocally } from '../ocr/localInkReader';
import { coordsToGridPos } from '../graph/quantizer';
import { buildLlmBody, fetchWithTimeout, llmHeaders, LlmRoute, readableError, resolveLlmRoute } from './llmClient';
import { vectorlessRag } from '../rag/vectorlessRag';
import { TeacherDocument } from '../rag/pdfExtractor';
import { collectLeaves } from '../rag/noteTree';
import { searchNoteTree } from '../rag/treeSearch';
import { commandNeedsNotes } from './retrievalGate';

interface ApiKeys {
  groqApiKey: string;
  llmApiKey: string;
  openaiApiKey?: string;
}

const SYSTEM_PROMPT = `You are Slate AI, an intelligent whiteboard assistant for teaching.
You inspect a structured scene graph of objects on a whiteboard slide, along with teacher's handwritten notes, retrieved lecture note excerpts, and available PDF diagrams, and execute user instructions by returning graph operations (diffs).

### STRICT PRECISION DIRECTIVE:
- Execute ONLY what the user explicitly requests with absolute precision.
- Do NOT invent filler text, random labels, dummy titles, or extra unrequested nodes.
- If the user asks to "make a box" or "add a box", add a box with label "" unless a specific label was explicitly requested.
- If handwritten text is present on the slide (listed under "# HANDWRITTEN NOTES ON SLIDE"), treat it as what the teacher wrote and use it as context. Letters in brackets like H[I|l|1] are the same drawing with several possible meanings: pick the one that makes a real word (H[I|l|1] is HI, H[2|Z][O|0|o] is H2O). A reading marked (uncertain) may be wrong; say so rather than building on it.
- If teacher reference notes are provided (indicated under "# TEACHER REFERENCE NOTES (via Vectorless RAG)"), use them to construct correct, accurate technical whiteboard diagrams and object labels!
- If the user asks to bring, show, or place a diagram/figure from their notes, emit an image node operation whose label is the EXACT diagram ID copied from "# AVAILABLE DIAGRAMS FROM TEACHER NOTES": add <id> image "<exact diagram ID>" @ <gridPos>.
- NEVER invent, abbreviate, or paraphrase a diagram ID. If no listed diagram matches what the user asked for, do NOT emit an image node — say in plain text which diagram you could not find.
- If the user asks for several diagrams, emit one image node per diagram, each with its own distinct ID.

### SECTIONS OF TEXT ARE NOT DIAGRAMS:
- A whole-page scan is a photograph of an entire page. It is a last resort, never a way to show a section: the audience cannot read it, and it drags in everything else on that page.
- If the user names a written section, topic, definition, derivation, or law (e.g. "limitations of Ohm's law", "the whole section"), do NOT place page scans. Fetch the note, read it, and build the content as real board objects: a text or box node per point, connected where that helps.
- Place at most ONE whole-page scan per command. Only exceed that if the user explicitly asks for multiple pages by number ("put up pages 9 to 12").
- "The whole section" means the complete CONTENT of that section as board objects, not the complete set of pages it appears on. If the section spans pages, fetch each page and lay out its points.
- Reach for an image node only when the thing requested is genuinely pictorial: a figure, table, chart, graph, circuit diagram, photo, or logo. A request for a photo ("my photo", "the picture of X") is answered from the PICTURES section by matching where the picture sits, its shape and its nearby label — a portrait-shaped picture on a profile or ID page is the person's photo.
- A request for a DIAGRAM ("the diagram of X", "where the pattern is shown") is answered from the PICTURES section — which includes image-only slides, where the whole slide is the diagram — choosing one whose labels fit, never one marked "mostly text, not a diagram" — those are scans of notes or pasted paragraphs. Diagram labels name the parts, not the topic (a lap-winding diagram is labelled "Back Pitch, Front Pitch, Commutator pitch"), so match the labels to the topic's vocabulary and use the section name. If several diagrams fit, prefer the one whose labels cover the most of what was asked.

### READING THE TEACHER'S NOTES:
- The retrieved excerpts are the best keyword matches, not the whole of the notes. A "# NOTE INDEX" section holds a titled, summarised tree of everything you can read.
- The index is a MAP, not the notes themselves. Its titles and summaries were written to help you choose what to read — they are not source material. Never build board content out of an index summary: fetch the page and work from the teacher's actual words.
- Read the index before deciding you lack information: a page whose title or topics match the command is almost always the right page, even when no excerpt from it was retrieved.
- If a fetched note ends with a note that the section continues on other pages, fetch those pages too before answering, or say plainly which part you did not read.
- Fetch by ID: page IDs look like note_<doc>_p<n>, section IDs like sec_<doc>_<n>. A section returns all of its pages.
- If the excerpts do not contain what you need to answer accurately, reply with ONLY fetch lines and nothing else: fetch <noteId>
- You may fetch up to 4 notes in one reply. You will be given their full text and asked again. Prefer fetching over guessing from general knowledge.
- Do not fetch when the excerpts already answer the command, and never fetch twice.

### SCENE GRAPH RULES:
- Read the scene graph structure provided. Nodes have stable IDs (e.g. n1, n2, n3).
- Return ONLY graph diff operations to modify the board. Do NOT rewrite the whole board.

### DIFF FORMAT SPECIFICATION:
- add node: add <id> <box|cylinder|frame|text|circle|image|sticky|diamond|triangle|star|hexagon|cloud> "<label>" @ <gridPos> [<color>]
- connect nodes: connect <fromId> -> <toId> "<label>"
- delete node/edge: delete <id>
- update node: update <id> label "<new label>"

### EXAMPLE RESPONSE:
\`\`\`
add n4 box "" @ B2 [primary]
connect n2 -> n4 ""
\`\`\`
Return diff operations cleanly inside triple backticks.`;

/**
 * Transcribes audio via Groq Whisper API with board label prompt biasing
 */
export async function transcribeAudio(audioBlob: Blob, groqApiKey: string, sceneGraph: SceneGraph): Promise<string> {
  if (!groqApiKey) {
    throw new Error('Groq API Key is missing. Please set your Groq API Key in Settings.');
  }

  const labels = Object.values(sceneGraph.nodes).map((n) => n.label).filter(Boolean).join(', ');
  const promptBias = labels ? `Whiteboard diagram containing: ${labels}` : 'Whiteboard diagram';

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-large-v3');
  formData.append('prompt', promptBias);
  formData.append('response_format', 'json');

  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqApiKey}`
    },
    body: formData
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq STT failed (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.text || '';
}

/**
 * Automatically runs TrOCR on ink strokes, executes Vectorless RAG on teacher notes, and stitches handwritten text + RAG excerpts + diagram list into the scene graph payload
 */
export async function prepareStitchedSceneGraph(
  sceneGraph: SceneGraph,
  trocrUrl: string,
  userQueryText: string = ''
): Promise<{ graphText: string; snippets: OcrHandwritingSnippet[] }> {
  const store = useBoardStore.getState();
  const inkStrokes = Object.values(sceneGraph.ink);
  let snippets: OcrHandwritingSnippet[] = [];

  if (inkStrokes.length > 0) {
    // TrOCR when a server is configured — it reads cursive. Otherwise, and whenever it is
    // unreachable, the local reader: free, instant, and always there. Before this the
    // board's handwriting simply did not exist for the model unless a Colab GPU was up.
    let viaTrocr = false;
    if (trocrUrl) {
      try {
        store.setAiStatus(true, 'Auto-running TrOCR on slide handwriting...');
        const clusterResults = await processClusteredInkOcr(
          inkStrokes.map((s) => ({ id: s.id, points: s.points })),
          trocrUrl
        );
        snippets = clusterResults
          .filter((r) => r.text && r.text.trim())
          .map((r) => ({ text: r.text, gridPos: coordsToGridPos(r.x, r.y), strokeIds: r.strokeIds }));
        viaTrocr = true;
      } catch (err) {
        console.warn('TrOCR unavailable, reading handwriting locally instead:', err);
      }
    }

    if (!viaTrocr) {
      snippets = readInkLocally(inkStrokes.map((s) => ({ id: s.id, points: s.points }))).map((line) => ({
        text: line.uncertain ? `${line.text} (uncertain)` : line.text,
        gridPos: coordsToGridPos(line.x, line.y),
        strokeIds: line.strokeIds
      }));
    }

    snippets.forEach((snippet, idx) => {
      store.addChatMessage({
        sender: 'system',
        text: `🖊️ Read handwriting #${idx + 1} (${viaTrocr ? 'TrOCR' : 'local'}): "${snippet.text}" at ${snippet.gridPos}`
      });
    });
  }

  let baseGraphText = serializeSceneGraph(sceneGraph, snippets);

  // The note index and diagram list travel with EVERY turn that has documents. Gating them
  // on a keyword test meant a follow-up like "now 3.4" — which tokenizes to nothing — was
  // sent with no map of the notes and no diagram IDs at all, so the model could not have
  // answered it correctly however good the index was. Only the BM25 excerpts, which are
  // bulky and genuinely irrelevant to "connect n1 to n2", stay behind the gate.
  const boardLabelsForGate = Object.values(sceneGraph.nodes).map((n) => n.label).filter(Boolean);
  if (store.uploadedDocs.length > 0) {
    const boardLabels = boardLabelsForGate;
    const handwrittenTexts = snippets.map((s) => s.text);
    const needsNotes = commandNeedsNotes(userQueryText, boardLabelsForGate);

    // Reasoning-based retrieval first: a dedicated call picks sections by what they are
    // about. BM25 runs only as a safety net, because a lexical score cannot tell a section
    // on a topic from a section that mentions it once.
    let search = { thinking: '', nodeIds: [] as string[], context: '', skipped: true };
    if (needsNotes) {
      store.setAiStatus(true, 'Reasoning over your notes to choose what to read...');
      search = await searchNoteTree(userQueryText, store.uploadedDocs, store.expertRules);

      if (search.context) {
        baseGraphText += `\n\n${search.context}`;
        store.addChatMessage({
          sender: 'system',
          text: `🧭 Read ${search.nodeIds.length} section(s) by reasoning over the index: ${search.nodeIds.join(', ')}${
            search.thinking ? `\n"${search.thinking.slice(0, 220)}"` : ''
          }`
        });
      }
    }

    // Lexical excerpts only when reasoning produced nothing — either it was skipped, it
    // failed, or it decided the notes were not needed.
    const excerpts =
      needsNotes && search.nodeIds.length === 0 && search.skipped
        ? vectorlessRag.retrieveExcerpts(userQueryText, boardLabels, handwrittenTexts, store.uploadedDocs, 5)
        : [];

    if (excerpts.length > 0) {
      const ragFormatted = vectorlessRag.formatExcerptsForPrompt(excerpts, store.uploadedDocs);
      baseGraphText += `\n\n${ragFormatted}`;

      // One summary line rather than one message per excerpt — retrieval now returns more
      // of them, and a wall of chat noise buries the teacher's own conversation.
      const sources = excerpts
        .map((ex) => `${ex.filename} p.${ex.pageNumber} (${ex.score.toFixed(1)})`)
        .join(', ');
      store.addChatMessage({
        sender: 'system',
        text: `📚 Retrieved ${excerpts.length} reference excerpt(s): ${sources}\n"${excerpts[0].text.slice(0, 120)}..."`
      });
    }

    // The navigable index of everything readable, so retrieval misses are recoverable:
    // the model can fetch the page it actually wants instead of working from a bad guess.
    const noteIndex = vectorlessRag.buildNoteIndex(store.uploadedDocs);
    if (noteIndex) {
      baseGraphText += `\n\n# NOTE INDEX (the full map of the teacher's notes — fetch any line with: fetch <id>):\n${noteIndex}\n`;
    }

    // Append available diagrams list, keyed by stable ID.
    // Detected Table/Figure crops are listed first; whole-page scans are demoted to a
    // fallback section so they don't crowd out the real diagrams.
    const allImages = store.uploadedDocs.flatMap((d) => d.images || []);
    const cropImages = allImages.filter((img) => img.kind === 'crop');
    // An image-only slide is a picture — the slide IS the diagram — so it is listed with the
    // pictures, described by what it shows, not demoted to the last-resort page scans.
    const pageImages = allImages.filter((img) => img.kind === 'page' && !img.imageOnly);
    const pictureImages = allImages.filter((img) => img.kind === 'picture' || img.imageOnly);

    if (allImages.length > 0) {
      baseGraphText += `\n\n# AVAILABLE DIAGRAMS FROM TEACHER NOTES:\n`;

      if (cropImages.length > 0) {
        cropImages.forEach((img) => {
          baseGraphText += `- ${img.id} | ${img.caption || 'untitled'} | ${img.filename} p.${img.pageNumber}\n`;
        });
      } else {
        baseGraphText += `(No Table/Figure regions were detected in the uploaded notes.)\n`;
      }

      // Embedded pictures carry no caption, so each is described by where it sits, its
      // shape and the nearest label — enough to match "my photo" or "the logo".
      if (pictureImages.length > 0) {
        baseGraphText += `\n## PICTURES EMBEDDED IN THE NOTES (photos, logos, uncaptioned figures):\n`;
        pictureImages.forEach((img) => {
          // The section the slide belongs to says what topic a picture is about, which its
          // own labels often do not — a lap-winding diagram is labelled "Back Pitch, Front
          // Pitch", never "lap winding".
          baseGraphText += `- ${img.id} | ${img.caption || 'picture'} | ${img.filename} p.${img.pageNumber}${describePageSection(store.uploadedDocs, img.docId, img.pageNumber)}\n`;
        });
      }

      if (pageImages.length > 0) {
        baseGraphText += `\n## WHOLE-PAGE SCANS (a photo of the entire page — use ONLY if no diagram above matches, or the user explicitly asks for a page):\n`;
        pageImages.forEach((img) => {
          // Without the page's indexed title this line reads "p.9" and nothing else, so a
          // request for one section can only be answered by guessing a page range — which is
          // how "the whole section" turned into five whole-page scans.
          baseGraphText += `- ${img.id} | ${img.filename} p.${img.pageNumber}${describePage(store.uploadedDocs, img.docId, img.pageNumber)}\n`;
        });
      }

      baseGraphText += `(To place one, emit: add <id> image "<exact diagram ID from this list>" @ <gridPos>)\n`;
    }
  }

  return {
    graphText: baseGraphText,
    snippets
  };
}

/**
 * The indexed title/topics for one page, for annotating an otherwise anonymous page scan.
 */
/**
 * The indexed section a page falls inside — unlike describePage, which only matches the
 * first page of a section, so a picture three slides into a section still gets its topic.
 */
function describePageSection(documents: TeacherDocument[], docId: string, pageNumber: number): string {
  const doc = documents.find((d) => d.id === docId);
  if (!doc || !doc.tree) return '';
  const leaves = collectLeaves(doc.tree)
    .filter((l) => l.pageStart <= pageNumber)
    .sort((a, b) => b.pageStart - a.pageStart);
  const leaf = leaves.find((l) => (l.pageEnd ?? l.pageStart) >= pageNumber) ?? leaves[0];
  return leaf ? ` | section: ${leaf.title}` : '';
}

function describePage(documents: TeacherDocument[], docId: string, pageNumber: number): string {
  const doc = documents.find((d) => d.id === docId);
  if (!doc || !doc.tree) return '';

  const leaf = collectLeaves(doc.tree).find((l) => l.pageStart === pageNumber);
  if (!leaf) return '';

  const topics = leaf.topics.length > 0 ? ` | topics: ${leaf.topics.join(', ')}` : '';
  return ` | ${leaf.title}${topics}`;
}

/**
 * Resolves a single image node's label to one specific extracted document image.
 * Order: exact diagram ID, explicit Table/Figure reference, explicit page reference,
 * caption substring. Returns undefined rather than guessing — an unresolved node is
 * dropped and reported, so the board never shows an unrelated page as if it matched.
 */
function resolveDocImage(label: string, images: DocImage[]): DocImage | undefined {
  const trimmed = (label || '').trim();
  if (!trimmed || images.length === 0) return undefined;

  // 1. Exact diagram ID (what the system prompt instructs the model to emit)
  const byId = images.find((img) => img.id === trimmed);
  if (byId) return byId;

  const lower = trimmed.toLowerCase();

  // 2. Explicit Table/Figure reference. Whole-word matched, so "Table 2" never
  //    resolves to "Table 20" and a Figure never resolves to a Table.
  const tfMatch = lower.match(/\b(table|figure|fig|chart|diagram)\s*\.?\s*(\d+[a-z]?)\b/);
  if (tfMatch) {
    const kind = tfMatch[1] === 'fig' ? 'figure' : tfMatch[1];
    const captionRe = new RegExp(`\\b${kind}\\s*\\.?\\s*${tfMatch[2]}\\b`, 'i');
    const byCaption = images.find((img) => img.kind === 'crop' && captionRe.test(img.caption || ''));
    if (byCaption) return byCaption;
  }

  // 3. Explicit page reference — prefer a detected diagram on that page over the whole scan
  const pageMatch = lower.match(/\bpage\s*(\d+)\b/);
  if (pageMatch) {
    const targetPage = parseInt(pageMatch[1], 10);
    return (
      images.find((img) => img.kind === 'crop' && img.pageNumber === targetPage) ||
      images.find((img) => img.pageNumber === targetPage)
    );
  }

  // 4. Caption substring, detected diagrams first
  if (lower.length > 3) {
    return (
      images.find((img) => img.kind !== 'page' && (img.caption || '').toLowerCase().includes(lower)) ||
      images.find((img) => (img.caption || '').toLowerCase().includes(lower))
    );
  }

  return undefined;
}

/**
 * Executes an LLM query taking transcript + current scene graph and updates board store
 */
export async function processVoiceCommand(audioBlob: Blob, sceneGraph: SceneGraph, keys: ApiKeys) {
  const store = useBoardStore.getState();
  const transcript = await transcribeAudio(audioBlob, keys.groqApiKey, sceneGraph);
  const messageId = store.addChatMessage({ sender: 'user', text: transcript });

  const { graphText } = await prepareStitchedSceneGraph(sceneGraph, store.trocrUrl, transcript);
  store.updateChatMessage(messageId, { graphSnippet: graphText });

  return await executeLlmQuery(transcript, graphText, sceneGraph, keys);
}

/**
 * Executes a text command from the Chat Sidebar
 */
export async function processTextCommand(userText: string, sceneGraph: SceneGraph, keys: ApiKeys) {
  const store = useBoardStore.getState();

  // Echo the command BEFORE any network work. Retrieval and OCR run for seconds, and if
  // either stalls the message would otherwise never appear at all — the input clears and
  // what the teacher typed simply vanishes. The scene-graph snippet is filled in after.
  const messageId = store.addChatMessage({ sender: 'user', text: userText });

  const { graphText } = await prepareStitchedSceneGraph(sceneGraph, store.trocrUrl, userText);
  store.updateChatMessage(messageId, { graphSnippet: graphText });

  return await executeLlmQuery(userText, graphText, sceneGraph, keys);
}

// An explicit ask for several pages. Anything vaguer gets the one-scan cap.
export const MULTI_PAGE_REQUEST = /\bpages?\s*\d+\s*(?:-|–|to|through|and|,)\s*\d+|\b(?:all|every|each)\s+(?:the\s+)?pages?\b|\bpages\b.*\b\d+\b.*\b\d+\b/i;

/** Turns kept as context. Enough to resolve a follow-up, short enough to stay cheap. */
const HISTORY_TURNS = 6;
const HISTORY_CHARS = 600;

/**
 * Replays the recent chat as real conversation turns.
 *
 * Every command used to be sent as a standalone request, so a follow-up like "now 3.4" had
 * no antecedent — the model could not know 3.4 was the next figure in the same series, and
 * the teacher's actual intent lived only in the previous message. The scene graph alone does
 * not carry that: it shows what is on the board, not what was just asked for.
 *
 * Only the user's own words and the assistant's replies are replayed. The stitched graph
 * payload is excluded — the current turn already carries a fresh one, and old copies would
 * describe a board that no longer exists.
 */
function buildConversationHistory(chatMessages: { sender: string; text: string }[], currentText: string): any[] {
  const turns = chatMessages.filter((m) => m.sender === 'user' || m.sender === 'ai');

  // The command being executed is already in the feed by this point; replaying it here too
  // would send it twice, once without its scene graph.
  const last = turns[turns.length - 1];
  const prior = last && last.sender === 'user' && last.text === currentText ? turns.slice(0, -1) : turns;

  return prior
    .slice(-HISTORY_TURNS)
    .map((m) => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text.length > HISTORY_CHARS ? `${m.text.slice(0, HISTORY_CHARS)}…` : m.text
    }));
}

async function executeLlmQuery(userText: string, graphText: string, sceneGraph: SceneGraph, keys: ApiKeys) {
  const store = useBoardStore.getState();

  // Provider routing is shared with the note indexer so both reach the same model.
  const route = resolveLlmRoute();
  const endpoint = route.endpoint;
  const modelName = route.modelName;
  let displayModelName = route.displayName;

  store.setActiveModelName(displayModelName);
  store.setAiStatus(true, `Querying ${displayModelName}...`);

  // The Groq fallback is a different route, not a flag on this one.
  const groqFallbackRoute: LlmRoute = {
    provider: 'groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: keys.groqApiKey,
    modelName: 'llama-3.3-70b-versatile',
    displayName: 'LLaMA 3.3 70B (Groq Fallback)'
  };

  /**
   * Sends one conversation to the routed provider, keeping the 529 retry and Groq
   * fallback. Extracted so the fetch-notes second turn reuses identical routing.
   */
  const callModel = async (messages: any[]): Promise<string> => {
    let response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: llmHeaders(route),
      body: buildLlmBody(messages, route, { nvidiaThinking: true })
    });

    // Handle 529 Server Overloaded: Retry once after 800ms delay, without the thinking
    // options that make the request expensive to schedule.
    if (response.status === 529 && route.provider === 'nvidia') {
      console.warn('NVIDIA NIM returned 529 (Overloaded). Retrying payload in 800ms...');
      store.setAiStatus(true, 'NVIDIA NIM overloaded (529), retrying...');
      await new Promise((r) => setTimeout(r, 800));

      response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: llmHeaders(route),
        body: buildLlmBody(messages, route, { nvidiaThinking: false })
      });
    }

    // Fallback to Groq LLaMA if primary API fails
    // Decided by the route actually called, not the API model selected in the picker —
    // in CLI mode those are different things.
    if (!response.ok && route.provider !== 'groq' && keys.groqApiKey) {
      const errText = readableError(await response.text());
      const statusMsg = `Primary provider error (${response.status}): ${errText.slice(0, 240)}`;
      console.warn(`${statusMsg}: ${errText}. Falling back to Groq LLaMA 3.3 70B...`);

      displayModelName = groqFallbackRoute.displayName;
      store.setActiveModelName(displayModelName);
      store.setAiStatus(true, `Falling back to ${displayModelName}...`);

      store.addChatMessage({
        sender: 'system',
        text: `⚠️ ${statusMsg}. Automatically fallback routed to Groq LLaMA 3.3 70B.`
      });

      response = await fetchWithTimeout(groqFallbackRoute.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqFallbackRoute.apiKey}` },
        body: buildLlmBody(messages, groqFallbackRoute)
      });
    }

    if (!response.ok) {
      const errText = readableError(await response.text());
      store.addChatMessage({
        sender: 'ai',
        text: `Error: LLM query failed (${response.status}): ${errText}`,
        modelName: displayModelName
      });
      throw new Error(`LLM call failed (${response.status}): ${errText}`);
    }

    const completion = await response.json();
    return completion.choices?.[0]?.message?.content || '';
  };

  // Extract triple backtick diff code block
  const extractDiffText = (raw: string): string => {
    const match = raw.match(/```(?:[a-z]*)\n([\s\S]*?)\n```/);
    return match ? match[1] : raw;
  };

  const conversation: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...buildConversationHistory(store.chatMessages, userText),
    {
      role: 'user',
      content: `CURRENT WHITEBOARD SCENE GRAPH & CONTEXT:\n\`\`\`\n${graphText}\n\`\`\`\n\nUSER COMMAND: "${userText}"`
    }
  ];

  let rawOutput = await callModel(conversation);
  let parsed = parseGraphDiff(extractDiffText(rawOutput));

  // Second turn: the model decided the retrieved excerpts weren't enough and named the
  // notes it wants. This is what makes a retrieval miss recoverable instead of fatal.
  // Exactly one extra round trip — never a loop.
  if (parsed.fetches.length > 0 && store.uploadedDocs.length > 0) {
    const requested = parsed.fetches.slice(0, 4);
    const notes = requested.map((id) => ({ id, text: vectorlessRag.getNote(id, store.uploadedDocs) }));
    const foundCount = notes.filter((n) => n.text).length;

    store.setAiStatus(true, `AI is reading ${foundCount} note(s) from your documents...`);
    store.addChatMessage({
      sender: 'system',
      text: `🔎 AI requested ${requested.length} note(s) before answering: ${requested.join(', ')}${
        foundCount < notes.length ? ` — ${notes.length - foundCount} not found` : ''
      }`
    });

    const noteBlock = notes
      .map((n) => (n.text ? `[${n.id}]:\n${n.text}` : `[${n.id}]: NOT FOUND — no such note ID.`))
      .join('\n\n');

    conversation.push({ role: 'assistant', content: rawOutput });
    conversation.push({
      role: 'user',
      content: `# REQUESTED NOTE CONTENT:\n${noteBlock}\n\nNow carry out the original command using graph diff operations. Do NOT emit any further fetch lines.`
    });

    rawOutput = await callModel(conversation);
    parsed = parseGraphDiff(extractDiffText(rawOutput));
  }

  const { ops, unparsed } = parsed;

  // A dropped line used to be invisible, which is what made a half-executed command look
  // like a complete one.
  if (unparsed.length > 0) {
    store.addChatMessage({
      sender: 'system',
      text: `⚠️ ${unparsed.length} instruction(s) could not be parsed and were NOT applied:\n${unparsed
        .map((l) => `• ${l}`)
        .join('\n')}`
    });
  }

  if (ops.length === 0) {
    store.setAiStatus(false, `AI Response: ${rawOutput}`);
    store.addChatMessage({
      sender: 'ai',
      text: rawOutput,
      modelName: displayModelName
    });
    return;
  }

  const { graph: updatedGraph, renamedIds } = applyDiffToGraph(sceneGraph, ops);

  if (Object.keys(renamedIds).length > 0) {
    const pairs = Object.entries(renamedIds)
      .map(([requested, assigned]) => `${requested} -> ${assigned}`)
      .join(', ');
    store.addChatMessage({
      sender: 'system',
      text: `ℹ️ Node ID already in use, remapped to avoid overwriting an existing node: ${pairs}`
    });
  }

  // Link extracted PDF diagram / Table images to image nodes.
  // Each node is resolved independently from its own label, so a request for several
  // diagrams cannot collapse onto one image. Nodes that resolve to nothing are removed
  // and reported rather than falling back to an arbitrary image.
  const allImages = store.uploadedDocs.flatMap((d) => d.images || []);
  const unresolvedImageNodes: string[] = [];

  // A whole-page scan is unreadable on a projector and buries the slide, so a command that
  // did not ask for several pages gets at most one. Without this cap, one vague follow-up
  // ("the whole section") papered the slide with five full-page photographs.
  const wantsManyPages = MULTI_PAGE_REQUEST.test(userText || '');
  const droppedPageScans: string[] = [];
  let pageScansPlaced = 0;

  Object.values(updatedGraph.nodes).forEach((node) => {
    if (node.type !== 'image' || node.imageUrl) return;

    const resolved = resolveDocImage(node.label, allImages);
    if (!resolved) {
      unresolvedImageNodes.push(node.id);
      return;
    }

    if (resolved.kind === 'page' && !resolved.imageOnly && !wantsManyPages) {
      pageScansPlaced += 1;
      if (pageScansPlaced > 1) {
        droppedPageScans.push(node.id);
        return;
      }
    }

    node.imageUrl = resolved.dataUrl;
    node.label = resolved.caption || resolved.filename;

    // Keep the picture's proportions. Nodes get one default box, so a portrait photo was
    // drawn squashed into a landscape frame. Fit the picture inside that box instead.
    if (resolved.width && resolved.height) {
      const box = { w: Math.max(node.width || 380, 200), h: Math.max(node.height || 260, 200) };
      const scale = Math.min(box.w / resolved.width, box.h / resolved.height);
      node.width = Math.round(resolved.width * scale);
      node.height = Math.round(resolved.height * scale);
    }
  });

  if (droppedPageScans.length > 0) {
    droppedPageScans.forEach((id) => {
      delete updatedGraph.nodes[id];
      Object.values(updatedGraph.edges).forEach((e) => {
        if (e.from === id || e.to === id) delete updatedGraph.edges[e.id];
      });
    });

    store.addChatMessage({
      sender: 'system',
      text: `⚠️ The AI tried to place ${droppedPageScans.length + 1} whole-page scans. Kept the first and dropped ${droppedPageScans.length} — full pages are unreadable on a board. Ask for the section's content, or name the pages explicitly ("put up pages 9 to 12").`
    });
  }

  if (unresolvedImageNodes.length > 0) {
    const availableCaptions = allImages
      .filter((img) => img.kind === 'crop')
      .map((img) => img.caption)
      .filter(Boolean);
    const availableSummary = availableCaptions.length
      ? availableCaptions.slice(0, 6).join('; ') + (availableCaptions.length > 6 ? `; +${availableCaptions.length - 6} more` : '')
      : 'no Table/Figure regions were detected in the uploaded notes';

    unresolvedImageNodes.forEach((id) => {
      const requestedLabel = updatedGraph.nodes[id]?.label || '(unlabelled)';
      delete updatedGraph.nodes[id];
      Object.values(updatedGraph.edges).forEach((e) => {
        if (e.from === id || e.to === id) {
          delete updatedGraph.edges[e.id];
        }
      });

      store.addChatMessage({
        sender: 'system',
        text: `⚠️ No diagram matched "${requestedLabel}" — nothing was placed. Available diagrams: ${availableSummary}`
      });
    });
  }

  // Update Zustand Store & active slide.
  // `store` is a snapshot taken before several seconds of network calls, so slide state is
  // re-read live here: the diff belongs to the slide it was computed against, and writing
  // it to whichever slide happens to be open now would corrupt the wrong board.
  const live = useBoardStore.getState();
  const targetSlideId = store.activeSlideId;
  const slideStillActive = live.activeSlideId === targetSlideId;

  if (slideStillActive) {
    useBoardStore.setState({
      nodes: updatedGraph.nodes,
      edges: updatedGraph.edges
    });
  } else {
    store.addChatMessage({
      sender: 'system',
      text: `ℹ️ You switched slides while the AI was working. The changes were saved to the original slide, not this one.`
    });
  }

  const updatedSlides = live.slides.map((s) =>
    s.id === targetSlideId
      ? { ...s, nodes: updatedGraph.nodes, edges: updatedGraph.edges }
      : s
  );
  useBoardStore.setState({ slides: updatedSlides });

  const appliedCount = ops.length - unresolvedImageNodes.length - droppedPageScans.length;
  const dropReasons: string[] = [];
  if (unresolvedImageNodes.length > 0) dropReasons.push(`${unresolvedImageNodes.length} dropped: diagram not found`);
  if (droppedPageScans.length > 0) dropReasons.push(`${droppedPageScans.length} dropped: excess whole-page scans`);
  const dropNote = dropReasons.length > 0 ? ` (${dropReasons.join('; ')})` : '';

  const aiSummaryText = `Applied ${appliedCount} changes to the board${dropNote}.\n\`\`\`\n${extractDiffText(rawOutput).trim()}\n\`\`\``;
  store.setAiStatus(false, `Applied ${appliedCount} changes${dropNote}!`);

  store.addChatMessage({
    sender: 'ai',
    text: aiSummaryText,
    modelName: displayModelName
  });
}
