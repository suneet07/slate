/* @ts-nocheck */
import './browser-globals';
import { buildNoteTree } from '../src/lib/rag/treeIndexer';
import { useBoardStore } from '../src/store/useBoardStore';
import { collectLeaves, findTreeNode } from '../src/lib/rag/noteTree';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

// A route needs a key, or every call throws before reaching the stubbed fetch
useBoardStore.setState({ llmApiKey: 'test-key', selectedModelId: 'deepseek-ai/deepseek-v4-flash' });

const makeDoc = (id: string, pageTexts: Record<number, string>) => ({
  id,
  filename: 'lecture.pdf',
  fileSize: 0,
  uploadTimestamp: '',
  totalPages: Object.keys(pageTexts).length,
  images: [],
  chunks: [],
  pageTexts
});

const longPage = (topic: string) =>
  `${topic} ` + Array.from({ length: 40 }, (_, i) => `${topic}word${i}`).join(' ');

const pageTexts: Record<number, string> = {};
for (let p = 1; p <= 10; p++) pageTexts[p] = longPage(`topic${p}`);
const doc = makeDoc('doc_1', pageTexts);

/** Installs a fetch stub that answers with `bodies[callIndex]` as an OpenAI completion. */
function stubFetch(handler: (payload: any, callIndex: number) => string) {
  let calls = 0;
  const sent: any[] = [];

  (globalThis as any).fetch = async (_url: string, init: any) => {
    const payload = JSON.parse(init.body);
    sent.push(payload);
    const content = handler(payload, calls++);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content
    };
  };

  return { sent, callCount: () => calls };
}

/** Refs in a batch, read from the "--- SECTION n ---" markers the indexer writes. */
const refsIn = (payload: any) =>
  [...payload.messages[1].content.matchAll(/--- SECTION (\d+) ---/g)].map((m) => Number(m[1]));

const pageAnswer = (payload: any) =>
  JSON.stringify(
    refsIn(payload).map((ref) => ({
      ref,
      title: `Title For Page ${ref}`,
      topics: [`topic${ref}`, 'shared'],
      summary: `Summary of page ${ref}.`,
      has_diagram: ref === 4
    }))
  );

// ---------------------------------------------------------------- Happy path
{
  const sections = JSON.stringify([
    { title: 'First Half', summary: 'Opening material.', topics: ['topic1'], ref_start: 1, ref_end: 5 },
    { title: 'Second Half', summary: 'Later material.', topics: ['topic6'], ref_start: 6, ref_end: 10 }
  ]);

  const stub = stubFetch((payload, i) => (i < 2 ? pageAnswer(payload) : sections));
  const { tree } = await buildNoteTree(doc);

  check('batches pages rather than one call per page', stub.callCount() === 3, `calls=${stub.callCount()}`);
  check('tree is not degraded', tree.degraded === false, String(tree.degraded));
  check('two sections at the root', tree.nodes.length === 2, JSON.stringify(tree.nodes.map((n) => n.title)));
  check('every page is reachable', collectLeaves(tree).length === 10, `leaves=${collectLeaves(tree).length}`);
  check('leaf IDs are fetchable', !!findTreeNode(tree, 'note_doc_1_p7'));
  check('section IDs are fetchable', !!findTreeNode(tree, 'sec_doc_1_2'));
  check('LLM titles are kept', findTreeNode(tree, 'note_doc_1_p7').title === 'Title For Page 7',
    findTreeNode(tree, 'note_doc_1_p7').title);
  check('topics are normalised', findTreeNode(tree, 'note_doc_1_p7').topics.includes('topic7'));
  check('section page range is derived from its children',
    tree.nodes[1].pageStart === 6 && tree.nodes[1].pageEnd === 10,
    `${tree.nodes[1].pageStart}-${tree.nodes[1].pageEnd}`);
  check('diagram flag propagates to the section', tree.nodes[0].hasDiagram === true);
  check('indexing sends no board state, only page text',
    !JSON.stringify(stub.sent).includes('gridPos'));
}

// ------------------------------------------- Out-of-order model output must not shift labels
{
  stubFetch((payload, i) => {
    if (i >= 2) return '[]';
    const entries = refsIn(payload).map((ref) => ({
      ref,
      title: `Title For Page ${ref}`,
      topics: [`topic${ref}`],
      summary: '',
      has_diagram: false
    }));
    return JSON.stringify(entries.reverse());
  });

  const { tree } = await buildNoteTree(doc);
  const misaligned = collectLeaves(tree).filter((leaf) => leaf.title !== `Title For Page ${leaf.pageStart}`);
  check('reordered LLM output still lands on the right pages', misaligned.length === 0,
    JSON.stringify(misaligned.map((m) => [m.pageStart, m.title])));
}

// ---------------------------------------------------------------- Bad JSON degrades, never throws
{
  stubFetch(() => 'Sure! Here are the pages you asked about, but not as JSON.');
  const { tree } = await buildNoteTree(doc);

  check('unparseable output is flagged degraded', tree.degraded === true, String(tree.degraded));
  check('degraded tree still reaches every page', collectLeaves(tree).length === 10,
    `leaves=${collectLeaves(tree).length}`);
  check('degraded tree still uses fetchable IDs', !!findTreeNode(tree, 'note_doc_1_p3'));
}

// ---------------------------------------------------------------- Transport failure degrades
{
  (globalThis as any).fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  const { tree } = await buildNoteTree(doc);

  check('network failure does not throw', tree.nodes.length > 0, `nodes=${tree.nodes.length}`);
  check('network failure is flagged degraded', tree.degraded === true, String(tree.degraded));
}

// ---------------------------------------------------------------- Fenced JSON is accepted
{
  stubFetch((payload, i) =>
    i < 2 ? '```json\n' + pageAnswer(payload) + '\n```' : '```json\n[]\n```'
  );
  const { tree } = await buildNoteTree(doc);
  check('fenced JSON parses', tree.degraded === false && findTreeNode(tree, 'note_doc_1_p1').title === 'Title For Page 1',
    JSON.stringify({ degraded: tree.degraded }));
}

// ---------------------------------------------------------------- Thin pages skip the model
{
  const thinDoc = makeDoc('doc_2', { 1: 'Chapter 3', 2: longPage('real'), 3: '' });
  const stub = stubFetch((payload, i) => (i === 0 ? pageAnswer(payload) : '[]'));
  const { tree } = await buildNoteTree(thinDoc);

  const sentPages = JSON.stringify(stub.sent[0].messages[1].content).match(/--- SECTION (\d+) ---/g) || [];
  check('near-empty pages are not sent to the model', sentPages.length === 1, JSON.stringify(sentPages));
  check('near-empty pages are still in the tree', collectLeaves(tree).length === 3,
    `leaves=${collectLeaves(tree).length}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
