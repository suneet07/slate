/* @ts-nocheck */
import { VectorlessRagEngine } from '../src/lib/rag/vectorlessRag';
import { parseGraphDiff } from '../src/lib/diff/diffParser';
import { tokenizeText } from '../src/lib/rag/pdfExtractor';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const rag = new VectorlessRagEngine();

const makeDoc = (id: string, filename: string, pageTexts: Record<number, string>) => ({
  id,
  filename,
  fileSize: 0,
  uploadTimestamp: '',
  totalPages: Object.keys(pageTexts).length,
  images: [],
  pageTexts,
  chunks: Object.entries(pageTexts).map(([page, text], i) => ({
    id: `${id}_c${i}`,
    docId: id,
    filename,
    pageNumber: Number(page),
    text,
    tokens: tokenizeText(text)
  }))
});

const docs = [
  makeDoc('doc_abc_1', 'lecture.pdf', {
    1: 'Introduction to graph traversal and the breadth first search frontier',
    2: 'Dijkstra maintains a priority queue keyed by tentative distance',
    3: 'Bellman Ford tolerates negative edge weights by relaxing every edge V minus one times'
  }),
  makeDoc('doc_xyz_2', 'bio.pdf', {
    1: 'Chloroplasts contain thylakoid membranes stacked into grana'
  })
];

// ---------------------------------------------------------------- Fetch line parsing
{
  const d = parseGraphDiff(['fetch note_doc_abc_1_p2', 'fetch note_doc_abc_1_p3'].join('\n'));
  check('fetch lines parsed', d.fetches.length === 2, JSON.stringify(d.fetches));
  check('fetch lines are not ops', d.ops.length === 0, `ops=${d.ops.length}`);
  check('fetch lines not reported as unparsed', d.unparsed.length === 0, JSON.stringify(d.unparsed));

  const dup = parseGraphDiff(['fetch note_a_p1', 'fetch note_a_p1'].join('\n'));
  check('duplicate fetches collapsed', dup.fetches.length === 1, JSON.stringify(dup.fetches));

  const alt = parseGraphDiff(['get_note note_a_p1', 'read note_b_p2', 'fetch("note_c_p3")'].join('\n'));
  check('alternate fetch spellings accepted', alt.fetches.length === 3, JSON.stringify(alt.fetches));

  const mixed = parseGraphDiff(['fetch note_doc_abc_1_p2', 'add n1 box "Queue" @ A1'].join('\n'));
  check('fetch alongside ops both captured', mixed.fetches.length === 1 && mixed.ops.length === 1,
    `fetches=${mixed.fetches.length} ops=${mixed.ops.length}`);
}

// ------------------------------------------------- Note index, un-indexed (no LLM tree)
{
  const index = rag.buildNoteIndex(docs);
  check('un-indexed doc still lists every page',
    ['p1', 'p2', 'p3'].every((p) => index.includes(`note_doc_abc_1_${p}`)), index);
  check('un-indexed state is stated', index.includes('Not indexed yet'), index);
  check('index shows filename', index.includes('lecture.pdf'), index);
  check('index carries a preview', index.includes('Dijkstra'), index);
  check('index spans multiple documents', index.includes('note_doc_xyz_2_p1'), index);
}

// ------------------------------------------------- Note index, with an LLM-built tree
{
  const treeDocs = [
    {
      ...docs[0],
      tree: {
        docId: 'doc_abc_1',
        filename: 'lecture.pdf',
        generatedAt: '2026-01-01T00:00:00.000Z',
        model: 'test-model',
        nodes: [
          {
            id: 'sec_doc_abc_1_1',
            title: 'Shortest Path Algorithms',
            summary: 'Covers single-source shortest paths on weighted graphs.',
            topics: ['dijkstra', 'bellman ford'],
            pageStart: 2,
            pageEnd: 3,
            children: [
              {
                id: 'note_doc_abc_1_p2',
                title: 'Dijkstra Priority Queue Relaxation',
                summary: 'Dijkstra keeps a priority queue keyed by tentative distance.',
                topics: ['dijkstra', 'priority queue'],
                pageStart: 2,
                pageEnd: 2
              },
              {
                id: 'note_doc_abc_1_p3',
                title: 'Bellman Ford With Negative Weights',
                summary: 'Relaxes every edge V-1 times to tolerate negative weights.',
                topics: ['bellman ford', 'negative weights'],
                pageStart: 3,
                pageEnd: 3
              }
            ]
          },
          {
            id: 'note_doc_abc_1_p1',
            title: 'Graph Traversal Introduction',
            summary: 'Introduces the BFS frontier.',
            topics: ['bfs', 'traversal'],
            pageStart: 1,
            pageEnd: 1
          }
        ]
      }
    }
  ];

  const index = rag.buildNoteIndex(treeDocs);
  check('tree index shows LLM titles', index.includes('Dijkstra Priority Queue Relaxation'), index);
  check('tree index shows topics', index.includes('topics: dijkstra, priority queue'), index);
  check('tree index shows sections', index.includes('[SECTION sec_doc_abc_1_1]'), index);
  check('tree index nests pages under their section',
    index.indexOf('sec_doc_abc_1_1') < index.indexOf('note_doc_abc_1_p2'), index);
  check('tree index does not fall back to raw previews', !index.includes('Not indexed yet'), index);

  // A section ID must resolve to all of its pages, or the model's fetch silently fails
  const section = rag.getNote('sec_doc_abc_1_1', treeDocs) || '';
  check('section fetch returns its pages', section.includes('Dijkstra') && section.includes('Bellman Ford'), section);
  check('section fetch excludes pages outside its range', !section.includes('breadth first search'), section);
  check('unknown section returns undefined', rag.getNote('sec_doc_abc_1_9', treeDocs) === undefined);
  check('section fetch labels its pages', section.includes('[p.2]') && section.includes('[p.3]'), section);

  // A section longer than the budget must drop WHOLE pages and say which, never trail off
  // mid-sentence — a half-read section that looks complete is worse than a short one.
  const bulk = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' ');
  const bigDocs = [
    {
      ...treeDocs[0],
      pageTexts: { 1: bulk, 2: bulk, 3: bulk, 4: bulk },
      tree: {
        ...treeDocs[0].tree,
        nodes: [
          {
            id: 'sec_doc_abc_1_1',
            title: 'Long Section',
            summary: '',
            topics: [],
            pageStart: 1,
            pageEnd: 4,
            children: [1, 2, 3, 4].map((p) => ({
              id: `note_doc_abc_1_p${p}`,
              title: `Page ${p}`,
              summary: '',
              topics: [],
              pageStart: p,
              pageEnd: p
            }))
          }
        ]
      }
    }
  ];

  const long = rag.getNote('sec_doc_abc_1_1', bigDocs) || '';
  check('oversized section stays within budget', long.split(/\s+/).length < 3200, `words=${long.split(/\s+/).length}`);
  check('oversized section reports what it omitted', long.includes('Section continues on page(s)'),
    long.slice(-140));
  check('oversized section keeps whole pages only',
    !/word1499\s+word0/.test(long) && long.includes('word1499'), long.slice(-60));

  // The tree's own titles must lift ranking, not just decorate the prompt
  const withTree = rag.retrieveExcerpts('negative weights', [], [], treeDocs, 3);
  check('title/topic match ranks the right page first',
    withTree.length > 0 && withTree[0].pageNumber === 3,
    JSON.stringify(withTree.map((e) => e.pageNumber)));
}

// ---------------------------------------------------------------- getNote
{
  check('getNote returns exact page text',
    rag.getNote('note_doc_abc_1_p3', docs) === docs[0].pageTexts[3],
    rag.getNote('note_doc_abc_1_p3', docs));

  check('getNote resolves a second document',
    (rag.getNote('note_doc_xyz_2_p1', docs) || '').includes('thylakoid'));

  check('unknown doc returns undefined', rag.getNote('note_missing_p1', docs) === undefined);
  check('unknown page returns undefined', rag.getNote('note_doc_abc_1_p99', docs) === undefined);
  check('malformed id returns undefined', rag.getNote('not-a-note-id', docs) === undefined);
  check('empty id returns undefined', rag.getNote('', docs) === undefined);

  // Every ID the index advertises must actually resolve
  const ids = (rag.buildNoteIndex(docs).match(/\b(?:note|sec)_\S+/g) || []);
  check('index advertises at least one ID', ids.length > 0, JSON.stringify(ids));
  check('every advertised index ID resolves', ids.every((id) => rag.getNote(id, docs) !== undefined),
    JSON.stringify(ids));
}

// ---------------------------------------------------------------- Long note truncation
{
  const longText = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
  const bigDocs = [makeDoc('doc_big_9', 'big.pdf', { 1: longText })];
  const note = rag.getNote('note_doc_big_9_p1', bigDocs);
  const wordCount = note.split(/\s+/).length;
  check('long note truncated to budget', wordCount < 1210, `words=${wordCount}`);
  check('truncation is marked', note.includes('[truncated]'));
}

// ---------------------------------------------------------------- Corpus scope disclosure
{
  const excerpts = rag.retrieveExcerpts('dijkstra priority queue', [], [], docs, 5);
  const prompt = rag.formatExcerptsForPrompt(excerpts, docs);
  check('prompt states corpus size', /out of \d+ in the notes/.test(prompt), prompt.split('\n')[1] || '');
  check('prompt points at the fetch escape hatch', prompt.includes('fetch a note'), prompt.split('\n')[1] || '');

  const noDocs = rag.formatExcerptsForPrompt(excerpts, []);
  check('no scope line when corpus size unknown', !noDocs.includes('out of'), noDocs.split('\n')[1] || '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
