/**
 * Reads handwriting on this machine — no GPU, no network, no tunnel URL.
 *
 * Slate's original handwriting path sent rendered crops to a TrOCR server on Colab. That
 * reads cursive well, but only while a T4 is running and a tunnel URL is pasted into
 * Settings; the rest of the time the board's handwriting simply did not exist as far as the
 * model was concerned. This is the default instead: stroke paths are matched against a
 * coordinate alphabet (handwriting.ts / glyphs.ts) in a couple of milliseconds. TrOCR stays
 * as an upgrade when it is configured.
 *
 * It reads printed writing. Joined-up cursive leaves no gaps to cut letters at, so those
 * lines come back with low confidence and are left out rather than guessed.
 */

import { CONFIDENT, charGroups, recognizeLine, spellWord, type Rect, type StrokeInput } from './handwriting';

export interface LocalInkStroke {
  id: string;
  /** [x, y] or [x, y, pressure] — Slate's InkStroke format. */
  points: number[][];
}

export interface LocalInkLine {
  strokeIds: string[];
  /**
   * The reading, with letters that are the same drawing offered together: "H[I|l|1]".
   * The model resolves those from the word, which is something it is good at.
   */
  text: string;
  /** The weakest word on the line. */
  confidence: number;
  /** True when at least one word fell below CONFIDENT. */
  uncertain: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How well strokes must match letters before they count as writing at all. Below
 * CONFIDENT on purpose: hard-to-read writing is still writing. Above this, a smiley face
 * starts being reported as the word "OO".
 */
const WRITING = 0.42;

function toInput(s: LocalInkStroke): StrokeInput {
  const points = s.points.map(([x, y]) => ({ x, y }));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { name: s.id, points, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

function unionOf(items: { bounds: Rect }[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of items) {
    minX = Math.min(minX, s.bounds.x);
    minY = Math.min(minY, s.bounds.y);
    maxX = Math.max(maxX, s.bounds.x + s.bounds.w);
    maxY = Math.max(maxY, s.bounds.y + s.bounds.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * A closed stroke with corners — a box, a triangle. People draw these; nobody writes a
 * letter that way, so it is the tell that separates two boxes side by side from "OO".
 */
function isCorneredShape(s: StrokeInput): boolean {
  const pts = s.points;
  if (pts.length < 4) return false;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (length === 0) return false;
  const gap = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
  if (gap > length * 0.22) return false;

  // Count sharp turns along an evenly resampled path.
  const step = Math.max(4, length / 40);
  const sampled = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const last = sampled[sampled.length - 1];
    carry += Math.hypot(pts[i].x - last.x, pts[i].y - last.y);
    if (carry >= step) {
      sampled.push(pts[i]);
      carry = 0;
    }
  }
  let corners = 0;
  for (let i = 1; i < sampled.length - 1; i++) {
    const a1 = Math.atan2(sampled[i].y - sampled[i - 1].y, sampled[i].x - sampled[i - 1].x);
    const a2 = Math.atan2(sampled[i + 1].y - sampled[i].y, sampled[i + 1].x - sampled[i].x);
    let turn = a2 - a1;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    if (Math.abs(turn) > 1.0) corners++;
  }
  // Corners alone decide it. Roundness is no use here: a square's area against its
  // perimeter is pi/4, rounder than many hand-drawn circles, so a roundness cut-off lets
  // boxes through as "O". A smooth loop has no sharp turns at all, which is the real test.
  return corners >= 2 && corners <= 8;
}

/**
 * Splits a line into words at gaps measured against the writing's own height — never a
 * fixed pixel count, because teachers write anywhere from a few centimetres to half a
 * metre tall. The gap is taken from the rightmost ink so far, so a stroke nested inside a
 * wider one (the stem of a T) cannot invent a gap and split "EARTH" into "EART H".
 */
function splitWords(line: StrokeInput[]): StrokeInput[][] {
  const gaps: number[] = [];
  let rightmost = line[0].bounds.x + line[0].bounds.w;
  for (let i = 1; i < line.length; i++) {
    gaps.push(Math.max(0, line[i].bounds.x - rightmost));
    rightmost = Math.max(rightmost, line[i].bounds.x + line[i].bounds.w);
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const threshold = Math.max((unionOf(line).h || 1) * 0.45, median * 2.2 + 1);

  const words: StrokeInput[][] = [[line[0]]];
  for (let i = 1; i < line.length; i++) {
    if (gaps[i - 1] > threshold) words.push([line[i]]);
    else words[words.length - 1].push(line[i]);
  }
  return words;
}

/** Finds the lines of writing among the strokes and reads them. Pictures are left alone. */
export function readInkLocally(strokes: LocalInkStroke[]): LocalInkLine[] {
  const inputs = strokes.filter((s) => s.points.length > 0).map(toInput);
  if (inputs.length < 2) return [];

  // Strokes whose vertical extents overlap share a line. A perfectly flat stroke (the bar
  // of an A) has no height to overlap with, so sitting inside the line's range is enough.
  const byTop = [...inputs].sort((a, b) => a.bounds.y - b.bounds.y);
  const groups: StrokeInput[][] = [];
  for (const stroke of byTop) {
    const line = groups.find((g) => {
      const r = unionOf(g);
      const overlap =
        Math.min(r.y + r.h, stroke.bounds.y + stroke.bounds.h) - Math.max(r.y, stroke.bounds.y);
      const shorter = Math.min(r.h, stroke.bounds.h);
      return shorter === 0 ? overlap >= 0 : overlap > shorter * 0.45;
    });
    if (line) line.push(stroke);
    else groups.push([stroke]);
  }

  const lines: LocalInkLine[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.bounds.x - b.bounds.x);
    const words = splitWords(group);
    const reading = recognizeLine(words);

    // Writing is mostly whatever reads as writing...
    const chars = reading.reduce((n, w) => n + w.chars.length, 0);
    if (chars < 2) continue;
    const mean = reading.reduce((sum, w) => sum + w.confidence * w.chars.length, 0) / chars;
    if (mean < WRITING) continue;

    // ...but a good match is not proof. Letters on a line are about one height, so a sun
    // (big circle, small rays) is a picture; and a line made of boxes is a diagram.
    const marks = words.flatMap((w) => charGroups(w));
    const heights = marks.map((m) => unionOf(m).h);
    const tallest = Math.max(...heights);
    const letterSized = marks.filter((_, i) => heights[i] >= tallest * 0.45);
    if (letterSized.length < 2) continue;
    const boxy = letterSized.filter((m) => m.length === 1 && isCorneredShape(m[0]));
    if (boxy.length * 2 >= letterSized.length) continue;

    const bounds = unionOf(group);
    const confidence = Math.min(...reading.map((w) => w.confidence));
    lines.push({
      strokeIds: group.map((s) => s.name),
      text: reading.map(spellWord).join(' '),
      confidence,
      uncertain: confidence < CONFIDENT,
      x: bounds.x,
      y: bounds.y,
      width: bounds.w,
      height: bounds.h,
    });
  }
  return lines;
}
