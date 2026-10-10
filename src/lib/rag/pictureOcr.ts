/**
 * Reads the printed text inside pictures and image-only pages, locally, at upload time.
 *
 * Lecture decks are often built from screenshots: a slide is one big picture with its
 * labels baked into the pixels. In such a deck the lap-winding diagram's page had no
 * extractable text at all, so neither retrieval nor the picture's description could say
 * what it showed — asked for "the diagram of lap windings", the model could only guess
 * from page positions, and it picked a scan of handwritten notes.
 *
 * OCR on printed labels is reliable and cheap (a fifth of a second for a diagram), and it
 * runs here, once, in the browser — no model sees an image. What comes back:
 *
 *   - each picture's description gains the labels drawn in it ("Coils, Back Pitch, Front
 *     Pitch, Commutator…"), and says plainly when a picture is mostly text — a notes scan
 *     or a pasted paragraph — so it is not offered as a diagram;
 *   - pages with no text get their OCR'd text, so retrieval can find them at all.
 *
 * The heavy dependency (tesseract.js and its language data) is only loaded when there is
 * something to read.
 */

import type { DocumentChunk, TeacherDocument } from './pdfExtractor';
import { chunkWords, tokenizeText } from './pdfExtractor';

/** Bump when the OCR pass changes, so stored documents are upgraded once more. */
export const OCR_VERSION = 2;

/** A page with fewer words than this is treated as image-only. */
const TEXTLESS_PAGE_WORDS = 8;

/**
 * Text, not a diagram: many words AND long lines. Word count alone is not enough — a
 * diagram with every part labelled and described ("Yoke – outer frame, carries flux")
 * has as many words as a paragraph, and was hidden from a request for exactly that
 * diagram. Its lines are short, though; prose runs eight or ten words to a line.
 */
const TEXT_HEAVY_WORDS = 35;
const TEXT_HEAVY_WORDS_PER_LINE = 5;

const MAX_LABELS = 14;

export interface PictureReading {
  /** Distinct words drawn in the picture, in reading order. */
  labels: string[];
  /** Mostly prose: a notes scan, a pasted paragraph, a table. */
  textHeavy: boolean;
  /** Cleaned OCR text, for search. */
  text: string;
}

/**
 * Turns raw OCR output into something worth showing a model. OCR on a diagram returns its
 * labels mixed with noise from lines and arrows ("| Y.) y \ = 2 —"); real words survive a
 * letters-only filter, the noise does not.
 */
export function readPictureText(raw: string): PictureReading {
  const words = raw.match(/[A-Za-z][A-Za-z'-]{2,}/g) ?? [];
  const lineCounts = raw
    .split(String.fromCharCode(10)) // one OCR line per entry
    .map((line) => (line.match(/[A-Za-z][A-Za-z'-]{2,}/g) ?? []).length)
    .filter((n) => n > 0);
  const perLine = lineCounts.length > 0 ? words.length / lineCounts.length : words.length;
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (labels.length < MAX_LABELS) labels.push(w);
  }
  return {
    labels,
    textHeavy: words.length >= TEXT_HEAVY_WORDS && perLine >= TEXT_HEAVY_WORDS_PER_LINE,
    text: words.join(' ')
  };
}

/**
 * The description a picture gets once its text is read. The positional part stays — it
 * is still what answers "the photo in the top-right" — and the content follows it.
 */
export function describeWithReading(baseCaption: string, reading: PictureReading): string {
  // Strip a previous reading, so re-running the pass replaces rather than appends.
  // A picture with readable words in it is a diagram or a text image, not a photograph, so
  // the "photo-shaped" hint that helps find a profile photo would only mislead here.
  const stripped = baseCaption.replace(/ — (labels|mostly text|a picture with no readable).*$/, '');
  const base = reading.labels.length > 0 ? stripped.replace(' (photo-shaped)', '') : stripped;
  if (reading.textHeavy) {
    const opening = reading.labels.slice(0, 8).join(' ');
    return `${base} — mostly text, not a diagram (notes, a paragraph or a table): "${opening}…"`;
  }
  if (reading.labels.length === 0) return `${base} — a picture with no readable labels`;
  return `${base} — labels: ${reading.labels.join(', ')}`;
}

export function isTextlessPage(text: string | undefined): boolean {
  return (text ?? '').trim().split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length < TEXTLESS_PAGE_WORDS;
}

export function needsOcr(doc: TeacherDocument): boolean {
  return (doc.ocrVersion ?? 0) < OCR_VERSION;
}

type Recognize = (dataUrl: string) => Promise<string>;

/**
 * Runs the pass over one document and returns the changed fields. Pure with respect to the
 * document: the caller decides when to store the result, so an upload can finish OCR
 * before indexing while a restored document is upgraded in place.
 */
export async function ocrDocument(
  doc: TeacherDocument,
  onProgress?: (done: number, total: number) => void,
  recognize?: Recognize
): Promise<Pick<TeacherDocument, 'images' | 'pageTexts' | 'chunks' | 'ocrVersion'>> {
  const pictures = doc.images.filter((i) => i.kind === 'picture');
  const textlessPages = doc.images.filter((i) => i.kind === 'page' && isTextlessPage(doc.pageTexts[i.pageNumber]));
  const total = pictures.length + textlessPages.length;

  if (total === 0) {
    return { images: doc.images, pageTexts: doc.pageTexts, chunks: doc.chunks, ocrVersion: OCR_VERSION };
  }

  let release: (() => Promise<void>) | undefined;
  if (!recognize) {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('eng');
    recognize = async (dataUrl) => (await worker.recognize(dataUrl)).data.text;
    release = async () => {
      await worker.terminate();
    };
  }

  let done = 0;
  const tick = () => onProgress?.(++done, total);

  try {
    const images = [];
    for (const img of doc.images) {
      if (img.kind !== 'picture') {
        images.push(img);
        continue;
      }
      try {
        const reading = readPictureText(await recognize(img.dataUrl));
        images.push({ ...img, caption: describeWithReading(img.caption ?? '', reading), ocrText: reading.text.slice(0, 600) });
      } catch {
        images.push(img); // one unreadable picture should not sink the rest
      }
      tick();
    }

    const pageTexts = { ...doc.pageTexts };
    const chunks: DocumentChunk[] = doc.chunks.filter((c) => !c.id.includes('_ocr_'));
    const slideImages = new Map<string, (typeof doc.images)[number]>();
    for (const page of textlessPages) {
      try {
        const reading = readPictureText(await recognize(page.dataUrl));
        const text = reading.text;
        // A page with no text of its own is one picture filling the slide — in a deck built
        // from screenshots, that picture IS the diagram. It is described and offered like
        // any other picture, not filed away as a last-resort page scan.
        slideImages.set(page.id, {
          ...page,
          imageOnly: true,
          ocrText: text.slice(0, 600),
          caption: describeWithReading(`Page ${page.pageNumber}, an image-only slide`, reading)
        });
        if (text) {
          pageTexts[page.pageNumber] = `${(doc.pageTexts[page.pageNumber] ?? '').trim()} ${text}`.trim();
          chunkWords(text.split(/\s+/)).forEach((chunkText, idx) => {
            chunks.push({
              id: `${doc.id}_p${page.pageNumber}_ocr_${idx}`,
              docId: doc.id,
              filename: doc.filename,
              pageNumber: page.pageNumber,
              text: chunkText,
              tokens: tokenizeText(chunkText)
            });
          });
        }
      } catch {
        // leave the page as it was
      }
      tick();
    }

    return {
      images: images.map((img) => slideImages.get(img.id) ?? img),
      pageTexts,
      chunks,
      ocrVersion: OCR_VERSION
    };
  } finally {
    await release?.();
  }
}
