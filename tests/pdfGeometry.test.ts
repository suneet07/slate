/* @ts-nocheck */
import {
  buildTextLines,
  computeCaptionCropRegion,
  detectColumnBounds,
  CAPTION_REGEX,
  normalizeCaptionKind
} from '../src/lib/rag/pdfExtractor';

const SCALE = 1.5;
const PAGE_H_PT = 792;
const CANVAS_H = PAGE_H_PT * SCALE;
const CANVAS_W = 612 * SCALE;

const viewport = {
  convertToViewportPoint: (x: number, y: number) => [x * SCALE, (PAGE_H_PT - y) * SCALE]
};

// run: [text, pdfX, pdfY, widthPt, heightPt]
const item = (str: string, x: number, y: number, w: number, h = 10) => ({
  str,
  width: w,
  height: h,
  transform: [h, 0, 0, h, x, y]
});

const tc = (items: any[]) => ({ items });

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

// ---------------------------------------------------------------- Test 1
// PDF.js splits "Table" and "2" into separate runs on the same baseline.
{
  const lines = buildTextLines(
    tc([item('Table', 50, 700, 38), item('2', 91, 700, 8), item('Sorting results', 104, 700, 90)]),
    viewport,
    SCALE
  );
  check('split runs join into one line', lines.length === 1, JSON.stringify(lines.map((l) => l.text)));
  const m = lines[0].text.match(CAPTION_REGEX);
  check('joined line matches caption regex', !!m, lines[0].text);
  check('caption number parsed', m && m[2] === '2', m && m[2]);
  check('caption title parsed', m && m[4] === 'Sorting results', m && m[4]);
}

// ---------------------------------------------------------------- Test 2
// Table caption above 8 rows, then a prose paragraph. Crop must cover all rows,
// stop at the prose, and NOT be capped at the old 450px.
{
  const items = [item('Table', 50, 700, 38), item('1', 91, 700, 8), item('Runtimes', 104, 700, 60)];
  // 8 table rows, 20pt apart, each with a wide intra-line gap (two columns)
  for (let i = 0; i < 8; i++) {
    const y = 680 - i * 20;
    items.push(item(`algo${i}`, 50, y, 40));
    items.push(item(`O(n${i})`, 200, y, 40)); // gap of 110pt -> counts as column gap
  }
  // prose paragraph after the table, continuous runs
  for (let i = 0; i < 4; i++) {
    const y = 500 - i * 14;
    items.push(item('as shown above the results are', 50, y, 200));
  }

  const lines = buildTextLines(tc(items), viewport, SCALE);
  const cap = lines.find((l) => CAPTION_REGEX.test(l.text))!;
  check('table rows flagged with column gaps', lines.filter((l) => l.gapCount > 0).length === 8,
    String(lines.filter((l) => l.gapCount > 0).length));

  const r = computeCaptionCropRegion(cap, 'table', lines, CANVAS_W, CANVAS_H);
  const lastRowBottomPt = 680 - 7 * 20; // 540pt
  const expectBottomCanvas = (PAGE_H_PT - lastRowBottomPt) * SCALE;
  check('crop reaches last table row', r.y + r.h >= expectBottomCanvas, `bottom=${(r.y + r.h).toFixed(0)} need>=${expectBottomCanvas.toFixed(0)}`);
  check('crop stops before prose block', r.y + r.h < (PAGE_H_PT - 500) * SCALE + 40, `bottom=${(r.y + r.h).toFixed(0)}`);
  check('crop taller than old 450px cap is allowed', r.h > 200, `h=${r.h.toFixed(0)}`);
}

// ---------------------------------------------------------------- Test 3
// Figure caption sits BELOW the graphic. Old code cropped downward (wrong).
// Crop must extend upward across the text-free band.
{
  const items = [
    item('Some paragraph text before the figure', 50, 700, 250),
    // 200pt text-free band = the figure itself
    item('Figure', 50, 480, 40),
    item('3', 93, 480, 8),
    item('System architecture', 106, 480, 110),
    item('text continuing after the figure', 50, 460, 200)
  ];
  const lines = buildTextLines(tc(items), viewport, SCALE);
  const cap = lines.find((l) => /^Figure/.test(l.text))!;
  const r = computeCaptionCropRegion(cap, 'figure', lines, CANVAS_W, CANVAS_H);

  const captionTopCanvas = cap.yTop;
  check('figure crop extends above caption', r.y < captionTopCanvas - 100, `y=${r.y.toFixed(0)} captionTop=${captionTopCanvas.toFixed(0)}`);
  check('figure crop covers the blank band', r.h >= 200 * SCALE * 0.8, `h=${r.h.toFixed(0)}`);
  check('figure crop does not run past caption into following text', r.y + r.h <= cap.yBottom + 20, `bottom=${(r.y + r.h).toFixed(0)}`);
}

// ---------------------------------------------------------------- Test 4
// Two-column page: caption in the LEFT column must not widen into the right column.
{
  const items: any[] = [];
  // left column x 50..280, right column x 330..560
  for (let i = 0; i < 6; i++) {
    const y = 700 - i * 20;
    items.push(item('left column body text here', 50, y, 230));
    items.push(item('right column body text here', 330, y, 230));
  }
  items.push(item('Table', 50, 560, 38), item('4', 91, 560, 8), item('Left col table', 104, 560, 80));
  for (let i = 0; i < 3; i++) {
    const y = 540 - i * 20;
    items.push(item(`row${i}`, 50, y, 40));
    items.push(item(`val${i}`, 200, y, 40));
    items.push(item('right column body text here', 330, y, 230));
  }

  const lines = buildTextLines(tc(items), viewport, SCALE);
  const cap = lines.find((l) => /^Table 4/.test(l.text))!;
  const r = computeCaptionCropRegion(cap, 'table', lines, CANVAS_W, CANVAS_H);

  const rightColStartCanvas = 330 * SCALE;
  check('crop stays inside left column', r.x + r.w < rightColStartCanvas, `right=${(r.x + r.w).toFixed(0)} rightColStart=${rightColStartCanvas.toFixed(0)}`);
  check('crop starts at left column', r.x < 60 * SCALE, `x=${r.x.toFixed(0)}`);
}

// ---------------------------------------------------------------- Test 5
// Caption variants and kind normalisation
{
  const cases: Array<[string, boolean, string?]> = [
    ['Table 2: Results', true, '2'],
    ['Fig. 5 Overview', true, '5'],
    ['Figure 12b — detail', true, '12b'],
    ['Chart 1', true, '1'],
    ['see Table 2 for details', false],       // caption must open the line
    ['Notably the figure 3 shows', false],
    ['Table II', true, 'II']
  ];
  cases.forEach(([text, shouldMatch, num]) => {
    const m = text.match(CAPTION_REGEX);
    check(`caption regex: "${text}"`, !!m === shouldMatch && (!num || (m && m[2] === num)), m ? `num=${m[2]}` : 'no match');
  });
  check('fig normalises to figure', normalizeCaptionKind('Fig') === 'figure');
}

// ---------------------------------------------------------------- Test 6
// Bounds sanity: crop must never leave the canvas
{
  const items = [item('Table', 50, 40, 38), item('9', 91, 40, 8)]; // caption near page bottom
  const lines = buildTextLines(tc(items), viewport, SCALE);
  const cap = lines[0];
  const r = computeCaptionCropRegion(cap, 'table', lines, CANVAS_W, CANVAS_H);
  check('crop y within canvas', r.y >= 0 && r.y < CANVAS_H, `y=${r.y.toFixed(0)}`);
  check('crop bottom within canvas', r.y + r.h <= CANVAS_H + 0.001, `bottom=${(r.y + r.h).toFixed(0)} canvasH=${CANVAS_H}`);
  check('crop right within canvas', r.x + r.w <= CANVAS_W + 0.001, `right=${(r.x + r.w).toFixed(0)}`);
}

// ---------------------------------------------------------------- Test 7
// Over-split guards: single-column prose and a full-page table must NOT be split.
{
  const groupsOf = (items: any[]) => {
    const runs = items.map((it) => {
      const [vx, vy] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      return { str: it.str, x: vx, y: vy, w: it.width * SCALE, h: it.height * SCALE };
    });
    runs.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x));
    const groups: any[][] = [];
    let cur: any[] = [];
    runs.forEach((r) => {
      const prev = cur[cur.length - 1];
      if (prev && Math.abs(r.y - prev.y) > Math.max(3, r.h * 0.5)) { groups.push(cur); cur = []; }
      cur.push(r);
    });
    if (cur.length) groups.push(cur);
    return groups;
  };

  // single-column prose, 30 lines
  const prose: any[] = [];
  for (let i = 0; i < 30; i++) prose.push(item('a full width line of ordinary prose text', 50, 700 - i * 16, 500));
  check('single-column page not split', detectColumnBounds(groupsOf(prose), CANVAS_W).length === 0);

  // full-page table: 12 rows with a consistent internal gap, plus a caption spanning it
  const tableOnly: any[] = [item('Table', 50, 720, 38), item('1', 91, 720, 8), item('Full page results table', 104, 720, 400)];
  for (let i = 0; i < 12; i++) {
    const y = 690 - i * 20;
    tableOnly.push(item(`label${i}`, 50, y, 60));
    tableOnly.push(item(`value${i}`, 300, y, 60));
  }
  check('full-page table not split at its internal gap', detectColumnBounds(groupsOf(tableOnly), CANVAS_W).length === 0);

  // genuine two-column page IS split
  const twoCol: any[] = [];
  for (let i = 0; i < 30; i++) {
    const y = 700 - i * 16;
    twoCol.push(item('left column body text here', 50, y, 230));
    twoCol.push(item('right column body text here', 330, y, 230));
  }
  check('genuine two-column page is split', detectColumnBounds(groupsOf(twoCol), CANVAS_W).length === 2,
    String(detectColumnBounds(groupsOf(twoCol), CANVAS_W).length));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
