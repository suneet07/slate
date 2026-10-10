import { TeacherDocument } from './pdfExtractor';
import { renderNoteTree } from './noteTree';
import { vectorlessRag } from './vectorlessRag';
import { callLlm, extractJson } from '../ai/llmClient';

/**
 * Reasoning-based retrieval: a dedicated call whose only job is to choose what to read.
 *
 * Folding retrieval into the board-command turn made the model pick sections and write a
 * diff in one breath, with no way to see why it chose what it chose. Separating it costs
 * one round trip and buys a reasoning trace — which is the difference between debugging a
 * bad answer and guessing at it.
 *
 * This is the step that replaces cosine similarity. Nothing here is lexical.
 */

/** IDs the model may request in one search. More than this and the context stops being a sample. */
const MAX_SELECTED_NODES = 4;

const SEARCH_SYSTEM = `You are the retrieval step of a teaching assistant that draws on a teacher's own lecture notes.

You are given a command and the note index: a tree of every section in the notes, with IDs, titles, topics and summaries.
Your ONLY job is to decide which sections must be read to carry out the command correctly. You do not answer the command.

Return ONLY JSON, no prose and no markdown fences:
{"thinking": "<short reasoning: what the command needs, and which titles match it>", "node_list": ["<id>", "<id>"]}

Rules:
- Choose IDs exactly as they appear in the index. Never invent one.
- Prefer the most specific section that covers the command. Choose a parent [SECTION ...] only when the command genuinely spans its children.
- Choose at most ${MAX_SELECTED_NODES} IDs. Fewer is better: a precise section beats three loose ones.
- If the command is pure board manipulation ("connect n1 to n2", "make the box red") and needs nothing from the notes, return an empty node_list.
- Judge by what the section IS ABOUT, not by shared words. A section that merely mentions the term in passing is the wrong choice.`;

export interface TreeSearchResult {
  thinking: string;
  nodeIds: string[];
  /** Section text, keyed and labelled by ID, ready to drop into the prompt. */
  context: string;
  /** True when no tree was available, so nothing could be reasoned over. */
  skipped: boolean;
}

const EMPTY: TreeSearchResult = { thinking: '', nodeIds: [], context: '', skipped: true };

/**
 * Asks the model which sections to read, then reads them.
 *
 * Expert rules are injected verbatim. They are routing knowledge — "derivations live in the
 * section that states the law" — and injecting them here is what makes domain expertise a
 * prompt edit rather than an embedding fine-tune.
 */
export async function searchNoteTree(
  query: string,
  documents: TeacherDocument[],
  expertRules: string = ''
): Promise<TreeSearchResult> {
  const indexed = documents.filter((d) => d.tree && d.tree.nodes.length > 0);
  if (indexed.length === 0 || !query.trim()) return EMPTY;

  const index = indexed
    .map((doc) => `## ${doc.filename}\n${renderNoteTree(doc.tree!)}`)
    .join('\n\n');

  const rules = expertRules.trim()
    ? `\n\nEXPERT ROUTING RULES — follow these when they apply:\n${expertRules.trim()}`
    : '';

  let raw: string;
  try {
    raw = await callLlm(
      [
        { role: 'system', content: SEARCH_SYSTEM },
        { role: 'user', content: `COMMAND: "${query}"\n\nNOTE INDEX:\n${index}${rules}` }
      ],
      { temperature: 0, maxTokens: 1200 }
    );
  } catch (err) {
    // Retrieval failing must not fail the command: the caller still has BM25 and the index.
    console.warn('Tree search failed, falling back to lexical retrieval:', err);
    return EMPTY;
  }

  const parsed = extractJson<{ thinking?: string; node_list?: string[] }>(raw);
  if (!parsed || !Array.isArray(parsed.node_list)) {
    console.warn('Tree search returned no usable JSON, falling back to lexical retrieval.');
    return EMPTY;
  }

  const nodeIds = parsed.node_list
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim())
    .slice(0, MAX_SELECTED_NODES);

  if (nodeIds.length === 0) {
    return { thinking: parsed.thinking || '', nodeIds: [], context: '', skipped: false };
  }

  const blocks: string[] = [];
  const resolved: string[] = [];

  nodeIds.forEach((id) => {
    const text = vectorlessRag.getNote(id, documents);
    if (!text) return;
    resolved.push(id);
    blocks.push(`[${id}]:\n${text}`);
  });

  return {
    thinking: parsed.thinking || '',
    nodeIds: resolved,
    context: blocks.length > 0 ? `# SECTIONS SELECTED BY REASONING OVER THE NOTE INDEX:\n${blocks.join('\n\n')}` : '',
    skipped: false
  };
}
