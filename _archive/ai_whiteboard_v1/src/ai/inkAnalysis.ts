/**
 * Makes pen strokes legible to a language model without a screenshot.
 *
 * A bounding box tells a model nothing — "ink1 at C7, 3x2" could be a circle,
 * a word, or a scribble. This module measures each stroke geometrically
 * (closed? round? straight? which way does the arc open?), works out how the
 * strokes sit relative to each other (inside, mirrored, above), and groups
 * touching strokes into drawings.
 *
 * The output is a description precise enough for the model to reconstruct the
 * picture in its head and place new marks on it:
 *
 *   DRAWING d1 (teacher, 5 strokes) spans B2..F5, centre D4
 *     ink1  large closed circle            B2..F5
 *     ink2  small mark   inside ink1, upper-left   (mirrors ink3)
 *     ink3  small mark   inside ink1, upper-right  (mirrors ink2)
 *     ink4  arc opening up  inside ink1, lower-middle, wide
 *     ink5  short vertical line  inside ink1, centre
 */

import { inkBounds, type Rect } from '../engine/geometry'
import { formatCell, worldToCell } from '../engine/grid'
import type { InkShape, Point, Shape } from '../engine/types'
import { isInk } from '../engine/types'
import { charGroups, CONFIDENT, recognizeLine, spellWord, type RecognizedWord } from './handwriting'

export type StrokeClass =
  | 'dot'
  | 'line'
  | 'circle'
  | 'ellipse'
  | 'rectangle'
  | 'triangle'
  | 'polygon'
  | 'arc'
  | 'curve'
  | 'zigzag'
  | 'loop'

export interface StrokeShape {
  name: string
  class: StrokeClass
  bounds: Rect
  centre: Point
  /** The raw pen path. Handwriting recognition needs the shape, not the box. */
  points: Point[]
  /** Path length in world units. */
  length: number
  closed: boolean
  /** 1 = perfect circle. Only meaningful for closed strokes. */
  circularity: number
  /** Straight-line distance between the ends, over path length. 1 = straight. */
  straightness: number
  corners: number
  /** For arcs and open curves: the side the curve opens towards. */
  opens?: 'up' | 'down' | 'left' | 'right'
  /** For straight lines. */
  direction?: 'horizontal' | 'vertical' | 'diagonal'
  /** Relative to everything else on the board. */
  sizeWord: 'tiny' | 'small' | 'medium' | 'large'
}

export interface StrokeRelation {
  /** Stroke this one sits inside. */
  inside?: string
  /** Where inside it: "upper-left", "centre", "lower-middle"... */
  region?: string
  /** A stroke of similar size mirrored about the container's vertical axis. */
  mirrors?: string
  /** Coarse relation when not contained: "above ink1", "right of ink2". */
  near?: string
}

export interface Drawing {
  id: string
  bounds: Rect
  strokes: StrokeShape[]
  relations: Map<string, StrokeRelation>
  author: 'human' | 'ai'
}

/** A run of small strokes sitting on a shared baseline — writing, not a picture. */
export interface TextBlock {
  id: string
  bounds: Rect
  lines: TextLine[]
  strokeCount: number
  author: 'human' | 'ai'
}

export interface TextLine {
  strokes: StrokeShape[]
  /** Stroke groups separated by wide horizontal gaps — roughly words. */
  words: StrokeShape[][]
  bounds: Rect
  /** What the words say, one entry per word, read locally from the stroke paths. */
  reading: RecognizedWord[]
}

// ------------------------------------------------------------- measurement

function pathLength(pts: Point[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return total
}

/** Shoelace area of the polygon formed by the stroke (closed implicitly). */
function polygonArea(pts: Point[]): number {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/**
 * Counts sharp turns. Points are walked at a fixed arc-length step so that
 * sampling density (fast vs slow strokes) does not change the answer.
 */
function countCorners(pts: Point[], step: number): { corners: number; turnSign: number } {
  const sampled = resampleByLength(pts, step)
  let corners = 0
  let turnTotal = 0
  let turnAbs = 0
  for (let i = 1; i < sampled.length - 1; i++) {
    const a = sampled[i - 1]
    const b = sampled[i]
    const c = sampled[i + 1]
    const angle1 = Math.atan2(b.y - a.y, b.x - a.x)
    const angle2 = Math.atan2(c.y - b.y, c.x - b.x)
    let turn = angle2 - angle1
    while (turn > Math.PI) turn -= Math.PI * 2
    while (turn < -Math.PI) turn += Math.PI * 2
    turnTotal += turn
    turnAbs += Math.abs(turn)
    if (Math.abs(turn) > 1.0) corners++
  }
  // A consistent turn direction means a smooth arc; alternating means a zigzag.
  const consistency = turnAbs === 0 ? 1 : Math.abs(turnTotal) / turnAbs
  return { corners, turnSign: consistency }
}

function resampleByLength(pts: Point[], step: number): Point[] {
  if (pts.length < 2) return pts
  const out: Point[] = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    carry += d
    if (carry >= step) {
      out.push(b)
      carry = 0
    }
  }
  if (out.length < 2) out.push(pts[pts.length - 1])
  return out
}

/** Which way an open curve opens: away from its bulge. */
function arcOpening(pts: Point[]): 'up' | 'down' | 'left' | 'right' {
  const first = pts[0]
  const last = pts[pts.length - 1]
  const mid = pts[Math.floor(pts.length / 2)]
  const chordMid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }
  const bulgeX = mid.x - chordMid.x
  const bulgeY = mid.y - chordMid.y
  if (Math.abs(bulgeY) >= Math.abs(bulgeX)) return bulgeY > 0 ? 'up' : 'down'
  return bulgeX > 0 ? 'left' : 'right'
}

export function classifyStroke(shape: InkShape, cellSize: number): StrokeShape {
  const pts = shape.points
  const bounds = inkBounds(shape)
  const centre = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
  const length = pathLength(pts)
  const diag = Math.hypot(bounds.w, bounds.h)
  const gap = pts.length > 1
    ? Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y)
    : 0
  const straightness = length > 0 ? gap / length : 0
  const closed = length > 0 && gap < Math.max(length * 0.22, cellSize * 0.25)
  const { corners, turnSign } = countCorners(pts, Math.max(4, length / 40))

  const area = polygonArea(pts)
  const circularity = length > 0 ? (4 * Math.PI * area) / (length * length) : 0
  const aspect = bounds.h === 0 ? 99 : bounds.w / bounds.h
  const fill = bounds.w * bounds.h === 0 ? 0 : area / (bounds.w * bounds.h)

  const sizeWord: StrokeShape['sizeWord'] =
    diag < cellSize * 0.35 ? 'tiny'
    : diag < cellSize * 1.2 ? 'small'
    : diag < cellSize * 3.5 ? 'medium'
    : 'large'

  const base: StrokeShape = {
    name: shape.name,
    class: 'curve',
    bounds,
    centre,
    points: pts,
    length,
    closed,
    circularity,
    straightness,
    corners,
    sizeWord,
  }

  // A dot is judged by how far the pen travelled, not by the point count — a
  // fast straight stroke can be two points and is still a line.
  if (length < cellSize * 0.18 || pts.length < 2) {
    return { ...base, class: 'dot', sizeWord: 'tiny' }
  }

  if (closed) {
    if (circularity > 0.7 && corners <= 2) {
      return { ...base, class: aspect > 0.75 && aspect < 1.33 ? 'circle' : 'ellipse' }
    }
    if (corners === 3 && fill > 0.35) return { ...base, class: 'triangle' }
    if (corners === 4 && fill > 0.62) return { ...base, class: 'rectangle' }
    if (corners >= 3 && corners <= 8) return { ...base, class: 'polygon' }
    return { ...base, class: 'loop' }
  }

  if (straightness > 0.93) {
    const dx = Math.abs(pts[pts.length - 1].x - pts[0].x)
    const dy = Math.abs(pts[pts.length - 1].y - pts[0].y)
    const direction: StrokeShape['direction'] =
      dx > dy * 2.5 ? 'horizontal' : dy > dx * 2.5 ? 'vertical' : 'diagonal'
    return { ...base, class: 'line', direction }
  }

  // Open, not straight: either a clean arc or a scribble.
  if (turnSign > 0.7 && corners <= 2) {
    return { ...base, class: 'arc', opens: arcOpening(pts) }
  }
  if (corners >= 4) return { ...base, class: 'zigzag' }
  return { ...base, class: 'curve', opens: arcOpening(pts) }
}

// ---------------------------------------------------------------- relations

function contains(outer: Rect, inner: Rect, slack = 6): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  )
}

/** "upper-left", "centre", "lower-middle" — where a mark sits inside a shape. */
function regionOf(container: Rect, inner: Rect): string {
  const cx = (inner.x + inner.w / 2 - container.x) / (container.w || 1)
  const cy = (inner.y + inner.h / 2 - container.y) / (container.h || 1)
  const vertical = cy < 0.38 ? 'upper' : cy > 0.62 ? 'lower' : 'middle'
  const horizontal = cx < 0.38 ? 'left' : cx > 0.62 ? 'right' : 'centre'
  if (vertical === 'middle' && horizontal === 'centre') return 'centre'
  if (vertical === 'middle') return `${horizontal} of centre`
  if (horizontal === 'centre') return `${vertical}-middle`
  return `${vertical}-${horizontal}`
}

function relationsFor(strokes: StrokeShape[]): Map<string, StrokeRelation> {
  const relations = new Map<string, StrokeRelation>()
  // The largest closed stroke is the natural frame of reference — a face
  // outline, a box round a word, the body of a diagram.
  const containers = strokes
    .filter((s) => s.closed && s.sizeWord !== 'tiny')
    .sort((a, b) => b.bounds.w * b.bounds.h - a.bounds.w * a.bounds.h)

  for (const stroke of strokes) {
    const rel: StrokeRelation = {}
    const container = containers.find(
      (c) => c.name !== stroke.name && contains(c.bounds, stroke.bounds),
    )
    if (container) {
      rel.inside = container.name
      rel.region = regionOf(container.bounds, stroke.bounds)
    }
    relations.set(stroke.name, rel)
  }

  // Mirrored pairs: two similar marks either side of their container's axis.
  // This is what turns "two small marks" into "a pair of eyes" for the model.
  for (const a of strokes) {
    const relA = relations.get(a.name)!
    if (relA.mirrors || !relA.inside) continue
    const container = strokes.find((s) => s.name === relA.inside)
    if (!container) continue
    const axis = container.centre.x
    for (const b of strokes) {
      if (b.name === a.name) continue
      const relB = relations.get(b.name)!
      if (relB.mirrors || relB.inside !== relA.inside) continue
      if (b.class !== a.class) continue
      const sameHeight = Math.abs(a.centre.y - b.centre.y) < Math.max(12, container.bounds.h * 0.08)
      const mirrored =
        Math.abs((a.centre.x - axis) + (b.centre.x - axis)) <
        Math.max(12, container.bounds.w * 0.1)
      const oppositeSides = (a.centre.x - axis) * (b.centre.x - axis) < 0
      const similarSize = ratio(a.length, b.length) > 0.55
      if (sameHeight && mirrored && oppositeSides && similarSize) {
        relA.mirrors = b.name
        relB.mirrors = a.name
        break
      }
    }
  }

  // Anything not contained gets a coarse bearing to the biggest stroke.
  const anchor = containers[0] ?? strokes[0]
  for (const stroke of strokes) {
    const rel = relations.get(stroke.name)!
    if (rel.inside || !anchor || anchor.name === stroke.name) continue
    const dx = stroke.centre.x - anchor.centre.x
    const dy = stroke.centre.y - anchor.centre.y
    const bearing =
      Math.abs(dy) > Math.abs(dx)
        ? dy < 0 ? 'above' : 'below'
        : dx < 0 ? 'left of' : 'right of'
    rel.near = `${bearing} ${anchor.name}`
  }

  return relations
}

function ratio(a: number, b: number): number {
  const hi = Math.max(a, b)
  return hi === 0 ? 1 : Math.min(a, b) / hi
}

// ------------------------------------------------------------- handwriting

/**
 * Finds runs of small strokes sharing a baseline.
 *
 * Writing and drawing need different descriptions. Twenty strokes of
 * handwriting described one by one ("small curve opening left, right of ink3")
 * is noise that tells a model nothing and invites it to invent a reading. Far
 * better to say plainly: this is a line of handwriting, this wide, this many
 * words, and it has not been transcribed.
 */
function detectTextLines(strokes: StrokeShape[]): TextLine[] {
  if (strokes.length < 2) return []

  // Group strokes whose vertical extents overlap — one pass, top to bottom.
  const byTop = [...strokes].sort((a, b) => a.bounds.y - b.bounds.y)
  const groups: StrokeShape[][] = []
  for (const stroke of byTop) {
    const line = groups.find((g) => {
      const r = unionOf(g)
      const overlap =
        Math.min(r.y + r.h, stroke.bounds.y + stroke.bounds.h) -
        Math.max(r.y, stroke.bounds.y)
      // A perfectly flat stroke — the bar of an A, the top of a T — has no
      // height to overlap with, so requiring a positive overlap would throw it
      // out of the line it plainly belongs to. Sitting inside the line's range
      // is enough.
      const shorter = Math.min(r.h, stroke.bounds.h)
      return shorter === 0 ? overlap >= 0 : overlap > shorter * 0.45
    })
    if (line) line.push(stroke)
    else groups.push([stroke])
  }

  const lines: TextLine[] = []
  for (const group of groups) {
    const bounds = unionOf(group)
    group.sort((a, b) => a.bounds.x - b.bounds.x)
    const words = splitWords(group)
    const reading = recognizeLine(words)

    // Writing is mostly whatever reads as writing. Judging letters from their
    // proportions does not work — that wrongly assumed writing is small and
    // runs in long lines, when a teacher writes two letters half a metre tall.
    const chars = reading.reduce((n, w) => n + w.chars.length, 0)
    if (chars < 2) continue
    const mean = reading.reduce((sum, w) => sum + w.confidence * w.chars.length, 0) / chars
    if (mean < WRITING) continue

    // But a good match is not proof on its own: two boxes drawn side by side
    // read as "OO" perfectly well, and only knowing that OO is not a word tells
    // you otherwise. Two structural checks stand in for that knowledge.
    const marks = words.flatMap((word) => charGroups(word))
    const heights = marks.map((m) => unionOf(m).h)
    const tallest = Math.max(...heights)

    // Letters on a line are all about the same height. A sun is a big circle
    // with little rays sticking out of it, and the rays are nothing like the
    // circle — so it is a picture, not the word "O" between two dashes.
    const letterSized = marks.filter((_, i) => heights[i] >= tallest * 0.45)
    if (letterSized.length < 2) continue

    // No letter is drawn as one closed shape with corners. A box or a triangle
    // is a diagram. One among several is tolerated — a squarish D should not
    // condemn a whole word — but a line made of them is a picture.
    const boxy = letterSized.filter(
      (m) => m.length === 1 && GEOMETRIC.has((m[0] as StrokeShape).class) && (m[0] as StrokeShape).sizeWord !== 'tiny',
    )
    if (boxy.length * 2 >= letterSized.length) continue

    lines.push({ strokes: group, words, bounds, reading })
  }
  return lines
}

/**
 * How well strokes must match letters before they are called writing.
 *
 * Set below CONFIDENT deliberately: writing that is hard to read is still
 * writing, and saying "there are words here I cannot make out" is far more use
 * than describing them as arcs. Above this and a smiley face would start being
 * reported as the word "OO".
 */
const WRITING = 0.42

/** Closed shapes with corners: things people draw, never things they write. */
const GEOMETRIC = new Set<StrokeClass>(['rectangle', 'triangle', 'polygon'])

/**
 * Splits a line at gaps noticeably wider than the gaps between letters.
 *
 * The measure is the height of the writing itself, never the grid. A word space
 * is about half a letter tall whether the letters are a centimetre or a foot
 * high, so this works at any size — which a fixed number of grid cells does not.
 */
function splitWords(line: StrokeShape[]): StrokeShape[][] {
  const gaps: number[] = []
  // Measured from the rightmost ink so far, not from the previous stroke. A
  // stroke that sits inside a wider one — the stem of a T, the bar of an A —
  // would otherwise reset the edge halfway back and invent a gap that is not
  // there, splitting "EARTH" into "EART H".
  let rightmost = line[0].bounds.x + line[0].bounds.w
  for (let i = 1; i < line.length; i++) {
    gaps.push(Math.max(0, line[i].bounds.x - rightmost))
    rightmost = Math.max(rightmost, line[i].bounds.x + line[i].bounds.w)
  }
  const sorted = [...gaps].sort((a, b) => a - b)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const height = unionOf(line).h || 1
  const threshold = Math.max(height * 0.45, median * 2.2 + 1)

  const words: StrokeShape[][] = [[line[0]]]
  for (let i = 1; i < line.length; i++) {
    if (gaps[i - 1] > threshold) words.push([line[i]])
    else words[words.length - 1].push(line[i])
  }
  return words
}

function unionOf(strokes: { bounds: Rect }[]): Rect {
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

/**
 * Groups text lines that sit close above one another into one block.
 *
 * "Close" is judged against the size of the writing, not the grid: lines of big
 * letters are spaced further apart, and that does not make them separate blocks.
 */
function blockLines(lines: TextLine[], author: 'human' | 'ai'): TextBlock[] {
  const sorted = [...lines].sort((a, b) => a.bounds.y - b.bounds.y)
  const blocks: TextBlock[] = []
  for (const line of sorted) {
    const last = blocks[blocks.length - 1]
    const near =
      last &&
      line.bounds.y - (last.bounds.y + last.bounds.h) < Math.max(line.bounds.h, last.bounds.h) * 0.9 &&
      line.bounds.x < last.bounds.x + last.bounds.w &&
      line.bounds.x + line.bounds.w > last.bounds.x
    if (near) {
      last.lines.push(line)
      last.bounds = unionRect(last.bounds, line.bounds)
      last.strokeCount += line.strokes.length
    } else {
      blocks.push({
        id: `h${blocks.length + 1}`,
        bounds: line.bounds,
        lines: [line],
        strokeCount: line.strokes.length,
        author,
      })
    }
  }
  return blocks
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  }
}

// --------------------------------------------------------------- clustering

/**
 * Groups strokes that belong to the same picture: overlapping, nearly touching,
 * or one inside another. Union-find keeps it simple and order-independent.
 */
export interface InkAnalysis {
  drawings: Drawing[]
  handwriting: TextBlock[]
}

/** Splits pen strokes into writing and drawing, and describes each in its own terms. */
export function analyseBoardInk(shapes: Shape[], cellSize: number): InkAnalysis {
  const inks = shapes.filter(isInk).filter((s) => s.points.length > 0)
  if (inks.length === 0) return { drawings: [], handwriting: [] }

  const all = inks.map((s) => classifyStroke(s, cellSize))
  const authorOf = new Map(inks.map((s) => [s.name, s.author]))

  const textLines = detectTextLines(all)
  const written = new Set(textLines.flatMap((l) => l.strokes.map((s) => s.name)))
  const textAuthor = textLines.length
    ? authorOf.get(textLines[0].strokes[0].name) ?? 'human'
    : 'human'
  const handwriting = blockLines(textLines, textAuthor)

  // Whatever is not writing is a picture, and gets the geometric treatment.
  const pictorial = inks.filter((s) => !written.has(s.name))
  return { drawings: clusterDrawings(pictorial, cellSize), handwriting }
}

/** Backwards-compatible view: just the pictures. */
export function analyseInk(shapes: Shape[], cellSize: number): Drawing[] {
  return analyseBoardInk(shapes, cellSize).drawings
}

function clusterDrawings(inks: InkShape[], cellSize: number): Drawing[] {
  if (inks.length === 0) return []

  const strokes = inks.map((s) => classifyStroke(s, cellSize))
  const parent = strokes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  const gap = cellSize * 0.6
  for (let i = 0; i < strokes.length; i++) {
    for (let j = i + 1; j < strokes.length; j++) {
      const a = strokes[i].bounds
      const b = strokes[j].bounds
      const touching =
        a.x - gap < b.x + b.w &&
        a.x + a.w + gap > b.x &&
        a.y - gap < b.y + b.h &&
        a.y + a.h + gap > b.y
      if (touching) union(i, j)
    }
  }

  const groups = new Map<number, StrokeShape[]>()
  strokes.forEach((stroke, i) => {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(stroke)
    groups.set(root, list)
  })

  const drawings: Drawing[] = []
  let n = 1
  for (const list of groups.values()) {
    // Biggest first — it is the frame everything else is described against —
    // then the rest in reading order, so the description tracks the picture.
    const largest = list.reduce((best, s) =>
      s.bounds.w * s.bounds.h > best.bounds.w * best.bounds.h ? s : best,
    )
    const rest = list
      .filter((s) => s !== largest)
      .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
    list.length = 0
    list.push(largest, ...rest)
    const bounds = list.reduce(
      (acc, s) => ({
        x: Math.min(acc.x, s.bounds.x),
        y: Math.min(acc.y, s.bounds.y),
        w: 0,
        h: 0,
        maxX: Math.max((acc as never as { maxX: number }).maxX ?? -Infinity, s.bounds.x + s.bounds.w),
        maxY: Math.max((acc as never as { maxY: number }).maxY ?? -Infinity, s.bounds.y + s.bounds.h),
      }),
      { x: Infinity, y: Infinity, w: 0, h: 0, maxX: -Infinity, maxY: -Infinity } as Rect & {
        maxX: number
        maxY: number
      },
    ) as Rect & { maxX: number; maxY: number }
    const rect: Rect = {
      x: bounds.x,
      y: bounds.y,
      w: bounds.maxX - bounds.x,
      h: bounds.maxY - bounds.y,
    }
    const author = inks.find((s) => s.name === list[0].name)?.author ?? 'human'
    drawings.push({
      id: `d${n++}`,
      bounds: rect,
      strokes: list,
      relations: relationsFor(list),
      author,
    })
  }
  return drawings
}

// ------------------------------------------------------------- description

function describeClass(stroke: StrokeShape): string {
  switch (stroke.class) {
    case 'dot':
      return 'dot / small mark'
    case 'line':
      return `${stroke.direction ?? ''} straight line`.trim()
    case 'circle':
      return 'closed circle'
    case 'ellipse':
      return 'closed ellipse'
    case 'rectangle':
      return 'closed rectangle'
    case 'triangle':
      return 'closed triangle'
    case 'polygon':
      return `closed polygon (${stroke.corners} corners)`
    case 'loop':
      return 'closed irregular loop'
    case 'arc':
      return `arc opening ${stroke.opens}`
    case 'zigzag':
      return 'zigzag / scribble'
    default:
      return `curve opening ${stroke.opens ?? '?'}`
  }
}

function cellRef(x: number, y: number, cellSize: number): string {
  const p = worldToCell(x, y, cellSize)
  return formatCell({ col: Math.max(0, p.col), row: Math.max(0, p.row) })
}

/** One text block per drawing, ready to drop into the board digest. */
export function describeDrawing(drawing: Drawing, cellSize: number): string[] {
  const b = drawing.bounds
  const from = cellRef(b.x, b.y, cellSize)
  const to = cellRef(b.x + b.w, b.y + b.h, cellSize)
  const centre = cellRef(b.x + b.w / 2, b.y + b.h / 2, cellSize)
  const who = drawing.author === 'human' ? 'teacher' : 'ai'
  const lines = [
    `DRAWING ${drawing.id} (${who} pen, ${drawing.strokes.length} stroke${
      drawing.strokes.length === 1 ? '' : 's'
    }) spans ${from}..${to}, centre ${centre}, ${round(b.w / cellSize)}x${round(
      b.h / cellSize,
    )} cells`,
  ]

  for (const stroke of drawing.strokes) {
    const rel = drawing.relations.get(stroke.name)
    const parts = [`  ${pad(stroke.name, 8)} ${stroke.sizeWord} ${describeClass(stroke)}`]
    if (rel?.inside) parts.push(`inside ${rel.inside}, ${rel.region}`)
    else if (rel?.near) parts.push(rel.near)
    else {
      parts.push(
        `at ${cellRef(stroke.bounds.x, stroke.bounds.y, cellSize)}..${cellRef(
          stroke.bounds.x + stroke.bounds.w,
          stroke.bounds.y + stroke.bounds.h,
          cellSize,
        )}`,
      )
    }
    if (rel?.mirrors) parts.push(`mirrors ${rel.mirrors}`)
    lines.push(parts.join('  '))
  }
  return lines
}

/**
 * Describes handwriting, and says what it says.
 *
 * The reading is stated plainly when it is solid and hedged when it is not.
 * Hedging matters more than it looks: a confident wrong reading of a teacher's
 * board is worse than an admitted uncertain one, because the model will go on
 * to build a lesson on top of it. Letters the matcher could not separate are
 * printed as `[E|F]` so the model can pick using the word, which is a thing it
 * is far better at than geometry.
 */
export function describeHandwriting(block: TextBlock, cellSize: number): string[] {
  const b = block.bounds
  const from = cellRef(b.x, b.y, cellSize)
  const to = cellRef(b.x + b.w, b.y + b.h, cellSize)
  const who = block.author === 'human' ? 'teacher' : 'ai'
  const words = block.lines.reduce((n, l) => n + l.words.length, 0)

  const lines = [
    `HANDWRITING ${block.id} (${who} pen) spans ${from}..${to}, ` +
      `${block.lines.length} line${block.lines.length === 1 ? '' : 's'}, ` +
      `${words} word${words === 1 ? '' : 's'}, ${block.strokeCount} strokes`,
  ]

  for (const line of block.lines) {
    if (line.reading.length === 0) continue
    const text = line.reading.map(spellWord).join(' ')
    const weakest = Math.min(...line.reading.map((w) => w.confidence))
    const label = weakest >= CONFIDENT ? 'reads' : 'reads (uncertain)'
    lines.push(`  ${label}: "${text}"`)
  }

  if (uncertainWords(block).length > 0) {
    lines.push(
      '  Letters in [brackets] are close calls — pick whichever spelling makes a real word.',
    )
  }
  return lines
}

/** Words the matcher is not sure of, worst first. Used to decide what to draw out. */
export function uncertainWords(block: TextBlock): RecognizedWord[] {
  return block.lines
    .flatMap((l) => l.reading)
    .filter((w) => w.confidence < CONFIDENT)
    .sort((a, b) => a.confidence - b.confidence)
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
