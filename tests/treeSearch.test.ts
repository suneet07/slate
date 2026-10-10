/* @ts-nocheck */
import './browser-globals';
import { searchNoteTree } from '../src/lib/rag/treeSearch';
import { useBoardStore } from '../src/store/useBoardStore';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

useBoardStore.setState({ llmApiKey: 'test-key', selectedModelId: 'deepseek-ai/deepseek-v4-flash' });

const doc = {
  id: 'doc_1',
  filename: 'leph103.pdf',
  fileSize: 0,
  uploadTimestamp: '',
  totalPages: 2,
  images: [],
  chunks: [],
  pageTexts: { 9: 'page nine text', 10: 'page ten text' },
  headings: [
    { id: 'head_doc_1_1', docId: 'doc_1', number: '3.5', title: "Ohm's Law", level: 2, pageNumber: 9, text: 'V equals I R.' },
    {
      id: 'head_doc_1_2',
      docId: 'doc_1',
      number: '3.6',
      title: "Limitations of Ohm's Law",
      level: 2,
      pageNumber: 9,
      text: 'The deviations are non-linear, non-unique and sign dependent.'
    }
  ],
  tree: {
    docId: 'doc_1',
    filename: 'leph103.pdf',
    generatedAt: '',
    model: 'test-model',
    degraded: false,
    nodes: [
      {
        id: 'sec_doc_1_1',
        title: 'Ohm\'s Law And Its Limits',
        summary: '',
        topics: ['ohm'],
        pageStart: 9,
        pageEnd: 9,
        children: [
          { id: 'head_doc_1_1', title: "Ohm's Law Statement", summary: '', topics: ['ohm'], pageStart: 9, pageEnd: 9 },
          { id: 'head_doc_1_2', title: "Limitations Of Ohm's Law", summary: '', topics: ['deviations'], pageStart: 9, pageEnd: 9 }
        ]
      }
    ]
  }
};

function stubFetch(handler: (payload: any) => string) {
  const sent: any[] = [];
  (globalThis as any).fetch = async (_url: string, init: any) => {
    const payload = JSON.parse(init.body);
    sent.push(payload);
    const content = handler(payload);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }), text: async () => content };
  };
  return sent;
}

// ---------------------------------------------------------------- Happy path
{
  const sent = stubFetch(() =>
    JSON.stringify({ thinking: 'The command asks about limitations, which is 3.6.', node_list: ['head_doc_1_2'] })
  );

  const result = await searchNoteTree('limitations of ohms law', [doc], '');

  check('reasoning trace is returned', result.thinking.includes('limitations'), result.thinking);
  check('selected node returned', result.nodeIds.join() === 'head_doc_1_2', JSON.stringify(result.nodeIds));
  check('section text is fetched, not just the ID', result.context.includes('non-unique'), result.context.slice(0, 80));
  check('context is labelled with the heading', result.context.includes("3.6 Limitations of Ohm's Law"), result.context.slice(0, 80));
  check('the whole index is offered to the model', sent[0].messages[1].content.includes('head_doc_1_1'));
  check('search is a separate call, not the board turn',
    !JSON.stringify(sent[0]).includes('gridPos') && !JSON.stringify(sent[0]).includes('SCENE GRAPH'));
}

// ---------------------------------------------------------------- Expert rules injected
{
  const sent = stubFetch(() => JSON.stringify({ thinking: '', node_list: [] }));
  await searchNoteTree('limitations of ohms law', [doc], '- "limitations" -> the subsection AFTER the law');

  check('expert rules reach the prompt', sent[0].messages[1].content.includes('the subsection AFTER the law'),
    sent[0].messages[1].content.slice(-120));

  const bare = stubFetch(() => JSON.stringify({ thinking: '', node_list: [] }));
  await searchNoteTree('limitations of ohms law', [doc], '');
  check('no rules section when none are set', !bare[0].messages[1].content.includes('EXPERT ROUTING RULES'));
}

// ---------------------------------------------------------------- Pure board commands
{
  stubFetch(() => JSON.stringify({ thinking: 'Board manipulation only.', node_list: [] }));
  const result = await searchNoteTree('connect n1 to n2', [doc], '');

  check('empty selection yields no context', result.context === '', result.context);
  check('empty selection is not a skip', result.skipped === false, String(result.skipped));
}

// ---------------------------------------------------------------- Failure modes fall back
{
  stubFetch(() => 'I think you should look at section 3.6, honestly.');
  const prose = await searchNoteTree('limitations', [doc], '');
  check('unparseable output falls back', prose.skipped === true && prose.nodeIds.length === 0, JSON.stringify(prose.nodeIds));

  (globalThis as any).fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  const dead = await searchNoteTree('limitations', [doc], '');
  check('transport failure falls back rather than throwing', dead.skipped === true, String(dead.skipped));

  stubFetch(() => JSON.stringify({ thinking: '', node_list: ['head_doc_1_99', 'sec_nope_1'] }));
  const bogus = await searchNoteTree('limitations', [doc], '');
  check('invented IDs are dropped, not passed through', bogus.nodeIds.length === 0 && bogus.context === '',
    JSON.stringify(bogus.nodeIds));

  stubFetch(() => JSON.stringify({ thinking: '', node_list: ['head_doc_1_1', 'head_doc_1_2', 'head_doc_1_1', 'head_doc_1_2', 'head_doc_1_1', 'head_doc_1_2'] }));
  const many = await searchNoteTree('everything', [doc], '');
  check('selection is capped', many.nodeIds.length <= 4, String(many.nodeIds.length));
}

// ---------------------------------------------------------------- Un-indexed corpus
{
  stubFetch(() => JSON.stringify({ thinking: '', node_list: ['head_doc_1_2'] }));
  const noTree = await searchNoteTree('limitations', [{ ...doc, tree: undefined }], '');
  check('a document with no tree is skipped', noTree.skipped === true, String(noTree.skipped));

  const noQuery = await searchNoteTree('   ', [doc], '');
  check('empty query is skipped', noQuery.skipped === true, String(noQuery.skipped));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
