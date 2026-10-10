/* @ts-nocheck */
import { parseGraphDiff } from '../src/lib/diff/diffParser';
import { applyDiffToGraph } from '../src/lib/diff/layoutEngine';
import { chunkWords as chunkTextForTest } from '../src/lib/rag/pdfExtractor';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

// ---------------------------------------------------------------- Parser: tolerance
{
  const d = parseGraphDiff([
    'add n4 box "Retry Queue" @ B3 [primary]',
    'add n5 box @ B4',                    // no label at all
    'add n6 image Page 2 @ C1',           // unquoted label
    'add n7 circle "Cache"',              // no grid position
    'connect n4 -> n5 "retries"',
    'update n1 label "HTTPS Request"',
    'delete n2'
  ].join('\n'));

  check('all 7 lines parsed', d.ops.length === 7, `ops=${d.ops.length} unparsed=${JSON.stringify(d.unparsed)}`);
  check('nothing reported unparsed', d.unparsed.length === 0, JSON.stringify(d.unparsed));

  const add5 = d.ops.find((o) => o.id === 'n5');
  check('labelless add keeps empty label', add5 && add5.label === '' && add5.gridPos === 'B4', JSON.stringify(add5));

  const add6 = d.ops.find((o) => o.id === 'n6');
  check('unquoted label captured', add6 && add6.label === 'Page 2', JSON.stringify(add6));

  const add7 = d.ops.find((o) => o.id === 'n7');
  check('missing grid position tolerated', add7 && add7.label === 'Cache' && add7.gridPos === undefined, JSON.stringify(add7));

  const add4 = d.ops.find((o) => o.id === 'n4');
  check('colour and grid still parsed', add4 && add4.gridPos === 'B3' && add4.color === 'primary', JSON.stringify(add4));
}

// ---------------------------------------------------------------- Parser: reporting
{
  const d = parseGraphDiff([
    'add n4 box "Good" @ B3',
    'rotate n4 by 90 degrees',      // unsupported instruction
    'add n5 octagon "Bad" @ B4',    // unsupported type
    'This adds the retry queue.'    // prose commentary
  ].join('\n'));

  check('valid op still applied', d.ops.length === 1, `ops=${d.ops.length}`);
  check('unsupported instructions reported', d.unparsed.length === 2, JSON.stringify(d.unparsed));
  check('prose not reported as failure', !d.unparsed.some((l) => l.startsWith('This adds')), JSON.stringify(d.unparsed));
}

// ---------------------------------------------------------------- Parser: no-op update
{
  const d = parseGraphDiff('update n1');
  check('bare update produces no op', d.ops.length === 0, `ops=${d.ops.length}`);
  check('bare update reported', d.unparsed.length === 1, JSON.stringify(d.unparsed));
}

// ---------------------------------------------------------------- Layout: positions preserved
{
  const graph = {
    nodes: {
      n1: { id: 'n1', type: 'box', label: 'Existing A', gridPos: 'A1', x: 777, y: 555, width: 180, height: 70 },
      n2: { id: 'n2', type: 'box', label: 'Existing B', gridPos: 'A2', x: 1200, y: 900, width: 180, height: 70 }
    },
    edges: {},
    ink: {},
    version: 1
  };

  const { graph: out } = applyDiffToGraph(graph, parseGraphDiff('add n3 box "New" @ C2').ops);

  check('existing node keeps exact x/y', out.nodes.n1.x === 777 && out.nodes.n1.y === 555,
    `${out.nodes.n1.x},${out.nodes.n1.y}`);
  check('second existing node untouched', out.nodes.n2.x === 1200 && out.nodes.n2.y === 900,
    `${out.nodes.n2.x},${out.nodes.n2.y}`);
  check('new node honours requested grid position', out.nodes.n3.gridPos === 'C2', out.nodes.n3.gridPos);
}

// ---------------------------------------------------------------- Layout: collision avoidance
{
  const graph = {
    nodes: { n1: { id: 'n1', type: 'box', label: 'Sitting at C2', gridPos: 'C2', x: 280, y: 360, width: 180, height: 70 } },
    edges: {},
    ink: {},
    version: 1
  };
  const { graph: out } = applyDiffToGraph(graph, parseGraphDiff('add n2 box "Also C2" @ C2').ops);

  const a = out.nodes.n1;
  const b = out.nodes.n2;
  const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  check('new node does not land on top of existing', !overlaps, `n1=${a.x},${a.y} n2=${b.x},${b.y}`);
}

// ---------------------------------------------------------------- Layout: ID collision
{
  const graph = {
    nodes: { n4: { id: 'n4', type: 'box', label: 'Teacher owns this', gridPos: 'A1', x: 100, y: 100, width: 180, height: 70 } },
    edges: {},
    ink: {},
    version: 1
  };

  const { graph: out, renamedIds } = applyDiffToGraph(
    graph,
    parseGraphDiff(['add n4 box "Model thinks this is new" @ B2', 'connect n4 -> n4'].join('\n')).ops
  );

  check('existing node survives ID collision', out.nodes.n4.label === 'Teacher owns this', out.nodes.n4.label);
  check('collision reported via renamedIds', Object.keys(renamedIds).length === 1, JSON.stringify(renamedIds));

  const assigned = renamedIds.n4;
  check('new node created under fresh ID', !!assigned && out.nodes[assigned].label === 'Model thinks this is new',
    `assigned=${assigned}`);
  check('later references resolve to the new node',
    Object.values(out.edges).some((e) => e.from === assigned && e.to === assigned),
    JSON.stringify(Object.values(out.edges)));
}

// ---------------------------------------------------------------- Layout: delete still cleans edges
{
  const graph = {
    nodes: {
      n1: { id: 'n1', type: 'box', label: 'A', gridPos: 'A1', x: 40, y: 40, width: 180, height: 70 },
      n2: { id: 'n2', type: 'box', label: 'B', gridPos: 'A2', x: 400, y: 40, width: 180, height: 70 }
    },
    edges: { e_n1_n2: { id: 'e_n1_n2', from: 'n1', to: 'n2' } },
    ink: {},
    version: 1
  };
  const { graph: out } = applyDiffToGraph(graph, parseGraphDiff('delete n2').ops);
  check('deleted node removed', !out.nodes.n2);
  check('dangling edge removed', Object.keys(out.edges).length === 0, JSON.stringify(out.edges));
}

// ---------------------------------------------------------------- Chunking overlap
{
  const words = Array.from({ length: 600 }, (_, i) => `w${i}`);
  const chunks = chunkTextForTest(words);
  check('600 words produce overlapping windows', chunks.length >= 4, `chunks=${chunks.length}`);

  const first = chunks[0].split(' ');
  const second = chunks[1].split(' ');
  const overlap = first.filter((w) => second.includes(w)).length;
  check('consecutive chunks overlap', overlap === 100, `overlap=${overlap} words`);

  const lastWord = words[words.length - 1];
  check('final words are covered', chunks.some((c) => c.split(' ').includes(lastWord)));

  const short = chunkTextForTest(['only', 'a', 'few', 'words']);
  check('short text stays one chunk', short.length === 1, `chunks=${short.length}`);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);

// ---------------------------------------------------------------- Escaped label decoding
{
  // A diff line is one line, so a two-line label can only be written escaped. Passing it
  // through verbatim put a literal backslash-n on the board.
  const d = parseGraphDiff('add n2 text "Non-linear V-I Relationship\\nV ceases to be proportional to I" @ B2');
  const label = d.ops[0].label;
  check('escaped newline becomes a real newline', label.includes('\n') && !label.includes('\\n'), JSON.stringify(label));
  check('label text is otherwise intact', label.startsWith('Non-linear V-I Relationship') && label.endsWith('proportional to I'), JSON.stringify(label));

  const q = parseGraphDiff('add n3 box "Ohm\'s \\"Law\\"" @ A1');
  check('escaped quotes decoded', q.ops[0].label === 'Ohm\'s "Law"', JSON.stringify(q.ops[0].label));

  const plain = parseGraphDiff('add n4 box "Load Balancer" @ A2');
  check('labels without escapes are untouched', plain.ops[0].label === 'Load Balancer', JSON.stringify(plain.ops[0].label));

  const edge = parseGraphDiff('connect n1 -> n2 "step 1\\nthen step 2"');
  check('edge labels decoded too', edge.ops[0].label.includes('\n'), JSON.stringify(edge.ops[0].label));
}
