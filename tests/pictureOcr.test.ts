/* @ts-nocheck */
/**
 * The OCR pass, driven with real OCR output from a lecture deck (Unit 2, DC machines).
 *
 * In that deck the lap-winding diagram sat on a page with no extractable text, so nothing
 * said what it showed, and asked for "the diagram of lap windings" the model chose a scan
 * of handwritten notes. These strings are what tesseract actually returned for those two
 * pictures; the recogniser itself is faked so the test needs no browser or language data.
 */
import { describeWithReading, isTextlessPage, needsOcr, ocrDocument, readPictureText, OCR_VERSION } from '../src/lib/rag/pictureOcr';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

const DIAGRAM_OCR =
  'Coils Progres: s 1 2 3 2 ack Pitch te Front Pitch — | Resultant pitch or SS “ winding pitch 0 © 1) 3 2 3 4 | Y.) y Commutator pitch \\ = 2 — , a';
const NOTES_SCAN_OCR =
  '226 Simplex Lap-winding 4 Commer pich — + Conmatator pitch for simplex lap-winding is Sis p-vindng onl sige als To lp | idng, the foiding od of oe col is comectd fou | a conmulatr sent and bo the Sorting end of the aduce col situated under the same pole and so on till all the coils have been connected This type of winding derives its name from the fact that it doubles or laps back with its succeeding coils';

// --- reading a picture
const diagram = readPictureText(DIAGRAM_OCR);
check('diagram labels survive, line noise does not', diagram.labels.includes('Commutator') && !diagram.labels.some((l) => /[|\\©]/.test(l)), diagram.labels.join(', '));
check('repeated labels are listed once', diagram.labels.filter((l) => l.toLowerCase() === 'pitch').length === 1);
check('a labelled diagram is not text-heavy', !diagram.textHeavy, `${diagram.text.split(' ').length} words`);

const notes = readPictureText(NOTES_SCAN_OCR);
check('a scan of notes is text-heavy', notes.textHeavy, `${notes.text.split(' ').length} words`);

// The "DC machine with all its parts labelled and described" slide: as many words as a
// paragraph, but every line is a short label. Word count alone hid it from a request for it.
const LABELLED_DIAGRAM_OCR = `MAIN PARTS OF DC MACHINE
Yoke outer frame
carries magnetic flux
Pole core and pole shoe
spreads flux in air gap
Field winding excites poles
Armature core laminated steel
Armature winding copper conductors
Commutator converts alternating current
Brushes collect current
Shaft transmits mechanical power
Bearings support rotating shaft
Cooling fan removes heat`;
const labelled = readPictureText(LABELLED_DIAGRAM_OCR);
check('a diagram with described labels is not mistaken for text', !labelled.textHeavy,
  `${labelled.text.split(' ').length} words, short lines`);

const NOTES_WITH_LINES = `In a simplex lap winding the finishing end of one coil is connected
to a commutator segment and to the starting end of the adjacent coil
situated under the same pole and so on till all the coils have been
connected this type of winding derives its name from the fact that it
doubles or laps back with its succeeding coils and the number of parallel`;
check('prose with long lines is still text-heavy', readPictureText(NOTES_WITH_LINES).textHeavy);

// --- descriptions
const base = 'Picture 1 on page 118 — middle-right, portrait (photo-shaped)';
const described = describeWithReading(base, diagram);
check('a diagram is described by its labels', /labels: .*Front.*Commutator/.test(described), described);
check('the position stays in the description', described.startsWith('Picture 1 on page 118 — middle-right, portrait'));
check('a labelled picture is not hinted to be a photo', !/photo-shaped/.test(described), described);
const notesDescribed = describeWithReading('Picture 1 on page 125 — middle-left', notes);
check('a notes scan is said not to be a diagram', /mostly text, not a diagram/.test(notesDescribed), notesDescribed);
check('running the pass twice does not stack descriptions', describeWithReading(described, diagram) === described);

// --- pages
check('a page with only a page number is textless', isTextlessPage('117'));
check('a page with real prose is not', !isTextlessPage('The armature winding is placed on the slots of the armature core.'));

// --- the whole pass over a document
const doc = {
  id: 'doc1',
  filename: 'Unit 2.pdf',
  images: [
    { id: 'p118_page', kind: 'page', pageNumber: 118, dataUrl: 'page118', docId: 'doc1', filename: 'Unit 2.pdf' },
    { id: 'p118_pic1', kind: 'picture', pageNumber: 118, dataUrl: 'pic118', caption: base, docId: 'doc1', filename: 'Unit 2.pdf' },
    { id: 'p125_pic1', kind: 'picture', pageNumber: 125, dataUrl: 'pic125', caption: 'Picture 1 on page 125 — middle-left', docId: 'doc1', filename: 'Unit 2.pdf' },
    { id: 'p23_page', kind: 'page', pageNumber: 23, dataUrl: 'page23', docId: 'doc1', filename: 'Unit 2.pdf' }
  ],
  pageTexts: { 118: '', 23: 'The armature winding is placed on the slots of the armature core and is made of copper.' },
  chunks: []
};
const fakeOcr = {
  pic118: DIAGRAM_OCR,
  pic125: NOTES_SCAN_OCR,
  page118: 'Lap Winding Progressive Coils Back Pitch Front Pitch Commutator pitch',
  page23: 'should never be read — this page already has text'
};
const seen = [];
const patch = await ocrDocument(doc, undefined, async (url) => {
  seen.push(url);
  return fakeOcr[url];
});

check('pages that already have text are not OCR’d', !seen.includes('page23'), seen.join(','));
check('the image-only page gets its text', /Lap Winding/.test(patch.pageTexts[118]), patch.pageTexts[118]);
const slide = patch.images.find((i) => i.id === 'p118_page');
check('an image-only slide is marked as a picture in its own right', slide.imageOnly === true);
check('and described by what it shows', /image-only slide — labels: .*Pitch/.test(slide.caption), slide.caption);
check('a page that has its own text is left as a plain page scan', !patch.images.find((i) => i.id === 'p23_page').imageOnly);
check('and becomes searchable', patch.chunks.some((c) => c.pageNumber === 118 && c.tokens.length > 0));
check('the diagram is described by its labels', /labels:/.test(patch.images.find((i) => i.id === 'p118_pic1').caption));
check('the notes scan is marked as text', /mostly text/.test(patch.images.find((i) => i.id === 'p125_pic1').caption));
check('the document is marked as done', patch.ocrVersion === OCR_VERSION && !needsOcr({ ...doc, ...patch }));
check('a document saved before OCR needs it', needsOcr(doc));

// One unreadable picture must not sink the pass.
const partial = await ocrDocument(doc, undefined, async (url) => {
  if (url === 'pic125') throw new Error('corrupt image');
  return fakeOcr[url];
});
check('a failing picture is skipped, the rest are read', /labels:/.test(partial.images.find((i) => i.id === 'p118_pic1').caption));

console.log(failures === 0 ? '\nALL PASS' : `\nFAILURE: ${failures} check(s) failed`);
if (failures > 0) process.exitCode = 1;
