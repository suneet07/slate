import {
  type Board,
  type Camera,
  type Shape,
  type ShapeKind,
  isConnector,
} from './types'
import { rectsOverlap, shapeBounds, unionRects, type Rect } from './geometry'
export type { Rect }

let idCounter = 0
const nextId = () => `s${(++idCounter).toString(36)}${Date.now().toString(36).slice(-3)}`

/** Short, pronounceable name stems per shape kind — what the AI ends up addressing. */
const NAME_STEM: Record<ShapeKind, string> = {
  rect: 'box',
  ellipse: 'circle',
  diamond: 'diamond',
  triangle: 'tri',
  star: 'star',
  note: 'note',
  text: 'text',
  line: 'line',
  arrow: 'arrow',
  ink: 'ink',
  image: 'img',
}

export interface StoreEvent {
  type: 'change'
  reason: string
}

type Listener = () => void

export class BoardStore {
  private shapes = new Map<string, Shape>() // keyed by name
  private undoStack: Shape[][] = []
  private redoStack: Shape[][] = []
  private listeners = new Set<Listener>()
  private zCounter = 0

  cols: number
  rows: number
  cellSize: number
  camera: Camera = { x: 0, y: 0, zoom: 1 }
  selection = new Set<string>()

  /**
   * Group ids that appear in the board digest (`d1` a drawing, `h1` a block of
   * handwriting) mapped to what they stand for. The model is shown these ids,
   * so it must be able to use them as anchors and targets — anything named in
   * the digest has to be addressable.
   */
  anchors = new Map<string, { bounds: Rect; members: string[] }>()

  constructor(opts: { cols?: number; rows?: number; cellSize?: number } = {}) {
    this.cols = opts.cols ?? 24
    this.rows = opts.rows ?? 14
    this.cellSize = opts.cellSize ?? 100
  }

  // ---------------------------------------------------------------- reading

  get(name: string): Shape | undefined {
    return this.shapes.get(name)
  }

  has(name: string): boolean {
    return this.shapes.has(name)
  }

  /** Render/serialize order: bottom to top. */
  all(): Shape[] {
    return [...this.shapes.values()].sort((a, b) => a.z - b.z)
  }

  map(): Map<string, Shape> {
    return this.shapes
  }

  names(): string[] {
    return [...this.shapes.keys()]
  }

  bounds(name: string): Rect | null {
    const s = this.shapes.get(name)
    if (s) return shapeBounds(s, this.shapes)
    const anchor = this.anchors.get(name)
    if (!anchor) return null
    // Recompute from the members: they may have moved since the digest.
    const rects = anchor.members
      .map((m) => this.shapes.get(m))
      .filter(Boolean)
      .map((m) => shapeBounds(m as Shape, this.shapes))
    return rects.length > 0 ? unionRects(rects) : anchor.bounds
  }

  /** Stroke names behind a digest group id, or null if it is not one. */
  anchorMembers(name: string): string[] | null {
    const anchor = this.anchors.get(name)
    if (!anchor) return null
    return anchor.members.filter((m) => this.shapes.has(m))
  }

  contentBounds(): Rect {
    const rects = this.all().map((s) => shapeBounds(s, this.shapes))
    return unionRects(rects)
  }

  toBoard(): Board {
    return {
      cols: this.cols,
      rows: this.rows,
      cellSize: this.cellSize,
      shapes: this.all(),
      camera: { ...this.camera },
    }
  }

  // ---------------------------------------------------------------- writing

  /**
   * Allocates a unique name. `desired` is honoured when free; otherwise a
   * numeric suffix is appended so the AI's intent survives collisions.
   */
  allocName(kind: ShapeKind, desired?: string): string {
    const clean = desired?.trim().replace(/\s+/g, '_')
    if (clean && !this.shapes.has(clean)) return clean
    const stem = clean && clean.length > 0 ? clean.replace(/\d+$/, '') : NAME_STEM[kind]
    let i = 1
    while (this.shapes.has(`${stem}${i}`)) i++
    return `${stem}${i}`
  }

  nextZ(): number {
    return ++this.zCounter
  }

  insert(shape: Shape): Shape {
    this.shapes.set(shape.name, shape)
    this.zCounter = Math.max(this.zCounter, shape.z)
    return shape
  }

  update(name: string, patch: Partial<Shape>): Shape | undefined {
    const s = this.shapes.get(name)
    if (!s) return undefined
    const next = { ...s, ...patch, name: s.name, id: s.id } as Shape
    this.shapes.set(name, next)
    return next
  }

  remove(name: string): boolean {
    const existed = this.shapes.delete(name)
    if (existed) {
      // Drop connectors that pointed at the deleted shape — dangling arrows
      // confuse both the renderer and the model reading the board.
      for (const s of [...this.shapes.values()]) {
        if (!isConnector(s)) continue
        const touches =
          (s.from.kind === 'shape' && s.from.name === name) ||
          (s.to.kind === 'shape' && s.to.name === name)
        if (touches) this.shapes.delete(s.name)
      }
      this.selection.delete(name)
    }
    return existed
  }

  rename(from: string, to: string): boolean {
    const s = this.shapes.get(from)
    if (!s || this.shapes.has(to)) return false
    this.shapes.delete(from)
    this.shapes.set(to, { ...s, name: to })
    for (const other of [...this.shapes.values()]) {
      if (!isConnector(other)) continue
      const patch = { ...other }
      if (patch.from.kind === 'shape' && patch.from.name === from) {
        patch.from = { kind: 'shape', name: to }
      }
      if (patch.to.kind === 'shape' && patch.to.name === from) {
        patch.to = { kind: 'shape', name: to }
      }
      this.shapes.set(other.name, patch)
    }
    if (this.selection.delete(from)) this.selection.add(to)
    return true
  }

  clear(): void {
    this.shapes.clear()
    this.selection.clear()
  }

  // ---------------------------------------------------------- auto-placement

  /**
   * Finds a free spot for a new shape so the model can omit coordinates
   * entirely and still get a readable board. Scans the grid row by row.
   */
  // pad = 0 by default: shapes sized in whole cells sit flush on the grid, and
  // treating adjacent rows as a collision pushes content into odd corners.
  findFreeSpot(w: number, h: number, pad = 0): { x: number; y: number } {
    const existing = this.all().map((s) => shapeBounds(s, this.shapes))
    const step = this.cellSize / 2
    const maxX = this.cols * this.cellSize
    const maxY = this.rows * this.cellSize
    for (let y = 0; y + h <= maxY; y += step) {
      for (let x = 0; x + w <= maxX; x += step) {
        const candidate = { x, y, w, h }
        if (!existing.some((r) => rectsOverlap(candidate, r, pad))) return { x, y }
      }
    }
    // Board is full — stack below everything rather than silently overlapping.
    const content = this.contentBounds()
    return { x: 0, y: content.y + content.h + this.cellSize / 2 }
  }

  // ------------------------------------------------------------------ history

  private snapshot(): Shape[] {
    return this.all().map((s) => structuredClone(s))
  }

  /** Runs `fn` as one undoable transaction and notifies listeners once. */
  transact<T>(reason: string, fn: () => T): T {
    const before = this.snapshot()
    let result: T
    try {
      result = fn()
    } catch (err) {
      this.restore(before)
      throw err
    }
    this.undoStack.push(before)
    if (this.undoStack.length > 100) this.undoStack.shift()
    this.redoStack.length = 0
    this.emit(reason)
    return result
  }

  private restore(shapes: Shape[]): void {
    this.shapes.clear()
    for (const s of shapes) {
      this.shapes.set(s.name, s)
      this.zCounter = Math.max(this.zCounter, s.z)
    }
    for (const name of [...this.selection]) {
      if (!this.shapes.has(name)) this.selection.delete(name)
    }
  }

  undo(): boolean {
    const prev = this.undoStack.pop()
    if (!prev) return false
    this.redoStack.push(this.snapshot())
    this.restore(prev)
    this.emit('undo')
    return true
  }

  redo(): boolean {
    const next = this.redoStack.pop()
    if (!next) return false
    this.undoStack.push(this.snapshot())
    this.restore(next)
    this.emit('redo')
    return true
  }

  // ------------------------------------------------------------ subscriptions

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit(_reason = 'change'): void {
    for (const fn of this.listeners) fn()
  }

  // ------------------------------------------------------------- persistence

  serialize(): string {
    return JSON.stringify({
      cols: this.cols,
      rows: this.rows,
      cellSize: this.cellSize,
      camera: this.camera,
      shapes: this.all(),
    })
  }

  load(json: string): void {
    const data = JSON.parse(json) as Board
    this.clear()
    this.cols = data.cols ?? this.cols
    this.rows = data.rows ?? this.rows
    this.cellSize = data.cellSize ?? this.cellSize
    this.camera = data.camera ?? this.camera
    for (const s of data.shapes ?? []) this.insert(s)
    this.emit('load')
  }
}

export { nextId }
