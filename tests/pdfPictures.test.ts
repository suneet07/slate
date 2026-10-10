/* @ts-nocheck */
/**
 * Embedded-picture detection, as pure geometry against hand-built operator lists.
 *
 * A PDF paints a picture into the unit square under the current transform, so these
 * replay the same instruction shapes pdf.js produces: save, transform, paint, restore.
 */
import { describePicture, findPictureRects, keepMeaningfulPictures } from '../src/lib/rag/pdfPictures';

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
};

// pdf.js 3.x operator codes
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageXObjectRepeat: 88
};

// An A4 page (595 x 842 pt) rendered at 1.5x. PDF space has y pointing up; the viewport
// flips it, exactly as pdf.js's viewport.transform does.
const SCALE = 1.5;
const PAGE_W = 595 * SCALE;
const PAGE_H = 842 * SCALE;
const VIEWPORT = [SCALE, 0, 0, -SCALE, 0, 842 * SCALE];

// A 100x130pt photo whose bottom-left corner is at (450, 650) in PDF space — top-right of
// the page, the way a profile photo sits.
const photoOps = {
  fn: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
  args: [[], [100, 0, 0, 130, 450, 650], ['img_p0_1', 100, 130], []]
};
const [photo] = findPictureRects(photoOps.fn, photoOps.args, OPS, VIEWPORT);
const near = (a, b) => Math.abs(a - b) < 0.5;
check('photo found', Boolean(photo));
check('x from the left edge', near(photo.x, 450 * SCALE), `${photo.x}`);
check('y measured from the top, not the bottom', near(photo.y, (842 - 650 - 130) * SCALE), `${photo.y}`);
check('width', near(photo.w, 100 * SCALE), `${photo.w}`);
check('height', near(photo.h, 130 * SCALE), `${photo.h}`);

// Restore must undo the transform, or a later picture inherits the photo's matrix.
const two = findPictureRects(
  [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore],
  [[], [100, 0, 0, 130, 450, 650], [], [], [], [200, 0, 0, 100, 50, 100], [], []],
  OPS,
  VIEWPORT
);
check('second picture is placed by its own transform alone', near(two[1].x, 50 * SCALE) && near(two[1].w, 200 * SCALE), JSON.stringify(two[1]));

// A form XObject nests a matrix; the picture inside is positioned by both.
const inForm = findPictureRects(
  [OPS.paintFormXObjectBegin, OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintFormXObjectEnd],
  [[[1, 0, 0, 1, 100, 200], [0, 0, 300, 300]], [], [80, 0, 0, 80, 10, 10], [], [], []],
  OPS,
  VIEWPORT
);
check('picture inside a form is offset by the form matrix', near(inForm[0].x, 110 * SCALE), `${inForm[0]?.x}`);

// Filtering: icons and full-page scans are not "pictures" worth offering.
const kept = keepMeaningfulPictures(
  [
    photo,
    { x: 10, y: 10, w: 12, h: 12 }, // a bullet icon
    { x: 0, y: 0, w: PAGE_W, h: PAGE_H }, // a page-sized scan
    { ...photo, x: photo.x + 1 } // the photo drawn twice
  ],
  PAGE_W,
  PAGE_H
);
check('only the photo survives filtering', kept.length === 1, `${kept.length} kept`);

// The description is what lets "my photo" find it.
const caption = describePicture(1, 1, photo, PAGE_W, PAGE_H, [
  { text: 'STUDENT DETAILS', x0: 60, x1: 400, yTop: 420, yBottom: 440 },
  { text: 'Student Profile', x0: 600, x1: 760, yTop: photo.y - 30, yBottom: photo.y - 10 }
]);
check('describes where it sits', /top-right/.test(caption), caption);
check('describes it as photo-shaped', /photo-shaped/.test(caption), caption);
check('names the closest label', /near "Student Profile"/.test(caption), caption);

check('no paint operations means no pictures', findPictureRects([OPS.save, OPS.restore], [[], []], OPS, VIEWPORT).length === 0);

console.log(failures === 0 ? '\nALL PASS' : `\nFAILURE: ${failures} check(s) failed`);
if (failures > 0) process.exitCode = 1;
