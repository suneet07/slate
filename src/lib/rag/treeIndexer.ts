import { TeacherDocument } from './pdfExtractor';
import { NoteTree, NoteTreeNode, leafNoteId, sectionNoteId } from './noteTree';
import { DocHeading, extractHeadings, headingLabel } from './headings';
import { callLlm, extractJson, resolveLlmRoute } from '../ai/llmClient';

/**
 * Builds the LLM note tree for an uploaded document.
 *
 * This is the indexing half of vectorless retrieval. Without it the "index" the model
 * navigates is a flat list of pages, each labelled with its own first 18 raw words — which
 * tells the model nothing, so it can never choose a page deliberately and every lookup
 * falls back to whatever BM25 guessed. One LLM pass at upload time replaces that with
 * titles, topics and summaries the model can actually reason over.
 *
 * The unit being indexed is a heading-delimited SECTION where the document has headings,
 * and a page only where it does not. That distinction is what lets a request for a
 * half-page subsection return the subsection instead of the page it sits on.
 *
 * Cost is bounded and paid once per document, not per query.
 */

/** Words sampled per unit for the labelling pass. Enough to title one, not to re-read it. */
const UNIT_SAMPLE_WORDS = 220;

/** Units per LLM call. Small batches keep each response short enough to stay valid JSON. */
const UNITS_PER_BATCH = 8;

/** A unit with less text than this is a divider or a full-page figure — not worth a call. */
const MIN_UNIT_WORDS = 12;

/** Below this many headings a document has no usable structure; index it by page instead. */
const MIN_HEADINGS_FOR_STRUCTURE = 3;

const UNIT_PASS_SYSTEM = `You index lecture notes so an AI teaching assistant can navigate them.
For each section excerpt you are given, return one JSON object describing it.

Return ONLY a JSON array. No prose, no markdown fences, no commentary.

Each object must have exactly these fields:
{"ref": <number>, "title": "<6-10 word specific title>", "topics": ["<term>", ...], "summary": "<1-2 sentence factual summary>", "has_diagram": <true|false>}

Rules:
- "ref" must be copied exactly from the "--- SECTION <ref> ---" marker above the excerpt.
- The title must name what the excerpt is ABOUT using the document's own terminology. "Bubble Sort Complexity Analysis", not "Page about sorting" and not "Introduction". If the excerpt already carries a printed heading, keep that heading's wording.
- topics: 3-6 technical terms, named entities, theorems, or formulas that actually appear. These are what a teacher would search for. Lowercase. No generic words like "notes" or "chapter".
- summary: state what the excerpt establishes. No filler like "This page discusses".
- has_diagram: true only if the text references a figure, table, chart, or plot.
- If an excerpt is a title page, table of contents, or blank, still return an entry and say so in the title.
- Return one object per excerpt given, in the same order.`;

const SECTION_PASS_SYSTEM = `You organise an indexed lecture document into its section hierarchy.
You are given one line per indexed unit: its ref number, title, and topics.

Return ONLY a JSON array of groups. No prose, no markdown fences.

Each group: {"title": "<group name>", "summary": "<1 sentence on what this group covers>", "topics": ["<term>", ...], "ref_start": <number>, "ref_end": <number>}

Rules:
- Groups must be contiguous ref ranges, in order, and must not overlap.
- Cover every ref from the first to the last. No gaps.
- Group by subject matter, following the document's own structure where the titles reveal it.
- Prefer 3-8 groups. Never emit one group per unit, and never emit a single group covering everything unless the document really is one topic.
- Group titles must be specific to this document's content.`;

export interface TreeIndexProgress {
  phase: 'headings' | 'units' | 'sections' | 'done';
  completed: number;
  total: number;
  message: string;
}

/**
 * One indexable thing: a heading-delimited section, or a page when the document has no
 * headings. `ref` is a stable ordinal used to line LLM output back up with its input.
 */
interface IndexUnit {
  ref: number;
  /** The fetchable ID this unit becomes in the tree. */
  id: string;
  pageNumber: number;
  /** Printed heading where there is one — a strong seed for the LLM's title. */
  printedTitle?: string;
  text: string;
}

interface UnitCard {
  ref: number;
  title: string;
  topics: string[];
  summary: string;
  hasDiagram: boolean;
}

function sampleText(text: string): string {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  return words.length <= UNIT_SAMPLE_WORDS ? words.join(' ') : words.slice(0, UNIT_SAMPLE_WORDS).join(' ');
}

function wordCount(text: string): number {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Chooses what to index. Headings win when the document has them, because a heading is the
 * unit the author wrote; pages are a fallback for scans and unstructured notes.
 */
function buildUnits(doc: TeacherDocument, headings: DocHeading[]): IndexUnit[] {
  if (headings.length >= MIN_HEADINGS_FOR_STRUCTURE) {
    return headings.map((heading, idx) => ({
      ref: idx + 1,
      id: heading.id,
      pageNumber: heading.pageNumber,
      printedTitle: headingLabel(heading),
      text: heading.text
    }));
  }

  return Object.keys(doc.pageTexts || {})
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b)
    .map((pageNumber, idx) => ({
      ref: idx + 1,
      id: leafNoteId(doc.id, pageNumber),
      pageNumber,
      text: doc.pageTexts[pageNumber] || ''
    }));
}

/** Mechanical card used when a unit is too thin to label, or when the LLM pass fails. */
function fallbackCard(unit: IndexUnit): UnitCard {
  const firstLine = unit.text.split(/\n/).find((l) => l.trim().length > 3) || '';
  const words = unit.text.split(/\s+/).filter(Boolean);

  return {
    ref: unit.ref,
    title: unit.printedTitle || firstLine.trim().split(/\s+/).slice(0, 9).join(' ') || `Page ${unit.pageNumber}`,
    topics: [],
    summary: words.slice(0, 28).join(' '),
    hasDiagram: /\b(figure|fig\.|table|chart|diagram|plot)\b/i.test(unit.text)
  };
}

function normalizeTopics(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => typeof t === 'string')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && t.length < 40)
    .slice(0, 6);
}

async function labelUnitBatch(doc: TeacherDocument, units: IndexUnit[]): Promise<UnitCard[]> {
  const excerpts = units
    .map((unit) => {
      const heading = unit.printedTitle ? `Printed heading: ${unit.printedTitle}\n` : '';
      return `--- SECTION ${unit.ref} --- (page ${unit.pageNumber})\n${heading}${sampleText(unit.text)}`;
    })
    .join('\n\n');

  const raw = await callLlm(
    [
      { role: 'system', content: UNIT_PASS_SYSTEM },
      { role: 'user', content: `Document: ${doc.filename}\n\n${excerpts}` }
    ],
    { temperature: 0, maxTokens: 2400 }
  );

  const parsed = extractJson<any[]>(raw);
  if (!Array.isArray(parsed)) throw new Error('unit labelling returned no JSON array');

  // Match on the model's own ref rather than array position — a model that drops or
  // reorders one entry would otherwise shift every remaining label onto the wrong section.
  const byRef = new Map<number, any>();
  parsed.forEach((entry) => {
    const ref = Number(entry?.ref ?? entry?.page);
    if (!Number.isNaN(ref)) byRef.set(ref, entry);
  });

  return units.map((unit) => {
    const entry = byRef.get(unit.ref);
    if (!entry || typeof entry.title !== 'string' || !entry.title.trim()) return fallbackCard(unit);

    return {
      ref: unit.ref,
      title: entry.title.trim().slice(0, 120),
      topics: normalizeTopics(entry.topics),
      summary: typeof entry.summary === 'string' ? entry.summary.trim().slice(0, 400) : '',
      hasDiagram: entry.has_diagram === true
    };
  });
}

interface SectionGroup {
  title: string;
  summary: string;
  topics: string[];
  refStart: number;
  refEnd: number;
}

async function groupIntoSections(doc: TeacherDocument, cards: UnitCard[]): Promise<SectionGroup[]> {
  const outline = cards.map((c) => `${c.ref} | ${c.title} | ${c.topics.join(', ')}`).join('\n');

  const raw = await callLlm(
    [
      { role: 'system', content: SECTION_PASS_SYSTEM },
      { role: 'user', content: `Document: ${doc.filename} (${cards.length} sections)\n\n${outline}` }
    ],
    { temperature: 0, maxTokens: 2000 }
  );

  const parsed = extractJson<any[]>(raw);
  if (!Array.isArray(parsed)) throw new Error('section grouping returned no JSON array');

  return parsed
    .map((entry) => ({
      title: typeof entry?.title === 'string' ? entry.title.trim().slice(0, 140) : '',
      summary: typeof entry?.summary === 'string' ? entry.summary.trim().slice(0, 400) : '',
      topics: normalizeTopics(entry?.topics),
      refStart: Number(entry?.ref_start ?? entry?.page_start),
      refEnd: Number(entry?.ref_end ?? entry?.page_end)
    }))
    .filter((s) => s.title && !Number.isNaN(s.refStart) && !Number.isNaN(s.refEnd) && s.refEnd >= s.refStart)
    .sort((a, b) => a.refStart - b.refStart);
}

/**
 * Assembles units + groups into the tree. Any unit a group failed to claim is attached at
 * the root rather than dropped — an unreachable section is worse than an untidy tree.
 */
function assembleTree(
  doc: TeacherDocument,
  units: IndexUnit[],
  cards: UnitCard[],
  groups: SectionGroup[],
  model: string,
  degraded: boolean
): NoteTree {
  const unitByRef = new Map(units.map((u) => [u.ref, u]));

  const toLeaf = (card: UnitCard): NoteTreeNode | undefined => {
    const unit = unitByRef.get(card.ref);
    if (!unit) return undefined;

    return {
      id: unit.id,
      title: card.title,
      summary: card.summary,
      topics: card.topics,
      pageStart: unit.pageNumber,
      pageEnd: unit.pageNumber,
      hasDiagram: card.hasDiagram
    };
  };

  const claimed = new Set<number>();
  const nodes: NoteTreeNode[] = [];

  groups.forEach((group, idx) => {
    const children = cards
      .filter((c) => c.ref >= group.refStart && c.ref <= group.refEnd && !claimed.has(c.ref))
      .map((c) => {
        claimed.add(c.ref);
        return toLeaf(c);
      })
      .filter((n): n is NoteTreeNode => !!n);

    if (children.length === 0) return;

    nodes.push({
      id: sectionNoteId(doc.id, idx + 1),
      title: group.title,
      summary: group.summary,
      topics: group.topics,
      pageStart: Math.min(...children.map((c) => c.pageStart)),
      pageEnd: Math.max(...children.map((c) => c.pageEnd)),
      hasDiagram: children.some((c) => c.hasDiagram),
      children
    });
  });

  cards
    .filter((c) => !claimed.has(c.ref))
    .forEach((c) => {
      const leaf = toLeaf(c);
      if (leaf) nodes.push(leaf);
    });

  nodes.sort((a, b) => a.pageStart - b.pageStart);

  return {
    docId: doc.id,
    filename: doc.filename,
    generatedAt: new Date().toISOString(),
    model,
    degraded,
    nodes
  };
}

export interface NoteTreeResult {
  tree: NoteTree;
  headings: DocHeading[];
}

/**
 * Runs the full index build. Never throws: a failed LLM pass degrades to the mechanical
 * tree so an upload still works offline or without a key, flagged `degraded` so the UI can
 * say the index is not the real thing.
 */
export async function buildNoteTree(
  doc: TeacherDocument,
  onProgress?: (progress: TreeIndexProgress) => void
): Promise<NoteTreeResult> {
  const report = (progress: TreeIndexProgress) => onProgress && onProgress(progress);

  let modelName = 'unavailable';
  try {
    modelName = resolveLlmRoute().displayName;
  } catch {
    // No key configured — fall through to the mechanical tree below.
  }

  report({ phase: 'headings', completed: 0, total: 1, message: `Reading the structure of ${doc.filename}...` });
  const headings = extractHeadings(doc.id, doc.pageTexts || {});
  const units = buildUnits(doc, headings);

  if (units.length === 0) {
    return { tree: assembleTree(doc, [], [], [], modelName, true), headings };
  }

  // Units with almost no text get a mechanical card; they carry no signal worth an LLM call.
  const substantive = units.filter((u) => wordCount(u.text) >= MIN_UNIT_WORDS);
  const thin = units.filter((u) => wordCount(u.text) < MIN_UNIT_WORDS);

  const batches: IndexUnit[][] = [];
  for (let i = 0; i < substantive.length; i += UNITS_PER_BATCH) {
    batches.push(substantive.slice(i, i + UNITS_PER_BATCH));
  }

  const cards: UnitCard[] = thin.map(fallbackCard);
  let llmFailed = batches.length > 0;

  // Batches run in sequence: the free NVIDIA and Groq tiers rate-limit hard, and a burst of
  // parallel calls turns a slow index into a failed one.
  for (let i = 0; i < batches.length; i++) {
    report({
      phase: 'units',
      completed: i,
      total: batches.length,
      message: `Indexing ${doc.filename} — section ${batches[i][0].ref} of ${units.length}...`
    });

    try {
      cards.push(...(await labelUnitBatch(doc, batches[i])));
      llmFailed = false;
    } catch (err) {
      console.warn(`Note-tree unit pass failed for batch ${i + 1}:`, err);
      cards.push(...batches[i].map(fallbackCard));
    }
  }

  cards.sort((a, b) => a.ref - b.ref);

  if (llmFailed) {
    return { tree: assembleTree(doc, units, cards, [], modelName, true), headings };
  }

  report({ phase: 'sections', completed: batches.length, total: batches.length, message: `Building the outline for ${doc.filename}...` });

  let groups: SectionGroup[] = [];
  if (cards.length > 2) {
    try {
      groups = await groupIntoSections(doc, cards);
    } catch (err) {
      // A flat tree of good unit cards still beats the old preview index by a wide margin.
      console.warn('Note-tree section pass failed, keeping a flat tree:', err);
    }
  }

  report({ phase: 'done', completed: batches.length, total: batches.length, message: `Indexed ${doc.filename}.` });

  return { tree: assembleTree(doc, units, cards, groups, modelName, false), headings };
}
