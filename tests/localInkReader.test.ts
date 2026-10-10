/* @ts-nocheck */
/**
 * The local handwriting reader: real-board writing must read, pictures must not.
 *
 * Every case here came from a failure that actually happened. The "HI" was traced off a
 * real board where the first version called the letters "a tree or umbrella" and "a boat
 * or bowl"; the boxes and the sun are the pictures that broke when writing was allowed to
 * be any size.
 */
import { readInkLocally } from '../src/lib/ocr/localInkReader';
import { GLYPHS } from '../src/lib/ocr/glyphs';
import { lineMetrics, recognizeWord } from '../src/lib/ocr/handwriting';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const strokes = (polys: number[][][]) => polys.map((points, i) => ({ id: `ink${i}`, points }));

// ---------------------------------------------------------------- big writing

const hi = readInkLocally(
  strokes([
    [[302, 222], [308, 300], [314, 400], [322, 508]], // H, left stem
    [[400, 215], [408, 290], [420, 400], [430, 505]], // H, right stem
    [[288, 353], [330, 350], [380, 347], [425, 345]], // H, crossbar overshooting left
    [[525, 228], [580, 227], [640, 228], [683, 227]], // I, top serif
    [[610, 232], [608, 320], [606, 430], [605, 505]], // I, stem
    [[538, 498], [590, 503], [640, 500], [675, 502]] // I, bottom serif
  ])
);
check('letters three cells tall are read as writing', hi.length === 1, `${hi.length} line(s)`);
check('it reads HI, with I/l/1 offered for the model', /^H\[?I/.test(hi[0]?.text ?? ''), hi[0]?.text);
check('confidently', hi[0] && !hi[0].uncertain, `confidence ${hi[0]?.confidence.toFixed(2)}`);
check('all six strokes belong to the line', hi[0]?.strokeIds.length === 6, `${hi[0]?.strokeIds.length}`);

// ------------------------------------------------------------ clean glyph words

function writeWord(text: string, x0 = 150, cap = 70): number[][][] {
  const out: number[][][] = [];
  let x = x0;
  for (const ch of text) {
    const glyph = GLYPHS.find((g) => g.char === ch)!;
    const wide = cap * (glyph.aspect ?? 0.7);
    for (const stroke of glyph.strokes) out.push(stroke.map(([gx, gy]) => [x + gx * wide, 200 + gy * cap]));
    x += wide + cap * 0.3;
  }
  return out;
}

const cat = readInkLocally(strokes(writeWord('CAT')));
check('CAT is one line', cat.length === 1, `${cat.length}`);
check('CAT reads as CAT', /^\[?C.*AT$/.test(cat[0]?.text ?? ''), cat[0]?.text);

const earth = readInkLocally(strokes(writeWord('EARTH')));
check('EARTH is not split at the T', earth[0]?.text.split(' ').length === 1, earth[0]?.text);
check('EARTH reads as EARTH', earth[0]?.text === 'EARTH', earth[0]?.text);

// ------------------------------------------------------- pictures stay pictures

const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const circle = (cx, cy, r) =>
  Array.from({ length: 25 }, (_, i) => {
    const t = (i / 24) * Math.PI * 2;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
  });

check('two boxes are not the word OO', readInkLocally(strokes([box(200, 200, 180, 200), box(460, 200, 180, 200)])).length === 0);
check(
  'a sun is not a word',
  readInkLocally(
    strokes([
      circle(400, 300, 90),
      [[400, 180], [400, 140]],
      [[400, 420], [400, 460]],
      [[280, 300], [240, 300]],
      [[520, 300], [560, 300]]
    ])
  ).length === 0
);
check('a house is not a word', readInkLocally(strokes([box(250, 300, 220, 200), [[250, 300], [360, 180], [470, 300]]])).length === 0);
check('a single stroke is never writing', readInkLocally(strokes([circle(300, 300, 80)])).length === 0);
check('nothing on the board reads as nothing', readInkLocally([]).length === 0);

// -------------------------------------------------------- recogniser accuracy

// Every glyph drawn cleanly must at least be OFFERED to the model, even when it is the
// twin of another letter (I/l/1, O/0) and so cannot be the sole top choice.
let offered = 0;
for (const g of GLYPHS) {
  const pts = g.strokes.map((s, i) => {
    const points = s.map(([x, y]) => ({ x: 100 + x * 60 * (g.aspect ?? 0.7), y: 100 + y * 60 }));
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
      name: `s${i}`,
      points,
      bounds: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
    };
  });
  const w = recognizeWord(pts, lineMetrics([{ x: 100, y: 100, w: 40, h: 60 }]));
  const c = w.chars[0];
  const choices = c ? [c.char, ...c.alternatives].map((x) => x.toLowerCase()) : [];
  if (w.chars.length === 1 && choices.includes(g.char.toLowerCase())) offered++;
}
check('every clean glyph reaches the model as a choice', offered === GLYPHS.length, `${offered}/${GLYPHS.length}`);

console.log(failures === 0 ? '\nALL PASS' : `\nFAILURE: ${failures} check(s) failed`);
if (failures > 0) process.exitCode = 1;
