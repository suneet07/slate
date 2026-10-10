/**
 * Finds the pictures embedded in a PDF page — photos, logos, uncaptioned figures.
 *
 * Slate's figure extraction works from captions: it finds "Figure 3…" or "Table 2…" and
 * crops the region the caption describes. Anything without a caption never became an image
 * the model could place. A student profile's photo is the plain case: asked to "bring my
 * photo from the profile", retrieval found the right page and there was still nothing to
 * bring.
 *
 * A PDF draws a raster picture with one instruction — paint this image into the unit square
 * — positioned by whatever transform is current at that moment. Replaying the page's
 * transforms up to each paint gives the picture's exact box. That box is then cropped out of
 * the page render, so the board gets the picture as it appears on the page.
 *
 * Pure geometry: the pdf.js operator codes are passed in, so this runs (and is tested)
 * without pdf.js or a browser.
 */

export type Matrix = [number, number, number, number, number, number];

export interface PictureRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The pdf.js operator codes this needs (pdfjsLib.OPS). */
export interface PdfOps {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  paintImageXObject: number;
  paintInlineImageXObject: number;
  paintImageXObjectRepeat: number;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m1 then m2, in pdf.js's convention (Util.transform). */
function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

function isMatrix(v: unknown): v is Matrix {
  return Array.isArray(v) && v.length === 6 && v.every((n) => typeof n === 'number');
}

/**
 * Replays a page's operator list and returns where each raster picture lands, in the
 * coordinates of the rendered canvas (pass the viewport's transform).
 *
 * Image masks are deliberately not counted: they are one-colour stencils, used for glyphs
 * and icons far more often than for anything a teacher would want on the board.
 */
export function findPictureRects(
  fnArray: number[],
  argsArray: unknown[][],
  ops: PdfOps,
  viewportTransform: Matrix
): PictureRect[] {
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const rects: PictureRect[] = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] ?? [];

    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops.transform) {
      if (args.length === 6 && args.every((n) => typeof n === 'number')) ctm = multiply(ctm, args as Matrix);
    } else if (fn === ops.paintFormXObjectBegin) {
      // A form is a nested drawing with its own matrix, wrapped in an implicit save.
      stack.push(ctm);
      if (isMatrix(args[0])) ctm = multiply(ctm, args[0]);
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject || fn === ops.paintImageXObjectRepeat) {
      const total = multiply(viewportTransform, ctm);
      const corners = [apply(total, 0, 0), apply(total, 1, 0), apply(total, 0, 1), apply(total, 1, 1)];
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      rects.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
    }
  }
  return rects;
}

/**
 * Keeps the pictures worth offering. Drops slivers and icons (too small to matter), page
 * backgrounds and scans (the whole-page image already covers those), and repeats of the
 * same picture drawn twice in one place.
 */
export function keepMeaningfulPictures(rects: PictureRect[], pageW: number, pageH: number): PictureRect[] {
  const pageArea = pageW * pageH;
  const kept: PictureRect[] = [];

  for (const raw of rects) {
    // Clip to the page: a picture can be drawn partly off it.
    const x = Math.max(0, raw.x);
    const y = Math.max(0, raw.y);
    const w = Math.min(pageW, raw.x + raw.w) - x;
    const h = Math.min(pageH, raw.y + raw.h) - y;
    if (w <= 0 || h <= 0) continue;

    const area = w * h;
    if (Math.min(w, h) < 40 || area < pageArea * 0.004) continue; // icon, bullet, rule
    if (area > pageArea * 0.85) continue; // the page itself, or a scan of it

    const r = { x, y, w, h };
    const duplicate = kept.some((k) => overlapRatio(k, r) > 0.9);
    if (!duplicate) kept.push(r);
  }
  return kept;
}

function overlapRatio(a: PictureRect, b: PictureRect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (ix * iy) / Math.min(a.w * a.h, b.w * b.h);
}

export interface NearbyLine {
  text: string;
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
}

/**
 * Words that let the model match a request to a picture with no caption: where it sits on
 * the page, what shape it is, and the nearest text label, if any is close.
 *
 *   "Picture 1 on page 1 — top-right, portrait (photo-shaped), near "STUDENT DETAILS""
 *
 * "Bring my photo from the profile" is answerable from that line; "img_..._pic1" alone is
 * not.
 */
export function describePicture(
  index: number,
  pageNumber: number,
  rect: PictureRect,
  pageW: number,
  pageH: number,
  lines: NearbyLine[]
): string {
  const cx = (rect.x + rect.w / 2) / pageW;
  const cy = (rect.y + rect.h / 2) / pageH;
  const vertical = cy < 0.33 ? 'top' : cy > 0.67 ? 'bottom' : 'middle';
  const horizontal = cx < 0.33 ? 'left' : cx > 0.67 ? 'right' : 'centre';
  const where = vertical === 'middle' && horizontal === 'centre' ? 'centre' : `${vertical}-${horizontal}`;

  const ratio = rect.h / rect.w;
  // Passport and profile photos run about 1.2–1.4 tall to wide; saying so is what lets
  // "my photo" find it among logos and charts.
  const shape =
    ratio > 1.1 && ratio < 1.6 ? 'portrait (photo-shaped)' : ratio >= 1.6 ? 'tall' : ratio < 0.7 ? 'wide' : 'square-ish';

  // The closest line of text within a short reach of the picture's edge.
  const reach = Math.max(rect.w, rect.h) * 0.6;
  let best: { text: string; d: number } | null = null;
  for (const line of lines) {
    const text = line.text.trim();
    if (text.length < 2) continue;
    const dx = Math.max(0, line.x0 - (rect.x + rect.w), rect.x - line.x1);
    const dy = Math.max(0, line.yTop - (rect.y + rect.h), rect.y - line.yBottom);
    const d = Math.hypot(dx, dy);
    if (d <= reach && (!best || d < best.d)) best = { text, d };
  }
  const near = best ? `, near "${best.text.slice(0, 60)}"` : '';

  return `Picture ${index} on page ${pageNumber} — ${where}, ${shape}${near}`;
}
