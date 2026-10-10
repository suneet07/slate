/* @ts-nocheck */
/**
 * Regression fixture taken from real measured output of EJ1172284.pdf page 5
 * (The EUROCALL Review, Vol 25 No 2). That page contains BOTH:
 *   - an in-text reference at y=596: "Table 1 shows the study participants' ..."
 *   - the real caption at y=794:      "Table 1. The students' mobile devices usage descriptions."
 * The first used to win and the crop showed a paragraph of prose instead of the table.
 */
import {
  CAPTION_REGEX,
  CAPTION_SCORE_THRESHOLD,
  scoreCaptionCandidate,
  computeCaptionCropRegion,
  normalizeCaptionKind,
  reachesPageBottom,
  findContinuationRegion
} from '../src/lib/rag/pdfExtractor';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

// text, x0, x1, baselineY, gapCount  (canvas coords at scale 1.5, page 893x1263)
const raw: Array<[string, number, number, number, number]> = [
  ['The EUROCALL Review, Volume 25, No. 2, September 2017', 250, 643, 69, 0],
  ['The gathered data were subjected to qualitative and quantitative analysis. The analysis', 128, 765, 270, 0],
  ['updated. The researcher used the highlighting function of the word processor program', 128, 765, 357, 0],
  ['calculating percentages.', 128, 301, 461, 0],
  ['4. Findings', 128, 215, 486, 0],
  ['4.1. Usage of mobile devices', 181, 387, 571, 0],
  ["Table 1 shows the study participants’ mobile devices (MobDs) usage descriptions. The", 128, 765, 596, 0],
  ['table demonstrates that smartphones were the most often used mobile devices by the', 128, 765, 613, 0],
  ['students. In addition, the numerical information in the table indicates that the', 128, 765, 631, 0],
  ['participants, on average, had been using them for English language study for about', 128, 765, 648, 0],
  ['3.80 years (minimum 2, maximum 6 years). 9 (45%) and 11 (55%) of the subjects', 128, 765, 665, 0],
  ['started using their mobile devices at senior high school and university, respectively. It', 128, 765, 683, 0],
  ['should also be added that, with the exception of one student (i.e. S9), all the other', 128, 765, 700, 0],
  ['participants claimed to use their mobile devices in order to learn English much more', 128, 766, 717, 0],
  ['frequently with time. Finally, more than half of the students (55%) regarded themselves', 128, 765, 735, 0],
  ['as experienced or fairly experienced users of their MobDs for English language learning;', 128, 765, 752, 0],
  ['however, 45% claimed not to be very skilful in this area.', 128, 536, 769, 0],
  ["Table 1. The students’ mobile devices usage descriptions.", 128, 541, 794, 0],
  ['Year/ Use of MobDs', 128, 612, 836, 1],
  ['Self-assessed', 620, 707, 843, 0],
  ['Student Sex Device used for languageLevel of experience', 128, 690, 857, 5],
  ['study (approx.)study', 128, 604, 867, 0],
  ['S1 female smartphone and tablet 2 years not very experienced', 200, 740, 905, 4],
  ['S2 female smartphone 5 years experienced', 200, 689, 943, 4],
  ['S3 female smartphone 5 years fairly experienced', 200, 721, 981, 4],
  ['2nd year', 128, 191, 1012, 0],
  ['S4 female smartphone, rarely tablet 4 years fairly experienced', 200, 721, 1019, 4],
  ['B.A.', 128, 151, 1026, 0],
  ['S5 female smartphone 3 years not very experienced', 200, 740, 1057, 4],
  ['S6 male smartphone 2 years experienced', 200, 689, 1095, 4],
  ['S7 female smartphone and tablet 5 years fairly experienced', 200, 721, 1133, 4],
  ['22', 440, 453, 1207, 0]
];

const H = 15; // ~10pt at scale 1.5
const lines = raw.map(([text, x0, x1, y, gapCount]) => ({
  text,
  x0,
  x1,
  yTop: y - H,
  yBottom: y + H * 0.3,
  gapCount
}));

const CANVAS_W = 893;
const CANVAS_H = 1263;
const bodyWidth = lines.reduce((m, l) => Math.max(m, l.x1 - l.x0), 0);

const scoreOf = (text: string) => {
  const line = lines.find((l) => l.text === text)!;
  const m = line.text.match(CAPTION_REGEX)!;
  return { line, m, score: scoreCaptionCandidate(line, m[3], m[4], lines, bodyWidth) };
};

// ---------------------------------------------------------------- Candidate scoring
{
  const inText = scoreOf("Table 1 shows the study participants’ mobile devices (MobDs) usage descriptions. The");
  const real = scoreOf("Table 1. The students’ mobile devices usage descriptions.");

  check('in-text reference still matches the regex', !!inText.m);
  check('in-text reference scores below threshold', inText.score < CAPTION_SCORE_THRESHOLD, `score=${inText.score}`);
  check('real caption scores above threshold', real.score >= CAPTION_SCORE_THRESHOLD, `score=${real.score}`);
  check('real caption outscores the in-text reference', real.score > inText.score,
    `real=${real.score} inText=${inText.score}`);
  check('separator captured', real.m[3] === '.', JSON.stringify(real.m[3]));
  check('title captured without separator', real.m[4].startsWith('The students'), real.m[4]);
}

// ---------------------------------------------------------------- Winner selection
{
  const candidates = lines
    .map((line) => {
      const m = line.text.match(CAPTION_REGEX);
      if (!m) return null;
      return { line, m, score: scoreCaptionCandidate(line, m[3], m[4], lines, bodyWidth) };
    })
    .filter(Boolean)
    .filter((c) => c.score >= CAPTION_SCORE_THRESHOLD);

  check('exactly one caption survives on the page', candidates.length === 1,
    JSON.stringify(candidates.map((c) => c.line.text.slice(0, 40))));
  check('the survivor is the real caption', candidates[0].line.yTop > 700,
    `yTop=${candidates[0].line.yTop}`);
}

// ---------------------------------------------------------------- Crop geometry
{
  const caption = lines.find((l) => l.text.startsWith('Table 1.'))!;
  const region = computeCaptionCropRegion(caption, normalizeCaptionKind('Table'), lines, CANVAS_W, CANVAS_H);

  const firstRowTop = lines.find((l) => l.text.startsWith('Year/'))!.yTop;
  const lastRowBottom = lines.find((l) => l.text.startsWith('S7 '))!.yBottom;
  const pageNumberTop = lines.find((l) => l.text === '22')!.yTop;
  const proseBottom = lines.find((l) => l.text.startsWith('however, 45%'))!.yBottom;

  check('crop starts at the caption, not in the prose above', region.y > proseBottom - 20,
    `y=${region.y.toFixed(0)} proseBottom=${proseBottom.toFixed(0)}`);
  check('crop includes the header row', region.y <= firstRowTop, `y=${region.y.toFixed(0)} header=${firstRowTop}`);
  check('crop reaches the last row on the page', region.y + region.h >= lastRowBottom,
    `bottom=${(region.y + region.h).toFixed(0)} lastRow=${lastRowBottom.toFixed(0)}`);
  check('narrow cells do not truncate the table early', region.y + region.h > lines.find((l) => l.text.startsWith('S5 '))!.yBottom,
    `bottom=${(region.y + region.h).toFixed(0)}`);
  check('crop excludes the page number', region.y + region.h < pageNumberTop,
    `bottom=${(region.y + region.h).toFixed(0)} pageNo=${pageNumberTop}`);
  check('crop spans the table width', region.x <= 128 && region.x + region.w >= 740,
    `x=${region.x.toFixed(0)}..${(region.x + region.w).toFixed(0)}`);
  check('crop stays on canvas', region.x >= 0 && region.y >= 0 && region.y + region.h <= CANVAS_H);
}

// ---------------------------------------------------------------- Wording variants
{
  const mk = (text: string, x1 = 500) => ({ text, x0: 128, x1, yTop: 400, yBottom: 415, gapCount: 0 });
  const ctx = [mk('body text', 765), { text: 'a b', x0: 128, x1: 700, yTop: 440, yBottom: 455, gapCount: 3 }];
  const scoreText = (text: string, x1?: number) => {
    const line = mk(text, x1);
    const m = line.text.match(CAPTION_REGEX);
    return m ? scoreCaptionCandidate(line, m[3], m[4], [line, ...ctx], 637) : null;
  };

  const accepted: Array<[string, number?]> = [
    ['Table 2: Results of the survey'],
    ['Figure 3. System architecture'],
    ['Fig. 5 Overview'],
    ['Table 4'],
    ['Chart 1 — Quarterly revenue']
  ];
  const rejected: string[] = [
    'Table 1 shows the study participants’ mobile devices usage descriptions.',
    'Figure 2 above shows that the trend continues',
    'Table 3 presents the aggregated totals for each cohort',
    'Table 6 illustrates how the values change over time'
  ];

  accepted.forEach(([t, w]) => {
    const s = scoreText(t, w);
    check(`accepted: "${t}"`, s !== null && s >= CAPTION_SCORE_THRESHOLD, `score=${s}`);
  });
  rejected.forEach((t) => {
    const s = scoreText(t, 765);
    check(`rejected: "${t.slice(0, 45)}..."`, s !== null && s < CAPTION_SCORE_THRESHOLD, `score=${s}`);
  });
}

// ---------------------------------------------------------------- Cross-page continuation
// Table 1 is cut off by the page 5 break and resumes at the top of page 6 with S8..S20.
{
  const page6raw: Array<[string, number, number, number, number]> = [
    ['The EUROCALL Review, Volume 25, No. 2, September 2017', 250, 643, 69, 0],
    ['S8 female smartphone 2 years fairly experienced', 200, 721, 131, 4],
    ['S9 male smartphone 4 years not very experienced', 200, 740, 169, 4],
    ['S10 female smartphone 5 years fairly experienced', 200, 721, 207, 4],
    ['S11 female tablet and cell phone 2 years fairly experienced', 200, 721, 245, 4],
    ['S12 female smartphone 2 years not very experienced', 200, 740, 283, 4],
    ['3rd year', 128, 176, 291, 0],
    ['B.A.', 128, 151, 313, 0],
    ['S13 female smartphone 3 years not very experienced', 200, 740, 321, 4],
    ['S14 male smartphone and tablet 3 years experienced', 200, 689, 359, 4],
    ['S15 female smartphone and tablet 5 years fairly experienced', 200, 721, 397, 4],
    ['S16 female smartphone 3 years not very experienced', 200, 740, 435, 4],
    ['S17 female smartphone and tablet 6 years fairly experienced', 200, 721, 473, 4],
    ['2nd year', 128, 191, 504, 0],
    ['S18 female smartphone 5 years not very experienced', 200, 740, 511, 4],
    ['M.A.', 128, 153, 518, 0],
    ['S19 female smartphone and tablet 5 years not very experienced', 200, 740, 549, 4],
    ['S20 female smartphone and tablet 5 years fairly experienced', 200, 721, 587, 4],
    ['4.2. Reasons for using mobile devices', 181, 452, 652, 0],
    ['The study participants decided on the use of their MobDs in order to learn English for', 128, 765, 677, 0]
  ];
  const page6 = page6raw.map(([text, x0, x1, y, gapCount]) => ({
    text,
    x0,
    x1,
    yTop: y - H,
    yBottom: y + H * 0.3,
    gapCount
  }));

  const caption = lines.find((l) => l.text.startsWith('Table 1.'))!;
  const region = computeCaptionCropRegion(caption, 'table', lines, CANVAS_W, CANVAS_H);

  check('page 5 table is detected as cut off by the page break',
    reachesPageBottom(region.y + region.h, lines, CANVAS_H) === true);

  const cont = findContinuationRegion(page6, region.x, region.x + region.w, CANVAS_H);
  check('continuation found on page 6', cont !== null);

  if (cont) {
    const lastRowBottom = page6.find((l) => l.text.startsWith('S20 '))!.yBottom;
    const headingTop = page6.find((l) => l.text.startsWith('4.2.'))!.yTop;

    check('continuation starts at the first row, below the running header',
      cont.y > page6[0].yBottom && cont.y <= page6[1].yTop,
      `y=${cont.y.toFixed(0)}`);
    check('continuation reaches the last row S20', cont.y + cont.h >= lastRowBottom,
      `bottom=${(cont.y + cont.h).toFixed(0)} S20=${lastRowBottom.toFixed(0)}`);
    check('continuation stops before the next section heading', cont.y + cont.h < headingTop,
      `bottom=${(cont.y + cont.h).toFixed(0)} heading=${headingTop}`);
    check('continuation is not itself cut off',
      reachesPageBottom(cont.y + cont.h, page6, CANVAS_H) === false);
  }

  // A page that simply starts with prose is not a continuation
  const prosePage = [
    { text: 'The EUROCALL Review', x0: 250, x1: 643, yTop: 54, yBottom: 73, gapCount: 0 },
    { text: 'An ordinary paragraph opening the page and running the full column width', x0: 128, x1: 765, yTop: 116, yBottom: 135, gapCount: 0 },
    { text: 'continuing with more ordinary prose across the measure of the page', x0: 128, x1: 765, yTop: 150, yBottom: 169, gapCount: 0 }
  ];
  check('prose page is not treated as a continuation',
    findContinuationRegion(prosePage, 120, 774, CANVAS_H) === null);

  // A single stray tabular line is not enough
  const strayPage = [
    { text: 'The EUROCALL Review', x0: 250, x1: 643, yTop: 54, yBottom: 73, gapCount: 0 },
    { text: 'a    b', x0: 200, x1: 700, yTop: 116, yBottom: 135, gapCount: 3 },
    { text: 'An ordinary paragraph running the full width of the column here', x0: 128, x1: 765, yTop: 150, yBottom: 169, gapCount: 0 }
  ];
  check('single stray row is not a continuation',
    findContinuationRegion(strayPage, 120, 774, CANVAS_H) === null);

  // A table that ends mid-page is not marked as cut off
  check('table ending mid-page is not cut off',
    reachesPageBottom(700, lines, CANVAS_H) === false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
