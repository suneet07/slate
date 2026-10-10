/* @ts-nocheck */
import { VectorlessRagEngine } from '../src/lib/rag/vectorlessRag';
import { tokenizeText } from '../src/lib/rag/pdfExtractor';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const rag = new VectorlessRagEngine();

let seq = 0;
const chunk = (text: string, page = 1, docId = 'd1') => ({
  id: `c${seq++}`,
  docId,
  filename: 'notes.pdf',
  pageNumber: page,
  text,
  tokens: tokenizeText(text)
});
const doc = (chunks: any[]) => [{ id: 'd1', filename: 'notes.pdf', fileSize: 0, uploadTimestamp: '', totalPages: 3, chunks, images: [] }];

// ---------------------------------------------------------------- Tokenizer
{
  check('stopwords removed', !tokenizeText('the quick brown fox with that').includes('the'), tokenizeText('the quick brown fox with that').join(','));
  check('plural stems to singular', tokenizeText('vectors')[0] === tokenizeText('vector')[0],
    `${tokenizeText('vectors')} vs ${tokenizeText('vector')}`);
  check('recursion/recursive collapse', tokenizeText('recursion')[0] === tokenizeText('recursive')[0],
    `${tokenizeText('recursion')} vs ${tokenizeText('recursive')}`);
  check('sorting/sorted collapse', tokenizeText('sorting')[0] === tokenizeText('sorted')[0],
    `${tokenizeText('sorting')} vs ${tokenizeText('sorted')}`);
  check('algorithms/algorithm collapse', tokenizeText('algorithms')[0] === tokenizeText('algorithm')[0]);
  check('short tokens dropped', tokenizeText('a an of to')/**/.length === 0, tokenizeText('a an of to').join(','));
}

// ---------------------------------------------------------------- Test 1
// Query dilution: a busy board must not outvote the actual question.
{
  const docs = doc([
    chunk('Dijkstra shortest path algorithm relaxes edges using a priority queue to find minimum distance', 1),
    chunk('The load balancer distributes incoming requests across worker nodes and the postgres replica set', 2),
    chunk('Worker nodes pull jobs from the queue and write results back to the postgres database cluster', 3)
  ]);
  // Board is entirely about infrastructure; question is about Dijkstra.
  const boardLabels = ['Load Balancer', 'Worker', 'Postgres', 'Queue', 'Replica Set', 'Requests', 'Cluster'];

  const out = rag.retrieveExcerpts('explain the dijkstra shortest path algorithm', boardLabels, [], docs, 5);
  check('question beats board context', out.length > 0 && out[0].text.startsWith('Dijkstra'),
    out.length ? out[0].text.slice(0, 40) : 'no results');
}

// ---------------------------------------------------------------- Test 2
// Repeated board terms must not multiply a term's weight.
{
  const docs = doc([
    chunk('the postgres database stores durable records on disk', 1),
    chunk('binary search tree traversal visits nodes in order', 2)
  ]);
  const once = rag.retrieveExcerpts('binary search tree', ['Postgres'], [], docs, 5);
  const many = rag.retrieveExcerpts('binary search tree', ['Postgres', 'Postgres', 'Postgres', 'Postgres', 'Postgres'], [], docs, 5);
  check('repeated board label does not change ranking', once[0].text === many[0].text, `${once[0].text.slice(0, 20)} / ${many[0].text.slice(0, 20)}`);
  check('repeated board label does not change score', Math.abs(once[0].score - many[0].score) < 1e-9,
    `${once[0].score.toFixed(4)} vs ${many[0].score.toFixed(4)}`);
}

// ---------------------------------------------------------------- Test 3
// Stemming makes a plural query hit a singular document term.
{
  const docs = doc([
    chunk('a vector is an ordered list of numbers used in linear algebra', 1),
    chunk('the http request travels to the load balancer', 2)
  ]);
  const out = rag.retrieveExcerpts('what are vectors', [], [], docs, 5);
  check('plural query matches singular text', out.length > 0 && out[0].text.includes('vector'),
    out.length ? out[0].text.slice(0, 30) : 'no results');
}

// ---------------------------------------------------------------- Test 4
// Page diversity: many strong chunks on one page must not fill the whole result.
{
  const chunks: any[] = [];
  for (let i = 0; i < 6; i++) chunks.push(chunk('quicksort partition pivot recursion divide conquer', 1));
  chunks.push(chunk('quicksort pivot selection strategies median of three', 2));
  chunks.push(chunk('quicksort worst case pivot behaviour on sorted input', 3));

  const out = rag.retrieveExcerpts('quicksort pivot', [], [], doc(chunks), 5);
  const page1 = out.filter((e) => e.pageNumber === 1).length;
  check('at most 2 chunks per page', page1 <= 2, `page1 count=${page1}`);
  check('other pages represented', new Set(out.map((e) => e.pageNumber)).size > 1,
    JSON.stringify(out.map((e) => e.pageNumber)));
}

// ---------------------------------------------------------------- Test 5
// Relative cutoff: weak tangential chunks are dropped, not padded in to fill topK.
{
  const docs = doc([
    chunk('tcp three way handshake syn synack ack establishes the connection', 1),
    chunk('completely unrelated content about baking sourdough bread at home', 2),
    chunk('another unrelated passage concerning garden soil and compost', 3)
  ]);
  const out = rag.retrieveExcerpts('tcp three way handshake', [], [], docs, 5);
  check('weak chunks cut by relative threshold', out.length === 1, `returned ${out.length}`);
  check('correct chunk kept', out[0].text.startsWith('tcp'), out[0].text.slice(0, 20));
}

// ---------------------------------------------------------------- Test 6
// Handwriting is advisory only — noisy TrOCR must not override the spoken query.
{
  const docs = doc([
    chunk('mitosis divides one cell into two identical daughter cells', 1),
    chunk('photosynthesis converts light energy into chemical energy in chloroplasts', 2)
  ]);
  const out = rag.retrieveExcerpts('explain photosynthesis', [], ['mitosis mitosis mitosis cell'], docs, 5);
  check('spoken query outweighs handwriting', out[0].text.includes('photosynthesis'), out[0].text.slice(0, 30));
}

// ---------------------------------------------------------------- Test 7
// Empty / no-signal inputs stay safe.
{
  check('no documents returns empty', rag.retrieveExcerpts('anything', [], [], [], 5).length === 0);
  check('empty query with empty board returns empty', rag.retrieveExcerpts('', [], [], doc([chunk('some text here', 1)]), 5).length === 0);
  const noMatch = rag.retrieveExcerpts('zzzz qqqq wwww', [], [], doc([chunk('some text here about trees', 1)]), 5);
  check('no matching terms returns empty', noMatch.length === 0, `returned ${noMatch.length}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
