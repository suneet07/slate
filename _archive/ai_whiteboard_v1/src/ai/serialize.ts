/**
 * Board -> text digest for the model.
 *
 * A JSON dump of the scene graph is the obvious approach and the wrong one:
 * it burns tokens on punctuation and buries the layout under nesting. This
 * emits one short line per shape in the same grid language the commands use,
 * so a small model can read the board and write commands without translating
 * between two coordinate systems.
 *
 *   title   text   A1  6x1  black  "Photosynthesis"
 *   box1    rect   B3  3x2  blue   "Light"
 *   arrow1  arrow  box1 -> box2  "feeds"
 *   ink1    ink    C7  3x2  (handwriting)
 */

import { shapeBounds } from '../engine/geometry'
import { formatCell, worldToCell } from '../engine/grid'
import type { BoardStore } from '../engine/store'
import { isConnector, isInk, type InkShape, type Shape } from '../engine/types'
import { analyseBoardInk, describeDrawing, describeHandwriting, uncertainWords } from './inkAnalysis'

export interface DigestOptions {
  /** Include the free-space summary. Cheap and helps placement a lot. */
  includeFree?: boolean
  /** Cap on how many shapes to list before truncating. */
  limit?: number
  /** Trim long labels so one runaway text box can't dominate the context. */
  maxTextLength?: number
}

export function digestBoard(store: BoardStore, opts: DigestOptions = {}): string {
  const limit = opts.limit ?? 200
  const maxText = opts.maxTextLength ?? 80
  const shapes = store.all()

  const lines: string[] = []
  lines.push(
    `BOARD grid ${store.cols}x${store.rows} cells (columns A..${colLetters(store.cols - 1)}, rows 1..${store.rows}); 1 cell = ${store.cellSize} units`,
  )

  if (shapes.length === 0) {
    lines.push('EMPTY — no shapes yet.')
    return lines.join('\n')
  }

  // Pen strokes are described separately and geometrically — a bounding box
  // says nothing about what was actually drawn.
  const placed = shapes.filter((s) => !isInk(s))
  if (placed.length > 0) {
    lines.push(`SHAPES (${placed.length}):`)
    for (const shape of placed.slice(0, limit)) {
      lines.push(describeShape(store, shape, maxText))
    }
    if (placed.length > limit) {
      lines.push(`... and ${placed.length - limit} more shapes not listed`)
    }
  }

  const { drawings, handwriting } = analyseBoardInk(shapes, store.cellSize)

  // Register every group id we are about to print, so the model can use them
  // as anchors and targets. An id in the digest that resolves to nothing is a
  // trap: the model will reach for it, correctly, and the command will fail.
  store.anchors.clear()
  for (const block of handwriting) {
    store.anchors.set(block.id, {
      bounds: block.bounds,
      members: block.lines.flatMap((l) => l.strokes.map((s) => s.name)),
    })
  }
  for (const drawing of drawings) {
    store.anchors.set(drawing.id, {
      bounds: drawing.bounds,
      members: drawing.strokes.map((s) => s.name),
    })
  }

  for (const block of handwriting.slice(0, 8)) {
    lines.push(...describeHandwriting(block, store.cellSize))
    // The reading above is usually enough. Drawing a word out costs a few
    // hundred characters, so it is spent only where the matcher was unsure —
    // there the model's own eye for shapes is worth more than the tokens.
    for (const word of uncertainWords(block).slice(0, 3)) {
      lines.push(`  the word read as "${word.text}", drawn out:`)
      lines.push(...renderAsciiGrid(word.strokeNames, word.bounds, store))
    }
  }
  for (const drawing of drawings.slice(0, 12)) {
    lines.push(...describeDrawing(drawing, store.cellSize))
    // A wide run of separate marks that missed line detection is probably a
    // word written large. Everything else is a picture, and the geometric
    // description above already says more about it than a raster would.
    const looksWritten = drawing.strokes.length >= 3 && drawing.bounds.w > drawing.bounds.h * 2
    if (looksWritten && drawing.bounds.w < store.cellSize * 12) {
      lines.push('  not recognised as writing; drawn out in case it is a word:')
      lines.push(...renderAsciiGrid(drawing.strokes.map((s) => s.name), drawing.bounds, store))
    }
  }
  if (drawings.length > 12) {
    lines.push(`... and ${drawings.length - 12} more pen drawings not listed`)
  }

  if (store.selection.size > 0) {
    lines.push(`SELECTED: ${[...store.selection].join(', ')}`)
  }
  if (opts.includeFree !== false) {
    const free = freeRowSummary(store)
    if (free) lines.push(free)
  }
  return lines.join('\n')
}

function describeShape(store: BoardStore, shape: Shape, maxText: number): string {
  const parts: string[] = [pad(shape.name, 10)]

  if (isConnector(shape)) {
    const from = shape.from.kind === 'shape' ? shape.from.name : cellOf(store, shape.from.x, shape.from.y)
    const to = shape.to.kind === 'shape' ? shape.to.name : cellOf(store, shape.to.x, shape.to.y)
    parts.push(pad(shape.kind, 7), `${from} -> ${to}`, shape.color)
    if (shape.text) parts.push(quote(shape.text, maxText))
    if (shape.author === 'human') parts.push('[drawn by teacher]')
    return parts.join(' ')
  }

  const r = shapeBounds(shape, store.map())
  const cell = cellOf(store, r.x, r.y)
  const size = `${round(r.w / store.cellSize)}x${round(r.h / store.cellSize)}`

  parts.push(pad(shape.kind, 7), pad(cell, 4), pad(size, 5), pad(shape.color, 6))
  if (shape.fill !== 'none') parts.push(shape.fill)
  if (shape.stroke !== 'solid') parts.push(shape.stroke)
  if (shape.rotation) parts.push(`rot${Math.round(shape.rotation)}`)
  if (shape.text) parts.push(quote(shape.text, maxText))
  if (shape.groupId) parts.push(`group:${shape.groupId}`)
  if (shape.author === 'human') parts.push('[drawn by teacher]')
  return parts.join(' ')
}

/** Which whole rows are still empty — the model's cue for where to add things. */
function freeRowSummary(store: BoardStore): string | null {
  const occupied = new Set<number>()
  for (const shape of store.all()) {
    const r = shapeBounds(shape, store.map())
    const top = Math.floor(r.y / store.cellSize)
    const bottom = Math.floor((r.y + r.h) / store.cellSize)
    for (let row = top; row <= bottom; row++) occupied.add(row)
  }
  const free: number[] = []
  for (let row = 0; row < store.rows; row++) {
    if (!occupied.has(row)) free.push(row + 1)
  }
  if (free.length === 0) return 'FREE ROWS: none — board is full, reuse or clear space'
  return `FREE ROWS: ${compressRanges(free)}`
}

function compressRanges(nums: number[]): string {
  const out: string[] = []
  let start = nums[0]
  let prev = nums[0]
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i]
    if (n === prev + 1) {
      prev = n
      continue
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = n
    prev = n
  }
  return out.join(', ')
}

function cellOf(store: BoardStore, x: number, y: number): string {
  const p = worldToCell(x, y, store.cellSize)
  return formatCell({ col: Math.max(0, p.col), row: Math.max(0, p.row) })
}

function colLetters(col: number): string {
  let n = Math.max(0, col)
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

function quote(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const clipped = flat.length > max ? `${flat.slice(0, max)}...` : flat
  return `"${clipped}"`
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Draws strokes as a character grid.
 *
 * The grid is shaped to the content instead of being a fixed rectangle. That
 * was the bug in the first version: forcing a whole line of writing into 64
 * columns left about four columns per letter and squashed the aspect ratio, so
 * the picture the model got was unreadable no matter how good the model was.
 *
 * Terminal cells are roughly twice as tall as they are wide, so the column
 * count is doubled against the row count to keep circles round.
 */
function renderAsciiGrid(strokeNames: string[], bounds: {x: number, y: number, w: number, h: number}, store: BoardStore): string[] {
  const bx = bounds.x
  const by = bounds.y
  const bw = bounds.w || 1
  const bh = bounds.h || 1

  const MAX_COLS = 100
  let ROWS = 12
  let COLS = Math.round(ROWS * (bw / bh) * 2)
  if (COLS > MAX_COLS) {
    ROWS = Math.max(4, Math.round((ROWS * MAX_COLS) / COLS))
    COLS = MAX_COLS
  }
  COLS = Math.max(6, COLS)

  const grid: string[][] = Array(ROWS).fill(0).map(() => Array(COLS).fill('.'))
  for (const name of strokeNames) {
    const shape = store.get(name) as InkShape | undefined
    if (!shape || shape.kind !== 'ink' || !shape.points) continue
    const pts = shape.points

    for (let i = 1; i < pts.length; i++) {
      const p1 = pts[i - 1]
      const p2 = pts[i]

      // Map to grid coordinates
      let x1 = Math.round(((p1.x - bx) / bw) * (COLS - 1))
      let y1 = Math.round(((p1.y - by) / bh) * (ROWS - 1))
      const x2 = Math.round(((p2.x - bx) / bw) * (COLS - 1))
      const y2 = Math.round(((p2.y - by) / bh) * (ROWS - 1))

      // Bresenham's Line Algorithm
      const dx = Math.abs(x2 - x1)
      const dy = Math.abs(y2 - y1)
      const sx = x1 < x2 ? 1 : -1
      const sy = y1 < y2 ? 1 : -1
      let err = dx - dy

      while (true) {
        if (x1 >= 0 && x1 < COLS && y1 >= 0 && y1 < ROWS) {
          grid[y1][x1] = '#'
        }
        if (x1 === x2 && y1 === y2) break
        const e2 = 2 * err
        if (e2 > -dy) {
          err -= dy
          x1 += sx
        }
        if (e2 < dx) {
          err += dx
          y1 += sy
        }
      }
    }
  }

  return grid.map((row) => '  ' + row.join(''))
}
