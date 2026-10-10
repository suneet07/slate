/**
 * Turns pen strokes into words, on this machine, for free.
 *
 * The board's whole premise is that a model reads it as text rather than as a
 * picture. Handwriting was the hole in that: the digest could say where writing
 * was and how big it was, but not what it said, so every question about the
 * board's own words needed a screenshot.
 *
 * Recognition here is deliberately old-fashioned and deterministic:
 *
 *   1. a line of writing is cut into characters at the gaps between them,
 *   2. each character is drawn into a small grid,
 *   3. that grid is compared against the same grid drawn from every glyph in
 *      glyphs.ts, using a distance transform so near-misses score well and the
 *      number of strokes and the order they were drawn in do not matter,
 *   4. the closest glyph wins, and how close it was becomes the confidence.
 *
 * Nothing here is learned and nothing is sent anywhere. It costs no tokens and
 * no network, and it gives the same answer every time — which matters, because
 * a reading that changes between two requests would make the model contradict
 * itself about what is on the board.
 *
 * It reads printed handwriting. Joined-up cursive defeats step 1, and when that
 * happens the confidence comes out low and the digest says so rather than
 * inventing words.
 */

import { confusableWith, GLYPHS, type Polyline } from './glyphs'

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Side of the square grid each character is drawn into for comparison. */
const RASTER = 24

/**
 * Distance, in grid cells, at which a match is worthless. A character that sits
 * on average this far from the template scores zero.
 */
const MAX_DISTANCE = 5.5

/** Below this, a reading is reported as uncertain rather than as fact. */
export const CONFIDENT = 0.55

export interface RecognizedChar {
  char: string
  /** 0..1. Above CONFIDENT the reading is stated plainly. */
  confidence: number
  /** Runners-up that scored nearly as well — "[E|F]" in the digest. */
  alternatives: string[]
  /**
   * A different letter matched just as well. Some pairs are the same drawing —
   * a capital I and a small l are one vertical bar — so a high score means the
   * match is good, not that the answer is settled.
   */
  ambiguous: boolean
  bounds: Rect
}

export interface RecognizedWord {
  text: string
  /** The weakest character in the word: a word is only as read as its worst letter. */
  confidence: number
  chars: RecognizedChar[]
  bounds: Rect
  /** The strokes this word was read from, so a doubtful word can be drawn out. */
  strokeNames: string[]
}

/** A pen stroke, reduced to what recognition needs. */
export interface StrokeInput {
  name: string
  points: Point[]
  bounds: Rect
}

// ------------------------------------------------------------- rasterising

type Grid = Uint8Array

/**
 * Draws strokes into a RASTER x RASTER grid, stretched to fill it, and reports
 * the shape's real width-to-height ratio separately.
 *
 * Stretching each axis independently is what makes the comparison work across
 * hands. Nobody writes letters at a fixed width — the same person's E is wider
 * when they are unhurried — and preserving that variation puts every letter in
 * a slightly different place on the grid, which swamps the differences that
 * actually matter. Filling the square removes width from the shape comparison
 * altogether.
 *
 * What that throws away is real, though: stretched to fill a square, an I and
 * an O are both a blob. So the ratio comes back alongside the grid and is
 * compared on its own terms, where being twice too wide is a fixed cost rather
 * than a smeared-out shape error.
 *
 * The stretch is measured from where the ink actually lies — its centre and its
 * spread — and not from its bounding box. Handwritten strokes overshoot: the
 * crossbar of an H runs past both stems, and against a bounding box that
 * overshoot drags the whole letter inwards, off the template's stems, and an H
 * ends up scoring worse than an 8. The spread of the ink barely notices the
 * overshoot, because almost all the ink is still in the stems.
 */
function rasterize(strokes: Polyline[]): { grid: Grid; aspect: number } {
  const grid = new Uint8Array(RASTER * RASTER)

  // Sample along the strokes, so the measurements reflect the length of the
  // ink rather than wherever the pen happened to be recorded.
  const pts = densify(strokes)
  if (pts.length === 0) return { grid, aspect: 1 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let sumX = 0
  let sumY = 0
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    sumX += x
    sumY += y
  }
  const meanX = sumX / pts.length
  const meanY = sumY / pts.length

  let varX = 0
  let varY = 0
  for (const [x, y] of pts) {
    varX += (x - meanX) ** 2
    varY += (y - meanY) ** 2
  }
  let sdX = Math.sqrt(varX / pts.length)
  let sdY = Math.sqrt(varY / pts.length)

  // An axis with no spread — a bare vertical stroke — cannot be stretched along
  // itself without turning pen wobble into shape. It is held at the narrowest
  // ratio still worth measuring.
  sdX = Math.max(sdX, sdY * ASPECT_MIN)
  sdY = Math.max(sdY, sdX * ASPECT_MIN)

  const margin = 2
  const usable = RASTER - 1 - margin * 2
  const centre = margin + usable / 2
  // A stroke spread evenly across the grid has a standard deviation of about a
  // third of its length, so this is what puts a typical letter inside the box.
  const SPREAD = 3.4
  const scaleX = usable / (sdX * SPREAD)
  const scaleY = usable / (sdY * SPREAD)

  const put = (gx: number, gy: number) => {
    if (gx >= 0 && gx < RASTER && gy >= 0 && gy < RASTER) grid[gy * RASTER + gx] = 1
  }
  const gx = (x: number) => Math.round(centre + (x - meanX) * scaleX)
  const gy = (y: number) => Math.round(centre + (y - meanY) * scaleY)

  for (const stroke of strokes) {
    if (stroke.length === 1) {
      put(gx(stroke[0][0]), gy(stroke[0][1]))
      continue
    }
    for (let i = 1; i < stroke.length; i++) {
      line(gx(stroke[i - 1][0]), gy(stroke[i - 1][1]), gx(stroke[i][0]), gy(stroke[i][1]), put)
    }
  }
  // The ratio still comes from the bounding box: it is the letter's real shape
  // that matters here, and a reader judges an I by how narrow it looks.
  const w = maxX - minX
  const h = maxY - minY
  return { grid, aspect: clampAspect(h > 0 ? w / h : ASPECT_MAX) }
}

/** Points along the strokes at an even spacing, for measuring ink. */
function densify(strokes: Polyline[]): Polyline {
  const out: Polyline = []
  let span = 0
  for (const stroke of strokes) {
    for (let i = 1; i < stroke.length; i++) {
      span = Math.max(span, Math.abs(stroke[i][0] - stroke[i - 1][0]), Math.abs(stroke[i][1] - stroke[i - 1][1]))
    }
  }
  const step = Math.max(span / 12, 1e-6)
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      out.push(stroke[0])
      continue
    }
    for (let i = 1; i < stroke.length; i++) {
      const [ax, ay] = stroke[i - 1]
      const [bx, by] = stroke[i]
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
      for (let s = 0; s <= steps; s++) {
        out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps])
      }
    }
  }
  return out
}

/**
 * Below this the ratio stops meaning anything: a hand-drawn vertical bar is a
 * line with no width at all, so an l, an I and a 1 all measure the same nothing.
 * Clamping here keeps the ratio from punishing whichever of them is right.
 */
const ASPECT_MIN = 0.18
const ASPECT_MAX = 12

/**
 * What being the wrong width costs, against shape error measured in grid cells.
 * Weighted so a factor-of-two error is worth about one cell — enough to keep an
 * I away from an O, not enough to reject a letter for being written narrow.
 */
const ASPECT_WEIGHT = 1.5

function clampAspect(a: number): number {
  return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, a))
}

function line(x0: number, y0: number, x1: number, y1: number, put: (x: number, y: number) => void) {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  for (;;) {
    put(x, y)
    if (x === x1 && y === y1) return
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}

/**
 * Distance from every cell to the nearest inked cell, by two-pass chamfer.
 *
 * This is what makes the comparison forgiving. Overlap alone is brittle: a
 * hand-drawn E one cell to the left of the template E overlaps almost nothing
 * and would score as badly as a Z. Against a distance field it scores "one cell
 * out", which is the truth.
 */
function distanceField(grid: Grid): Float32Array {
  const d = new Float32Array(RASTER * RASTER)
  const FAR = 1e6
  for (let i = 0; i < d.length; i++) d[i] = grid[i] ? 0 : FAR

  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= RASTER || y >= RASTER ? FAR : d[y * RASTER + x])
  // Chamfer weights: 1 orthogonally, ~sqrt(2) diagonally.
  const D = 1
  const Q = 1.41421356

  for (let y = 0; y < RASTER; y++) {
    for (let x = 0; x < RASTER; x++) {
      const i = y * RASTER + x
      d[i] = Math.min(d[i], at(x - 1, y) + D, at(x, y - 1) + D, at(x - 1, y - 1) + Q, at(x + 1, y - 1) + Q)
    }
  }
  for (let y = RASTER - 1; y >= 0; y--) {
    for (let x = RASTER - 1; x >= 0; x--) {
      const i = y * RASTER + x
      d[i] = Math.min(d[i], at(x + 1, y) + D, at(x, y + 1) + D, at(x + 1, y + 1) + Q, at(x - 1, y + 1) + Q)
    }
  }
  return d
}

export interface Template {
  char: string
  caseless: boolean
  grid: Grid
  field: Float32Array
  ink: number[]
  aspect: number
  /**
   * A thumb on the scale for how likely the character is at all. A slash and a
   * capital I are the same stroke, and on a classroom board it is an I far more
   * often than it is a slash; without this the tie is broken by rounding.
   */
  rarity: number
}

const PUNCTUATION = new Set(['-', '+', '=', '/', '(', ')', '?', '!'])

let templates: Template[] | null = null

function inkCells(grid: Grid): number[] {
  const out: number[] = []
  for (let i = 0; i < grid.length; i++) if (grid[i]) out.push(i)
  return out
}

function allTemplates(): Template[] {
  if (templates) return templates
  templates = GLYPHS.map((g) => {
    const { grid, aspect } = rasterize(g.strokes)
    return {
      char: g.char,
      caseless: g.caseless === true,
      grid,
      field: distanceField(grid),
      ink: inkCells(grid),
      // The glyphs are drawn in a square box for legibility, so their measured
      // ratio is not the letter's real one. Where it matters, the glyph says.
      aspect: clampAspect(g.aspect ?? aspect),
      rarity: PUNCTUATION.has(g.char) ? 0.3 : 0,
    }
  })
  return templates
}

/**
 * Mean of the two one-way distances between the drawn character and a template.
 *
 * Both directions are needed. One way alone says "everything I drew is on the
 * template", which an I satisfies against almost every letter — an I lies neatly
 * on top of the stem of a B. The reverse direction is what notices that most of
 * the B is missing.
 */
function compare(ink: number[], field: Float32Array, aspect: number, template: Template): number {
  if (ink.length === 0 || template.ink.length === 0) return MAX_DISTANCE

  let forward = 0
  for (const i of ink) forward += template.field[i]
  forward /= ink.length

  let backward = 0
  for (const i of template.ink) backward += field[i]
  backward /= template.ink.length

  // Ratios are compared as a ratio, not a difference: being half as wide as
  // expected should cost the same as being twice as wide, and it does on a log
  // scale. Weighted so a factor-of-two error is worth about one grid cell of
  // shape error — enough to keep an I away from an O, not enough to reject a
  // letter for being written a bit narrow.
  const penalty = ASPECT_WEIGHT * Math.abs(Math.log(aspect / template.aspect))

  return (forward + backward) / 2 + penalty + template.rarity
}

// ----------------------------------------------------------- segmentation

/**
 * Cuts a word into characters at the vertical gaps between them.
 *
 * The cut is made on where the ink actually is, not on stroke bounding boxes.
 * Boxes get this wrong in both directions: the two stems of an H do not overlap
 * at all and would be torn into separate letters, while a t-bar reaching over
 * its neighbour overlaps something it has nothing to do with. Ink does not lie
 * — the crossbar of the H fills the space between its stems, so there is no gap
 * to cut at, and the letter stays whole however many strokes it took.
 *
 * Letters written joined-up have no gaps either, so they come out as one wide
 * blob, match badly, and are reported as uncertain. That is the honest answer.
 */
function segmentCharacters(strokes: StrokeInput[]): StrokeInput[][] {
  if (strokes.length <= 1) return strokes.length > 0 ? [strokes] : []

  const bounds = unionBounds(strokes)
  const height = bounds.h || 1
  // Fine enough to see a tight gap between two letters. Holes inside a letter are not a
  // risk at this resolution: bins are filled along the stroke path, so a column is empty
  // only where no stroke passes over it at all.
  const bin = Math.max(0.5, height / 48)
  const bins = Math.ceil(bounds.w / bin) + 1
  const filled = new Uint8Array(bins)

  const mark = (x: number) => {
    const i = Math.round((x - bounds.x) / bin)
    if (i >= 0 && i < bins) filled[i] = 1
  }
  for (const stroke of strokes) {
    const pts = stroke.points
    if (pts.length === 1) mark(pts[0].x)
    for (let i = 1; i < pts.length; i++) {
      // Fill between samples: a fast stroke can jump several bins at a time.
      const from = Math.min(pts[i - 1].x, pts[i].x)
      const to = Math.max(pts[i - 1].x, pts[i].x)
      for (let x = from; x < to; x += bin) mark(x)
      mark(to)
    }
  }

  // Any clear vertical gap in the ink is a letter boundary: a letter's own strokes overlap
  // horizontally, so a column with no ink in it lies between letters. The threshold only
  // has to beat pen jitter. It was once 12% of the writing's height, which assumed wide
  // spacing — real lowercase writing has a tall ascender setting that height and letters
  // packed close, and a handwritten "hi" (11px apart under a 96px h) was read as one
  // letter, then thrown out as not-writing, and the board was reported empty.
  const gapBins = Math.max(1, Math.round((height * 0.04) / bin))

  const cuts: number[] = []
  let run = 0
  for (let i = 0; i < bins; i++) {
    if (filled[i]) {
      if (run >= gapBins) cuts.push(bounds.x + (i - run / 2) * bin)
      run = 0
    } else {
      run++
    }
  }

  if (cuts.length === 0) return [strokes]

  const groups: StrokeInput[][] = Array.from({ length: cuts.length + 1 }, () => [])
  for (const stroke of strokes) {
    // Which side of the cuts most of this stroke lies on. A majority of its
    // points rather than its midpoint, so a stroke that leans over a boundary
    // still lands where its body is.
    const votes = new Array<number>(groups.length).fill(0)
    for (const p of stroke.points) votes[sliceFor(p.x, cuts)]++
    let best = 0
    for (let i = 1; i < votes.length; i++) if (votes[i] > votes[best]) best = i
    groups[best].push(stroke)
  }
  return groups.filter((g) => g.length > 0)
}

function sliceFor(x: number, cuts: number[]): number {
  let i = 0
  while (i < cuts.length && x >= cuts[i]) i++
  return i
}

function unionBounds(strokes: StrokeInput[]): Rect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of strokes) {
    minX = Math.min(minX, s.bounds.x)
    minY = Math.min(minY, s.bounds.y)
    maxX = Math.max(maxX, s.bounds.x + s.bounds.w)
    maxY = Math.max(maxY, s.bounds.y + s.bounds.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ------------------------------------------------------------- line metrics

/**
 * How tall the writing is and where it sits.
 *
 * Case cannot come from shape — a capital O and a small o are the same drawing.
 * It comes from height: the letters on a line are measured together, the tall
 * ones are capitals and the short ones are not. Punctuation falls out of the
 * same measurement, being far shorter than either.
 */
export interface LineMetrics {
  capHeight: number
  baseline: number
  /**
   * True when every letter on the line is the same height, so there is nothing
   * to measure case against. WORDS IN CAPITALS and words in small letters both
   * look like this, and only the words themselves say which — so both cases get
   * offered rather than one being guessed at.
   */
  caseUncertain: boolean
}

export function lineMetrics(chars: Rect[]): LineMetrics {
  if (chars.length === 0) return { capHeight: 1, baseline: 0, caseUncertain: true }
  const heights = chars.map((c) => c.h).sort((a, b) => a - b)
  // The tallest letter, but not an outlier: the 85th percentile ignores one
  // stray ascender without being dragged down by a line of small letters.
  const capHeight = heights[Math.min(heights.length - 1, Math.floor(heights.length * 0.85))] || 1
  const bottoms = chars.map((c) => c.y + c.h).sort((a, b) => a - b)
  const baseline = bottoms[Math.floor(bottoms.length / 2)]
  // Ignore punctuation, which is short on every line and would fake contrast.
  const letters = heights.filter((h) => h > capHeight * 0.45)
  const contrast = letters.length > 0 ? capHeight / letters[0] : 1
  return { capHeight, baseline, caseUncertain: contrast < 1.25 }
}

// ------------------------------------------------------------- recognition

/**
 * Every glyph scored against one drawn character, closest first.
 *
 * Exported because when a reading comes out wrong the only useful question is
 * which glyphs it actually preferred and by how much — guessing at that from
 * the final letter wastes far more time than printing the table.
 */
export function rankGlyphs(group: StrokeInput[]): { template: Template; distance: number }[] {
  const { grid, aspect } = rasterize(group.map((s) => s.points.map((p) => [p.x, p.y])))
  const ink = inkCells(grid)
  const field = distanceField(grid)
  return allTemplates()
    .map((t) => ({ template: t, distance: compare(ink, field, aspect, t) }))
    .sort((a, b) => a.distance - b.distance)
}

/** Cuts a word into characters and returns each one's stroke group. */
export function charGroups(strokes: StrokeInput[]): StrokeInput[][] {
  return segmentCharacters(strokes)
}

/**
 * Whether one stroke of a character is a dot standing clear above or below the rest.
 * "Clear" means a real vertical gap and a mark far smaller than the body — the bar of a t
 * or the top of a T touches its stem, so neither counts.
 */
function dotPosition(group: StrokeInput[]): 'above' | 'below' | null {
  if (group.length < 2) return null
  const sorted = [...group].sort((a, b) => a.bounds.y - b.bounds.y)
  const candidates: ['above' | 'below', StrokeInput, StrokeInput[]][] = [
    ['above', sorted[0], sorted.slice(1)],
    ['below', sorted[sorted.length - 1], sorted.slice(0, -1)]
  ]
  for (const [where, mark, rest] of candidates) {
    const body = unionBounds(rest)
    if (body.h <= 0) continue
    const size = Math.max(mark.bounds.w, mark.bounds.h)
    const gap =
      where === 'above' ? body.y - (mark.bounds.y + mark.bounds.h) : mark.bounds.y - (body.y + body.h)
    if (size <= body.h * 0.35 && gap >= body.h * 0.08) return where
  }
  return null
}

function recognizeChar(group: StrokeInput[], metrics: LineMetrics): RecognizedChar {
  const bounds = unionBounds(group)

  // Marks far too small to be a letter are punctuation, decided by where they
  // sit rather than by shape: normalised to a box, a full stop is just a blob.
  if (bounds.h < metrics.capHeight * 0.3 && bounds.w < metrics.capHeight * 0.4) {
    const belowBaseline = bounds.y + bounds.h > metrics.baseline - metrics.capHeight * 0.12
    const tall = bounds.h > bounds.w * 1.4
    const char = belowBaseline ? (tall ? ',' : '.') : '-'
    return { char, confidence: 0.6, alternatives: [], ambiguous: false, bounds }
  }

  let scored = rankGlyphs(group)

  // A dot is decided by structure, not shape. A small mark standing clear above a stroke
  // is the dot of an i or a j — nothing else is drawn that way — but to the shape matcher
  // it is a few cells of ink beside a long bar, and a bare bar (I, l) wins on distance.
  // A small mark clear below is the point of an ! or a ?.
  const dot = dotPosition(group)
  if (dot) {
    const allowed = dot === 'above' ? ['i', 'j'] : ['!', '?']
    const restricted = scored.filter((s) => allowed.includes(s.template.char))
    if (restricted.length > 0) scored = restricted
  }

  const best = scored[0]
  if (!best) return { char: '?', confidence: 0, alternatives: [], ambiguous: false, bounds }

  const confidence = Math.max(0, 1 - best.distance / MAX_DISTANCE)
  const char = applyCase(best.template, bounds, metrics)

  // Runners-up worth showing: a different letter that scored nearly as well.
  const alternatives: string[] = []
  let ambiguous = false
  for (const s of scored.slice(1)) {
    if (alternatives.length >= 2) break
    const alt = applyCase(s.template, bounds, metrics)
    if (alt === char || alternatives.includes(alt)) continue
    if (s.distance > best.distance * 1.18 + 0.15) break
    // A near-tie on distance means the two are the same drawing, whatever the
    // absolute score was.
    if (s.distance <= best.distance * 1.06 + 0.05) ambiguous = true
    alternatives.push(alt)
  }

  // Characters that are the same drawing are always offered together, however
  // the distances happened to fall. A zero read as an O is not a close call the
  // matcher can improve on — it is a question only the word can answer, so the
  // word gets asked.
  const twins = confusableWith(char).filter((c) => !alternatives.includes(c))
  if (twins.length > 0) {
    ambiguous = true
    alternatives.push(...twins.slice(0, 2))
  }

  // On a line with no tall letters to measure against, the case of a letter
  // whose two forms are the same shape cannot be settled here.
  if (best.template.caseless && metrics.caseUncertain) {
    const other = char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()
    if (other !== char && !alternatives.includes(other)) {
      ambiguous = true
      alternatives.unshift(other)
    }
  }

  return { char, confidence, alternatives, ambiguous, bounds }
}

function applyCase(template: Template, bounds: Rect, metrics: LineMetrics): string {
  if (!template.caseless) return template.char
  const tall = bounds.h >= metrics.capHeight * 0.78
  return tall ? template.char.toUpperCase() : template.char.toLowerCase()
}

/** Reads one word. Characters are cut out first, then matched one at a time. */
export function recognizeWord(strokes: StrokeInput[], metrics: LineMetrics): RecognizedWord {
  const groups = segmentCharacters(strokes)
  const chars = groups.map((g) => recognizeChar(g, metrics))
  return {
    text: chars.map((c) => c.char).join(''),
    confidence: chars.length === 0 ? 0 : Math.min(...chars.map((c) => c.confidence)),
    chars,
    bounds: unionBounds(strokes),
    strokeNames: strokes.map((s) => s.name),
  }
}

/**
 * Reads a line of writing that has already been split into words.
 *
 * Metrics are taken across the whole line rather than per word, so a short word
 * of small letters is not mistaken for a line of capitals.
 */
export function recognizeLine(words: StrokeInput[][]): RecognizedWord[] {
  const allChars = words.flatMap((w) => segmentCharacters(w)).map(unionBounds)
  const metrics = lineMetrics(allChars)
  return words.map((w) => recognizeWord(w, metrics))
}

/** How a word is written into the digest: plainly, or hedged with alternatives. */
export function spellWord(word: RecognizedWord): string {
  return word.chars
    .map((c) =>
      c.alternatives.length > 0 && (c.ambiguous || c.confidence < CONFIDENT)
        ? `[${[c.char, ...c.alternatives].join('|')}]`
        : c.char,
    )
    .join('')
}

/**
 * The grid a character or a glyph is actually compared as, for debugging.
 * Pass strokes to see a drawn character, or a glyph name to see its template.
 */
export function debugGrid(strokes: Polyline[] | null, glyph?: string): string[] {
  const grid = strokes
    ? rasterize(strokes).grid
    : allTemplates().find((t) => t.char === glyph)!.grid
  const rows: string[] = []
  for (let y = 0; y < RASTER; y++) {
    let row = ''
    for (let x = 0; x < RASTER; x++) row += grid[y * RASTER + x] ? '#' : '.'
    rows.push(row)
  }
  return rows
}

/** The parts of one comparison, for working out why a match went wrong. */
export function debugCompare(strokes: Polyline[], glyph: string) {
  const { grid, aspect } = rasterize(strokes)
  const ink = inkCells(grid)
  const field = distanceField(grid)
  const t = allTemplates().find((x) => x.char === glyph)!
  let forward = 0
  for (const i of ink) forward += t.field[i]
  forward /= ink.length
  let backward = 0
  for (const i of t.ink) backward += field[i]
  backward /= t.ink.length
  return {
    glyph,
    forward: +forward.toFixed(3),
    backward: +backward.toFixed(3),
    aspectPenalty: +(ASPECT_WEIGHT * Math.abs(Math.log(aspect / t.aspect))).toFixed(3),
    rarity: t.rarity,
    drawnInk: ink.length,
    templateInk: t.ink.length,
    total: +compare(ink, field, aspect, t).toFixed(3),
  }
}
