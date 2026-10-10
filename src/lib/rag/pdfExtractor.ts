import * as pdfjsLib from 'pdfjs-dist';
import { DocImage } from '../graph/types';
import { NoteTree } from './noteTree';
import { DocHeading } from './headings';
import { describePicture, findPictureRects, keepMeaningfulPictures, type Matrix, type PdfOps } from './pdfPictures';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface DocumentChunk {
  id: string;
  docId: string;
  filename: string;
  pageNumber: number;
  text: string;
  tokens: string[];
}

export interface TeacherDocument {
  id: string;
  filename: string;
  fileSize: number;
  uploadTimestamp: string;
  totalPages: number;
  chunks: DocumentChunk[];
  images: DocImage[];
  /** Full text per page. Chunks overlap, so they cannot be rejoined without duplication. */
  pageTexts: Record<number, string>;
  /**
   * LLM-built navigation tree. Absent until indexing finishes (or if it was skipped), so
   * every reader must tolerate it being undefined.
   */
  tree?: NoteTree;
  /**
   * Sections cut at the document's own headings. Populated during indexing; absent for
   * documents with no detectable heading structure.
   */
  headings?: DocHeading[];
  /**
   * Which version of the local OCR pass has run over this document's pictures and
   * image-only pages. Absent on documents saved before OCR existed; they are upgraded on load.
   */
  ocrVersion?: number;
}

// Function words carry no retrieval signal but survive a bare length filter, inflating
// document length and diluting the query.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was',
  'one', 'our', 'out', 'his', 'has', 'him', 'she', 'its', 'who', 'get', 'how', 'why', 'what',
  'when', 'where', 'which', 'with', 'from', 'this', 'that', 'these', 'those', 'they', 'them',
  'their', 'there', 'then', 'than', 'been', 'being', 'have', 'having', 'does', 'did', 'doing',
  'were', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'shall', 'into', 'onto',
  'over', 'under', 'also', 'such', 'some', 'more', 'most', 'other', 'each', 'both', 'very',
  'just', 'only', 'same', 'own', 'too', 'about', 'above', 'below', 'between', 'through',
  'during', 'before', 'after', 'again', 'here', 'once', 'because', 'while', 'until', 'upon',
  'shown', 'show', 'see', 'let', 'now', 'new', 'use', 'used', 'using', 'via', 'per', 'etc'
]);

/**
 * Conservative suffix stemmer. Without it retrieval is exact-match only, so "vectors"
 * misses "vector" and "recursion" misses "recursive" — a large share of failed lookups.
 * Deliberately crude: it only has to be consistent between indexing and querying.
 */
function stemToken(token: string): string {
  let t = token;

  // Plurals
  if (t.length > 4 && t.endsWith('ies')) t = t.slice(0, -3) + 'y';
  else if (t.length > 4 && t.endsWith('sses')) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) {
    t = t.slice(0, -1);
  }

  // Common derivations — collapses recursion/recursive, sorting/sorted, complexity/complex
  if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 5 && t.endsWith('ion')) t = t.slice(0, -3);
  else if (t.length > 5 && t.endsWith('ive')) t = t.slice(0, -3);
  else if (t.length > 5 && t.endsWith('ity')) t = t.slice(0, -3);
  else if (t.length > 5 && t.endsWith('ment')) t = t.slice(0, -4);
  else if (t.length > 4 && t.endsWith('ed')) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith('ly')) t = t.slice(0, -2);

  return t;
}

/**
 * Tokenizes text into normalized, stopword-filtered, stemmed terms for BM25.
 * Used for both indexing and querying, so the two stay symmetric.
 */
export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(stemToken)
    .filter((t) => t.length > 2);
}

const CHUNK_WORDS = 250;
// Stride below chunk size gives ~40% overlap, so a concept crossing a boundary still
// appears whole in one chunk instead of being split across two that each retrieve half.
const CHUNK_STRIDE = 150;

/**
 * Splits a word list into overlapping windows.
 */
export function chunkWords(words: string[]): string[] {
  if (words.length === 0) return [];
  if (words.length <= CHUNK_WORDS) return [words.join(' ')];

  const out: string[] = [];
  for (let i = 0; i < words.length; i += CHUNK_STRIDE) {
    out.push(words.slice(i, i + CHUNK_WORDS).join(' '));
    if (i + CHUNK_WORDS >= words.length) break;
  }
  return out;
}

/**
 * Groups paragraphs into chunks of roughly CHUNK_STRIDE words, carrying the last
 * paragraph into the next chunk so paragraph boundaries overlap too.
 */
export function chunkParagraphs(paragraphs: string[]): string[] {
  const out: string[] = [];
  let buffer: string[] = [];
  let wordCount = 0;

  paragraphs.forEach((para) => {
    const trimmed = para.trim();
    if (!trimmed) return;

    buffer.push(trimmed);
    wordCount += trimmed.split(/\s+/).length;

    if (wordCount >= CHUNK_STRIDE) {
      out.push(buffer.join('\n\n'));
      buffer = buffer.length > 1 ? [buffer[buffer.length - 1]] : [];
      wordCount = buffer.reduce((sum, p) => sum + p.split(/\s+/).length, 0);
    }
  });

  if (buffer.length > 0) out.push(buffer.join('\n\n'));
  return out;
}

/**
 * Renders a PDF page to an offscreen canvas
 */
async function renderPageToCanvas(page: pdfjsLib.PDFPageProxy, scale: number = 1.5): Promise<{ canvas: HTMLCanvasElement; viewport: any }> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    await page.render({ canvasContext: ctx, viewport }).promise;
  }
  return { canvas, viewport };
}

/**
 * Crops a bounding region out of a canvas into a new canvas.
 */
function cropToCanvas(
  sourceCanvas: HTMLCanvasElement,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number
): HTMLCanvasElement {
  cropX = Math.round(cropX);
  cropY = Math.round(cropY);
  cropW = Math.round(cropW);
  cropH = Math.round(cropH);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = Math.max(100, cropW);
  cropCanvas.height = Math.max(100, cropH);
  const ctx = cropCanvas.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    ctx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropCanvas.width, cropCanvas.height);
  }
  return cropCanvas;
}

/**
 * Stacks crops from consecutive pages into one image, so a table broken by a page break
 * still arrives on the board as a single complete figure.
 */
function stitchCanvasesVertically(canvases: HTMLCanvasElement[]): HTMLCanvasElement {
  if (canvases.length === 1) return canvases[0];

  const width = Math.max(...canvases.map((c) => c.width));
  const height = canvases.reduce((sum, c) => sum + c.height, 0);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');

  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    let y = 0;
    canvases.forEach((c) => {
      ctx.drawImage(c, 0, y);
      y += c.height;
    });
  }
  return out;
}

export interface TextLine {
  text: string;
  x0: number;
  x1: number;
  yTop: number;
  yBottom: number;
  gapCount: number; // Number of wide intra-line gaps — table rows have them, prose does not
}

// A caption must open its line, which is how Table/Figure labels are actually typeset.
// Groups: 1 kind, 2 number, 3 separator (if any), 4 title text.
export const CAPTION_REGEX = /^(table|figure|fig|chart|diagram|exhibit)\s*\.?\s*(\d+[a-z]?|[IVXLC]{1,5})\s*([.:)\-–—])?\s*(.*)$/i;

// Verbs that mark an in-text reference — "Table 1 shows ..." opens a body paragraph and is
// not a caption, even though it starts the line.
const REFERENCE_VERB =
  /^(shows?|presents?|illustrates?|indicates?|demonstrates?|summari[sz]es?|lists?|gives?|displays?|reports?|compares?|depicts?|outlines?|describes?|provides?|contains?|reveals?|suggests?|confirms?|above|below)\b/i;

export function normalizeCaptionKind(raw: string): string {
  const k = raw.toLowerCase();
  return k === 'fig' ? 'figure' : k;
}

/**
 * Scores how caption-like a CAPTION_REGEX match is.
 *
 * Anchoring to line start is not enough on its own: a body paragraph opening with
 * "Table 1 shows the study participants' ..." matches just as well as the real caption
 * "Table 1. The students' mobile devices usage descriptions." lower down the page. Picking
 * the first match cropped the prose instead of the table, so candidates are scored and the
 * best one per figure number wins.
 */
export function scoreCaptionCandidate(
  line: TextLine,
  separator: string | undefined,
  title: string,
  lines: TextLine[],
  bodyWidth: number
): number {
  let score = 0;

  // Real captions punctuate after the number; in-text references run straight on
  if (separator) score += 3;

  const rest = (title || '').trim();
  if (!rest || /^[A-Z(“"]/.test(rest)) score += 2;
  else score -= 3;

  if (REFERENCE_VERB.test(rest)) score -= 6;

  // Captions are typically set narrower than the body column
  if (bodyWidth > 0 && line.x1 - line.x0 <= bodyWidth * 0.8) score += 2;

  // Tabular content adjacent to the line is strong positive evidence
  const NEAR = 220;
  const hasTabularNeighbour = lines.some(
    (l) =>
      l.gapCount >= 1 &&
      ((l.yTop >= line.yBottom && l.yTop - line.yBottom <= NEAR) ||
        (l.yBottom <= line.yTop && line.yTop - l.yBottom <= NEAR))
  );
  if (hasTabularNeighbour) score += 3;

  return score;
}

// Below this a match is treated as an in-text reference rather than a caption
export const CAPTION_SCORE_THRESHOLD = 3;

export interface TextRun {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Finds the column x-bounds of a page so a two-column paper is never read across the
 * gutter. A gutter is a vertical band that almost no line crosses — "almost", because
 * full-width titles legitimately span it. Returns [] for an ordinary single-column page.
 *
 * The tolerance is only applied on text-heavy pages: on a sparse page (a full-page table)
 * a single caption spanning the table's internal gap must be enough to prove it is not a
 * gutter, otherwise the table gets sliced down the middle.
 */
export function detectColumnBounds(groups: TextRun[][], canvasWidth: number): Array<[number, number]> {
  const BUCKET = 4;
  const bucketCount = Math.ceil(canvasWidth / BUCKET);
  if (bucketCount <= 0) return [];

  const coverage = new Array(bucketCount).fill(0);
  groups.forEach((group) => {
    const hit = new Set<number>();
    group.forEach((r) => {
      const from = Math.max(0, Math.floor(r.x / BUCKET));
      const to = Math.min(bucketCount - 1, Math.floor((r.x + r.w) / BUCKET));
      for (let i = from; i <= to; i++) hit.add(i);
    });
    hit.forEach((i) => (coverage[i] += 1));
  });

  const first = coverage.findIndex((c) => c > 0);
  let last = -1;
  for (let i = bucketCount - 1; i >= 0; i--) {
    if (coverage[i] > 0) {
      last = i;
      break;
    }
  }
  if (first < 0 || last <= first) return [];

  const tolerance = groups.length >= 20 ? Math.floor(groups.length * 0.05) : 0;
  const minGutterBuckets = Math.ceil(14 / BUCKET);

  const bounds: Array<[number, number]> = [];
  let colStart = first;
  let i = first;

  while (i <= last) {
    if (coverage[i] <= tolerance) {
      let j = i;
      while (j <= last && coverage[j] <= tolerance) j++;
      if (j - i >= minGutterBuckets && colStart < i) {
        bounds.push([colStart * BUCKET, i * BUCKET]);
        colStart = j;
      }
      i = j;
    } else {
      i++;
    }
  }
  bounds.push([colStart * BUCKET, (last + 1) * BUCKET]);

  if (bounds.length < 2) return [];

  // Reject a split that would shave off a narrow strip rather than find a real column
  const textWidth = (last + 1 - first) * BUCKET;
  if (bounds.some(([a, b]) => b - a < textWidth * 0.15)) return [];

  return bounds;
}

/**
 * Joins the runs sharing one baseline (within one column) into a single line.
 */
function makeTextLine(group: TextRun[]): TextLine | null {
  if (group.length === 0) return null;

  const h = Math.max(...group.map((r) => r.h));
  const baseline = Math.max(...group.map((r) => r.y));

  let text = '';
  let gapCount = 0;
  let prevRight: number | null = null;

  group.forEach((r) => {
    if (prevRight !== null) {
      const gap = r.x - prevRight;
      // Wide gap = column separation in a table row; narrow gap = ordinary word space
      if (gap > h * 1.6) gapCount += 1;
      if (gap > h * 0.15) text += ' ';
    }
    text += r.str;
    prevRight = r.x + r.w;
  });

  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;

  return {
    text: clean,
    x0: Math.min(...group.map((r) => r.x)),
    x1: Math.max(...group.map((r) => r.x + r.w)),
    yTop: baseline - h,
    yBottom: baseline + h * 0.3,
    gapCount
  };
}

/**
 * Groups PDF.js text items into visual lines, in canvas coordinates.
 *
 * PDF.js splits a rendered line into arbitrary runs — "Table" and "2" routinely arrive
 * as separate items — so captions are only reliably detectable once the runs sharing a
 * baseline are joined back together. Lines are split at column gutters, so a caption in
 * one column never picks up the width of the other.
 */
export function buildTextLines(textContent: any, viewport: any, scale: number): TextLine[] {
  const runs: TextRun[] = [];

  textContent.items.forEach((item: any) => {
    if (!item || typeof item.str !== 'string' || !item.str.trim() || !item.transform) return;
    const [vx, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    runs.push({
      str: item.str,
      x: vx,
      y: vy,
      w: Math.max(0, (item.width || 0) * scale),
      h: Math.max(4, (item.height || 10) * scale)
    });
  });

  if (runs.length === 0) return [];

  // Sort into reading order: by baseline, then left-to-right within a baseline
  runs.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x));

  const groups: TextRun[][] = [];
  let current: TextRun[] = [];

  runs.forEach((r) => {
    const prev = current[current.length - 1];
    if (prev && Math.abs(r.y - prev.y) > Math.max(3, r.h * 0.5)) {
      groups.push(current);
      current = [];
    }
    current.push(r);
  });
  if (current.length > 0) groups.push(current);

  const canvasWidth = viewport.width || Math.max(...runs.map((r) => r.x + r.w));
  const columns = detectColumnBounds(groups, canvasWidth);

  const lines: TextLine[] = [];

  groups.forEach((group) => {
    if (columns.length === 0) {
      const line = makeTextLine(group);
      if (line) lines.push(line);
      return;
    }
    columns.forEach(([cx0, cx1]) => {
      const inColumn = group.filter((r) => {
        const center = r.x + r.w / 2;
        return center >= cx0 && center < cx1;
      });
      const line = makeTextLine(inColumn);
      if (line) lines.push(line);
    });
  });

  return lines;
}

function horizontallyOverlaps(a: TextLine, b: TextLine): boolean {
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const narrower = Math.min(a.x1 - a.x0, b.x1 - b.x0);
  return narrower > 0 && overlap > narrower * 0.35;
}

/**
 * Works out which part of the page a caption actually describes.
 *
 * Two conventions are handled, because cropping the wrong direction is what produced
 * "half a table" and "the paragraph after the figure":
 *   - Table captions sit ABOVE a block of text rows -> walk down through the rows.
 *   - Figure captions sit BELOW a graphic -> the graphic is the text-free band above.
 * Each falls back to the other direction when the expected shape isn't there.
 *
 * Horizontal bounds come from the lines sharing the caption's column, so a two-column
 * page never drags in the neighbouring column.
 */
export function computeCaptionCropRegion(
  caption: TextLine,
  kind: string,
  lines: TextLine[],
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number; w: number; h: number } {
  const pad = 8;
  const lineHeight = Math.max(8, caption.yBottom - caption.yTop);

  const columnLines = lines.filter((l) => horizontallyOverlaps(l, caption));
  const x0 = Math.max(0, Math.min(caption.x0, ...columnLines.map((l) => l.x0)) - pad);
  const x1 = Math.min(canvasWidth, Math.max(caption.x1, ...columnLines.map((l) => l.x1)) + pad);

  const below = columnLines
    .filter((l) => l.yTop >= caption.yBottom - 1)
    .sort((a, b) => a.yTop - b.yTop);
  const above = columnLines
    .filter((l) => l.yBottom <= caption.yTop + 1)
    .sort((a, b) => b.yBottom - a.yBottom);

  // Text rows belonging to a table, walked downward from the caption
  const walkTableRows = (): number => {
    let bottom = caption.yBottom;
    let proseRun = 0;
    const columnWidth = x1 - x0;

    for (const line of below) {
      if (CAPTION_REGEX.test(line.text)) break;             // next caption ends the block
      if (line.yTop - bottom > lineHeight * 2.4) break;      // whitespace gap ends the block

      // A narrow line is a cell that happens to hold one value ("2nd year", "B.A."), not
      // prose — judging it by the missing column gap alone truncated tables mid-way.
      const isWide = line.x1 - line.x0 > columnWidth * 0.6;
      if (line.gapCount === 0 && isWide) {
        proseRun += 1;
        if (proseRun >= 2) break;                            // two prose lines = past the table
      } else {
        proseRun = 0;
      }
      bottom = line.yBottom;
    }
    return bottom;
  };

  // A graphic leaves a text-free vertical band; measure it on the given side
  const bandAbove = (): number => (above.length > 0 ? caption.yTop - above[0].yBottom : caption.yTop);
  const bandBelow = (): number =>
    (below.length > 0 ? below[0].yTop : canvasHeight) - caption.yBottom;

  let top: number;
  let bottom: number;

  if (kind === 'table') {
    bottom = walkTableRows();
    top = caption.yTop;
    // No rows found below — the table may instead sit above its caption
    if (bottom - caption.yBottom < lineHeight && bandAbove() >= 60) {
      top = caption.yTop - bandAbove();
      bottom = caption.yBottom;
    }
  } else {
    const gapAbove = bandAbove();
    if (gapAbove >= 60) {
      top = caption.yTop - gapAbove;
      bottom = caption.yBottom;
    } else {
      const gapBelow = bandBelow();
      top = caption.yTop;
      bottom = gapBelow >= 60 ? caption.yBottom + gapBelow : walkTableRows();
    }
  }

  const y = Math.max(0, top - pad);
  // Cap at most of the page rather than a fixed pixel height, so tall tables stay whole
  const h = Math.min(canvasHeight - y, Math.max(60, bottom - top + pad * 2), canvasHeight * 0.92);

  return { x: x0, y, w: Math.max(60, x1 - x0), h };
}

/**
 * True when a crop runs all the way to the bottom of the page's real content — meaning the
 * table was cut off by the page break rather than ending on its own. Footer lines in the
 * bottom tenth of the page (running heads, page numbers) don't count as content.
 */
export function reachesPageBottom(regionBottom: number, lines: TextLine[], canvasHeight: number): boolean {
  if (regionBottom < canvasHeight * 0.6) return false;

  const contentBelow = lines.filter(
    (l) => l.yTop > regionBottom + 4 && l.yTop < canvasHeight * 0.9
  );
  return contentBelow.length === 0;
}

/**
 * Finds table rows continuing at the top of the page after a break.
 *
 * Rows here are judged more strictly than in the initial walk: there is no header to allow
 * for, so a line only continues the table if it has column gaps or is a narrow single-value
 * cell. The first ordinary line — a heading, a paragraph — ends the continuation.
 */
export function findContinuationRegion(
  lines: TextLine[],
  columnX0: number,
  columnX1: number,
  canvasHeight: number
): { x: number; y: number; w: number; h: number } | null {
  const columnWidth = Math.max(1, columnX1 - columnX0);

  // Ignore any running header band at the very top of the page
  const body = lines
    .filter((l) => l.yBottom > canvasHeight * 0.06)
    .sort((a, b) => a.yTop - b.yTop);

  const first = body[0];
  if (!first) return null;

  // A continuation must resume near the top, otherwise the table really did end
  if (first.yTop > canvasHeight * 0.22) return null;

  const isTabular = (l: TextLine) => l.gapCount >= 1 || l.x1 - l.x0 < columnWidth * 0.25;
  if (!isTabular(first)) return null;

  const lineHeight = Math.max(8, first.yBottom - first.yTop);
  let bottom = first.yBottom;
  let rowCount = 0;

  for (const line of body) {
    if (line.yTop < first.yTop) continue;
    if (line.yTop - bottom > lineHeight * 2.4) break;
    if (!isTabular(line)) break;
    bottom = Math.max(bottom, line.yBottom);
    rowCount += 1;
  }

  // One stray line at the top of a page is not a continuation
  if (rowCount < 2) return null;

  const pad = 8;
  const y = Math.max(0, first.yTop - pad);
  return {
    x: columnX0,
    y,
    w: columnWidth,
    h: Math.min(canvasHeight - y, bottom - y + pad)
  };
}

interface PendingTable {
  imageIndex: number;
  baseCaption: string;
  columnX0: number;
  columnX1: number;
  canvases: HTMLCanvasElement[];
  pages: number[];
}

/**
 * Parses uploaded PDF, TXT, or MD files and extracts text chunks + bounded Table/Figure crops
 */
export async function parseUploadedFile(file: File): Promise<TeacherDocument> {
  const docId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const filename = file.name;
  const fileSize = file.size;
  const uploadTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const chunks: DocumentChunk[] = [];
  const images: DocImage[] = [];
  const pageTexts: Record<number, string> = {};
  let totalPages = 1;

  // A table cut off by a page break, awaiting its continuation rows on the next page
  // Widened deliberately: the only assignment is inside a callback further down, which
  // control-flow analysis cannot see, so a plain `= null` narrows every read to `never`.
  let pendingTable = null as PendingTable | null;

  if (file.name.endsWith('.pdf')) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    totalPages = pdf.numPages;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => ('str' in item ? item.str : '')).join(' ');

      if (pageText.trim()) {
        pageTexts[pageNum] = pageText.replace(/\s+/g, ' ').trim();

        chunkWords(pageText.split(/\s+/).filter(Boolean)).forEach((chunkText, idx) => {
          chunks.push({
            id: `${docId}_p${pageNum}_c${idx}`,
            docId,
            filename,
            pageNumber: pageNum,
            text: chunkText,
            tokens: tokenizeText(chunkText)
          });
        });
      }

      // Render Page to Canvas
      try {
        const { canvas: pageCanvas, viewport } = await renderPageToCanvas(page, 1.5);
        // JPEG: a page render is a photo of the page, and as PNG a 145-page deck ran to
        // hundreds of megabytes. Diagrams and pictures stay PNG for crisp lines.
        const fullPageDataUrl = pageCanvas.toDataURL('image/jpeg', 0.85);

        // Add Full Page as fallback option
        images.push({
          id: `img_${docId}_p${pageNum}_full`,
          docId,
          filename,
          pageNumber: pageNum,
          dataUrl: fullPageDataUrl,
          caption: `Page ${pageNum} Full View (${filename})`,
          kind: 'page',
          width: pageCanvas.width,
          height: pageCanvas.height
        });

        const textLines = buildTextLines(textContent, viewport, 1.5);

        // Embedded pictures — photos, logos, figures with no caption. The caption-driven
        // crops below never see these, so without this a profile photo was not an image
        // the model could place at all.
        try {
          const opList = await page.getOperatorList();
          const rects = keepMeaningfulPictures(
            findPictureRects(opList.fnArray, opList.argsArray, pdfjsLib.OPS as unknown as PdfOps, viewport.transform as Matrix),
            pageCanvas.width,
            pageCanvas.height
          );
          rects.forEach((rect, idx) => {
            const crop = cropToCanvas(pageCanvas, rect.x, rect.y, rect.w, rect.h);
            images.push({
              id: `img_${docId}_p${pageNum}_pic${idx + 1}`,
              docId,
              filename,
              pageNumber: pageNum,
              dataUrl: crop.toDataURL('image/png'),
              caption: describePicture(idx + 1, pageNum, rect, pageCanvas.width, pageCanvas.height, textLines),
              kind: 'picture',
              width: crop.width,
              height: crop.height
            });
          });
        } catch (err) {
          console.warn(`Could not find embedded pictures on page ${pageNum}:`, err);
        }

        // A table left hanging by the previous page break continues at the top of this one
        const pending = pendingTable;
        if (pending) {
          const continuation = findContinuationRegion(
            textLines,
            pending.columnX0,
            pending.columnX1,
            pageCanvas.height
          );

          if (continuation) {
            pending.canvases.push(
              cropToCanvas(pageCanvas, continuation.x, continuation.y, continuation.w, continuation.h)
            );
            pending.pages.push(pageNum);

            const target = images[pending.imageIndex];
            const stitched = stitchCanvasesVertically(pending.canvases);
            target.dataUrl = stitched.toDataURL('image/png');
            target.width = stitched.width;
            target.height = stitched.height;
            target.caption = `${pending.baseCaption} (spans pages ${pending.pages[0]}-${
              pending.pages[pending.pages.length - 1]
            })`;

            // Might run over yet another page break
            if (!reachesPageBottom(continuation.y + continuation.h, textLines, pageCanvas.height)) {
              pendingTable = null;
            }
          } else {
            pendingTable = null;
          }
        }

        // Detect Table & Figure captions on joined text lines, then crop the region each
        // describes. Every match is scored and the strongest per figure number wins, so an
        // in-text reference earlier on the page cannot shadow the real caption below it.
        const bodyWidth = textLines.reduce((max, l) => Math.max(max, l.x1 - l.x0), 0);
        const bestByKey = new Map<
          string,
          { line: TextLine; kind: string; num: string; title: string; score: number }
        >();

        textLines.forEach((line) => {
          const match = line.text.match(CAPTION_REGEX);
          if (!match) return;

          const score = scoreCaptionCandidate(line, match[3], match[4], textLines, bodyWidth);
          if (score < CAPTION_SCORE_THRESHOLD) return;

          const kind = normalizeCaptionKind(match[1]);
          const num = match[2].toLowerCase();
          const key = `${kind}_${num}`;

          const existing = bestByKey.get(key);
          if (!existing || score > existing.score) {
            bestByKey.set(key, { line, kind, num, title: (match[4] || '').trim(), score });
          }
        });

        bestByKey.forEach(({ line, kind, num, title }, key) => {
          const region = computeCaptionCropRegion(line, kind, textLines, pageCanvas.width, pageCanvas.height);
          if (region.h < 60 || region.w < 60) return;

          const trimmedTitle = title.slice(0, 80);
          const captionTitle = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${num}${trimmedTitle ? `: ${trimmedTitle}` : ''}`;

          const cropCanvas = cropToCanvas(pageCanvas, region.x, region.y, region.w, region.h);

          images.push({
            id: `img_${docId}_p${pageNum}_${key}`,
            docId,
            filename,
            pageNumber: pageNum,
            dataUrl: cropCanvas.toDataURL('image/png'),
            caption: captionTitle,
            kind: 'crop',
            width: cropCanvas.width,
            height: cropCanvas.height
          });

          // A table running to the bottom of the page was cut off by the page break, not
          // finished — remember it so the rows on the next page get stitched on.
          if (kind === 'table' && reachesPageBottom(region.y + region.h, textLines, pageCanvas.height)) {
            pendingTable = {
              imageIndex: images.length - 1,
              baseCaption: captionTitle,
              columnX0: region.x,
              columnX1: region.x + region.w,
              canvases: [cropCanvas],
              pages: [pageNum]
            };
          }
        });

      } catch (err) {
        console.warn(`Could not render or crop page ${pageNum} images:`, err);
      }
    }

  } else {
    // Plain text / Markdown file
    const fileText = await file.text();
    const paragraphs = fileText.split(/\n\s*\n/);
    pageTexts[1] = fileText.trim();

    chunkParagraphs(paragraphs).forEach((chunkText, idx) => {
      chunks.push({
        id: `${docId}_para_${idx}`,
        docId,
        filename,
        pageNumber: 1,
        text: chunkText,
        tokens: tokenizeText(chunkText)
      });
    });
  }

  return {
    id: docId,
    filename,
    fileSize,
    uploadTimestamp,
    totalPages,
    chunks,
    images,
    pageTexts
  };
}
