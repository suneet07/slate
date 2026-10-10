/**
 * The AI command layer.
 *
 * Everything an AI can do to the board goes through a flat list of small,
 * verb-first commands. Three rules drive the design:
 *
 *   1. Address by name, never by uuid or index.
 *   2. Positions are grid cells ("C3") or relative phrases ("right of box1"),
 *      never raw pixel math.
 *   3. Layout is a verb (align / stack / grid / distribute), so the model
 *      never has to compute coordinates to make something look tidy.
 *
 * Every command is validated and returns a per-command result, so a weak model
 * that gets something wrong receives a precise repair message instead of a
 * silent failure.
 */

import { cellToWorld, parseCell, parseSize } from '../engine/grid'
import { rectCenter, shapeBounds, unionRects, type Rect } from '../engine/geometry'
import { COLOR_NAMES } from '../engine/palette'
import { nextId, type BoardStore } from '../engine/store'
import {
  type ColorName,
  type ConnectorShape,
  type Endpoint,
  type FillStyle,
  type GeoShape,
  type InkShape,
  type Shape,
  type ShapeKind,
  type StrokeStyle,
  type TextAlign,
  type TextSize,
  isConnector,
} from '../engine/types'

// ------------------------------------------------------------------- schema

export type Side = 'right' | 'left' | 'above' | 'below'

/** A place on the board. Accepts several shapes of input on purpose. */
export type At =
  | string // "C3" cell ref, or a phrase like "right of box1"
  | { cell: string }
  | { x: number; y: number }
  | { of: string; side: Side; gap?: number }
  /** Centred at fractions of another shape's box: {of:"face", u:0.3, v:0.35}. */
  | { of: string; u: number; v: number }

/** Who a command applies to. */
export type Target = string | string[]

export interface AddCommand {
  op: 'add'
  shape: ShapeKind | 'circle' | 'box' | 'sticky' | 'label'
  name?: string
  at?: At
  size?: string
  w?: number
  h?: number
  text?: string
  color?: ColorName
  fill?: FillStyle
  stroke?: StrokeStyle
  strokeWidth?: number
  textSize?: TextSize
  textAlign?: TextAlign
  rotation?: number
  opacity?: number
  src?: string
}

export interface SetCommand {
  op: 'set'
  target: Target
  text?: string
  color?: ColorName
  fill?: FillStyle
  stroke?: StrokeStyle
  strokeWidth?: number
  textSize?: TextSize
  textAlign?: TextAlign
  rotation?: number
  opacity?: number
  size?: string
  w?: number
  h?: number
  at?: At
}

export type Command =
  | AddCommand
  | SetCommand
  | { op: 'delete'; target: Target }
  | { op: 'move'; target: Target; at?: At; dx?: number; dy?: number }
  | { op: 'resize'; target: Target; size?: string; w?: number; h?: number }
  | { op: 'rename'; target: string; to: string }
  | {
      op: 'connect'
      from: string
      to: string
      name?: string
      text?: string
      color?: ColorName
      style?: StrokeStyle
      bend?: number
      arrowheads?: 'end' | 'both' | 'none'
    }
  | {
      op: 'align'
      target: Target
      edge: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'
    }
  | { op: 'distribute'; target: Target; axis: 'x' | 'y'; gap?: number }
  | { op: 'stack'; target: Target; dir?: 'down' | 'right'; gap?: number; at?: At }
  | { op: 'grid'; target: Target; cols?: number; gap?: number; at?: At }
  | { op: 'order'; target: Target; to: 'front' | 'back' }
  | { op: 'group'; target: Target; name?: string }
  | { op: 'ungroup'; target: Target }
  | { op: 'clear'; target?: Target }
  | { op: 'focus'; target?: Target }
  | { op: 'select'; target?: Target }
  | {
      op: 'draw'
      points: DrawPoint[]
      name?: string
      /** Interpret numeric points as fractions of this shape's box. */
      relativeTo?: string
      smooth?: boolean
      closed?: boolean
      color?: ColorName
      strokeWidth?: number
    }
  | { op: 'say'; text: string }

/**
 * A point in a freehand path. Cell refs for board-absolute marks; number pairs
 * for fractions of `relativeTo`'s box (0..1 inside it, outside that beyond it);
 * explicit `{x,y}` when world units are genuinely wanted.
 */
export type DrawPoint = string | [number, number] | { x: number; y: number }

export interface CommandResult {
  index: number
  op: string
  ok: boolean
  /** Names created or touched — lets the model chain follow-up commands. */
  names?: string[]
  error?: string
  /** Non-fatal corrections, e.g. an off-palette colour that was substituted. */
  warnings?: string[]
}

export interface ExecReport {
  ok: boolean
  results: CommandResult[]
  created: string[]
  errors: string[]
  warnings: string[]
  /** Anything the model said back via `say` — answers to questions. */
  messages: string[]
}

// ---------------------------------------------------------------- defaults

const KIND_ALIASES: Record<string, ShapeKind> = {
  circle: 'ellipse',
  oval: 'ellipse',
  box: 'rect',
  rectangle: 'rect',
  square: 'rect',
  sticky: 'note',
  postit: 'note',
  label: 'text',
  ink: 'ink',
}

const DEFAULT_SIZE: Record<ShapeKind, { cols: number; rows: number }> = {
  rect: { cols: 3, rows: 2 },
  ellipse: { cols: 2, rows: 2 },
  diamond: { cols: 2, rows: 2 },
  triangle: { cols: 2, rows: 2 },
  star: { cols: 2, rows: 2 },
  note: { cols: 2, rows: 2 },
  text: { cols: 4, rows: 1 },
  image: { cols: 3, rows: 2 },
  line: { cols: 2, rows: 0 },
  arrow: { cols: 2, rows: 0 },
  ink: { cols: 1, rows: 1 },
}

const DEFAULT_COLOR: Partial<Record<ShapeKind, ColorName>> = {
  note: 'yellow',
  text: 'black',
}

const DEFAULT_FILL: Partial<Record<ShapeKind, FillStyle>> = {
  note: 'tint',
  rect: 'none',
  text: 'none',
}

function normalizeKind(raw: string): ShapeKind | null {
  const k = String(raw ?? '').trim().toLowerCase()
  if (KIND_ALIASES[k]) return KIND_ALIASES[k]
  const valid: ShapeKind[] = [
    'rect', 'ellipse', 'diamond', 'triangle', 'star',
    'note', 'text', 'line', 'arrow', 'ink', 'image',
  ]
  return valid.includes(k as ShapeKind) ? (k as ShapeKind) : null
}

// -------------------------------------------------------------- resolution

/** Expands a target selector into concrete shape names. */
export function resolveTargets(store: BoardStore, target: Target | undefined): string[] {
  if (target === undefined || target === null) return [...store.selection]

  const raw: string[] = Array.isArray(target)
    ? target
    : String(target).split(',').map((s) => s.trim())

  const out: string[] = []
  for (const token of raw) {
    if (!token) continue
    const lower = token.toLowerCase()
    if (lower === 'all' || lower === '*') {
      out.push(...store.names())
    } else if (lower === 'selected' || lower === 'selection') {
      out.push(...store.selection)
    } else if (lower.startsWith('kind:') || lower.startsWith('type:')) {
      const kind = normalizeKind(lower.split(':')[1])
      out.push(...store.all().filter((s) => s.kind === kind).map((s) => s.name))
    } else if (lower.startsWith('color:')) {
      const c = lower.split(':')[1]
      out.push(...store.all().filter((s) => s.color === c).map((s) => s.name))
    } else if (lower.startsWith('author:')) {
      const a = lower.split(':')[1]
      out.push(...store.all().filter((s) => s.author === a).map((s) => s.name))
    } else if (lower.startsWith('group:')) {
      const g = token.split(':')[1]
      out.push(...store.all().filter((s) => s.groupId === g).map((s) => s.name))
    } else {
      // "d1" / "h1" from the digest stand for all the strokes they contain.
      const members = store.anchorMembers(token)
      if (members) out.push(...members)
      else out.push(token)
    }
  }
  return [...new Set(out)]
}

/** "right of box1" / "below title" — the phrasing a model reaches for first. */
const RELATIVE_RE = /^(right|left|above|below|under|over|beside)\s+(?:of\s+|to\s+)?(\S+)$/i

function normalizeSide(word: string): Side {
  const w = word.toLowerCase()
  if (w === 'under') return 'below'
  if (w === 'over') return 'above'
  if (w === 'beside') return 'right'
  return w as Side
}

export interface Resolved {
  x: number
  y: number
}

/**
 * Turns any accepted `at` form into world coordinates.
 * `size` is the size of the thing being placed (needed for relative placement).
 */
function resolveAt(
  store: BoardStore,
  at: At | undefined,
  size: { w: number; h: number },
): { pos: Resolved | null; error?: string } {
  if (at === undefined || at === null) return { pos: null }

  if (typeof at === 'string') {
    const s = at.trim()
    const cell = parseCell(s)
    if (cell) return { pos: cellToWorld(cell, store.cellSize) }
    const rel = RELATIVE_RE.exec(s)
    if (rel) {
      return resolveRelative(store, rel[2], normalizeSide(rel[1]), undefined, size)
    }
    return { pos: null, error: `at "${at}" is not a cell ref (like "C3") or a phrase like "right of box1"` }
  }

  if ('cell' in at && typeof at.cell === 'string') {
    const cell = parseCell(at.cell)
    if (!cell) return { pos: null, error: `at.cell "${at.cell}" is not a cell ref like "C3"` }
    return { pos: cellToWorld(cell, store.cellSize) }
  }

  if ('of' in at && typeof at.of === 'string') {
    // {of, u, v} centres the shape at a fraction of the anchor's box — the way
    // to place eyes on a face without knowing where the face ended up.
    if ('u' in at || 'v' in at) {
      const frac = at as { of: string; u?: number; v?: number }
      const frame = store.bounds(frac.of)
      if (!frame) return { pos: null, error: `no shape named "${frac.of}"` }
      const u = typeof frac.u === 'number' ? frac.u : 0.5
      const v = typeof frac.v === 'number' ? frac.v : 0.5
      return {
        pos: {
          x: frame.x + u * frame.w - size.w / 2,
          y: frame.y + v * frame.h - size.h / 2,
        },
      }
    }
    const side = at as { of: string; side?: Side; gap?: number }
    return resolveRelative(store, side.of, normalizeSide(side.side ?? 'right'), side.gap, size)
  }

  if ('x' in at && 'y' in at && typeof at.x === 'number' && typeof at.y === 'number') {
    return { pos: { x: at.x, y: at.y } }
  }

  return {
    pos: null,
    error: 'at must be "C3", {cell}, {x,y}, {of, side}, or {of, u, v}',
  }
}

function resolveRelative(
  store: BoardStore,
  anchorName: string,
  side: Side,
  gap: number | undefined,
  size: { w: number; h: number },
): { pos: Resolved | null; error?: string } {
  // store.bounds also resolves digest group ids like "d1" and "h1".
  const r = store.bounds(anchorName)
  if (!r) return { pos: null, error: `no shape named "${anchorName}"` }
  const g = gap ?? store.cellSize / 2
  switch (side) {
    case 'right':
      return { pos: { x: r.x + r.w + g, y: r.y } }
    case 'left':
      return { pos: { x: r.x - size.w - g, y: r.y } }
    case 'below':
      return { pos: { x: r.x, y: r.y + r.h + g } }
    case 'above':
      return { pos: { x: r.x, y: r.y - size.h - g } }
  }
}

function resolveSize(
  store: BoardStore,
  cmd: { size?: string; w?: number; h?: number },
  kind: ShapeKind,
): { w: number; h: number; error?: string } {
  const fallback = DEFAULT_SIZE[kind]
  let w = fallback.cols * store.cellSize
  let h = fallback.rows * store.cellSize
  if (cmd.size) {
    const parsed = parseSize(cmd.size)
    if (!parsed) {
      return { w, h, error: `size "${cmd.size}" must look like "4x2" (cells wide x tall)` }
    }
    w = parsed.cols * store.cellSize
    h = parsed.rows * store.cellSize
  }
  if (typeof cmd.w === 'number') w = cmd.w
  if (typeof cmd.h === 'number') h = cmd.h
  return { w, h }
}

// -------------------------------------------------------------- validation

/**
 * Off-palette words models reach for. Mapping them beats rejecting the whole
 * command: a box in roughly the right colour is far more useful to a teacher
 * mid-lesson than no box at all.
 */
const COLOR_SYNONYMS: Record<string, ColorName> = {
  brown: 'orange',
  tan: 'orange',
  gold: 'yellow',
  amber: 'yellow',
  purple: 'violet',
  indigo: 'violet',
  magenta: 'pink',
  gray: 'grey',
  silver: 'grey',
  navy: 'blue',
  cyan: 'blue',
  teal: 'green',
  turquoise: 'green',
  skyblue: 'blue',
  lightblue: 'blue',
  darkblue: 'blue',
  lime: 'green',
  olive: 'green',
  maroon: 'red',
  crimson: 'red',
  transparent: 'white',
}

const FILL_SYNONYMS: Record<string, FillStyle> = {
  filled: 'solid',
  full: 'solid',
  light: 'tint',
  pale: 'tint',
  hollow: 'none',
  empty: 'none',
  outline: 'none',
}

const SIZE_SYNONYMS: Record<string, TextSize> = {
  small: 's',
  medium: 'm',
  large: 'l',
  big: 'l',
  huge: 'xl',
  title: 'xl',
}

/**
 * Reads a styling enum. Unknown values are coerced when there is an obvious
 * synonym and otherwise dropped with a warning — never a hard failure, since
 * a wrong shade must not cost the teacher the whole shape.
 */
function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  synonyms: Record<string, string> = {},
): { value?: T; warning?: string } {
  if (value === undefined || value === null) return {}
  const raw = String(value).trim().toLowerCase()
  if ((allowed as readonly string[]).includes(raw)) return { value: raw as T }
  const mapped = synonyms[raw]
  if (mapped) return { value: mapped as T, warning: `${field} "${value}" → "${mapped}"` }
  return {
    warning: `${field} "${value}" ignored; valid values are ${allowed.join(', ')}`,
  }
}

const FILLS = ['none', 'solid', 'tint'] as const
const STROKES = ['solid', 'dashed', 'dotted'] as const
const TEXT_SIZES = ['s', 'm', 'l', 'xl'] as const
const ALIGNS = ['left', 'center', 'right'] as const

interface StyleFields {
  color?: ColorName
  fill?: FillStyle
  stroke?: StrokeStyle
  strokeWidth?: number
  textSize?: TextSize
  textAlign?: TextAlign
  rotation?: number
  opacity?: number
}

function readStyle(src: Record<string, unknown>): { style: StyleFields; warnings: string[] } {
  const style: StyleFields = {}
  const warnings: string[] = []

  const take = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    field: string,
    synonyms?: Record<string, string>,
  ): T | undefined => {
    const res = checkEnum(value, allowed, field, synonyms)
    if (res.warning) warnings.push(res.warning)
    return res.value
  }

  // `fill: "yellow"` is the single most common slip: models read "fill" as
  // "fill colour". Read it as one — colour plus a solid fill — instead of
  // throwing away both halves of the instruction.
  let colorSrc = src.color
  let fillSrc = src.fill
  const fillWord = typeof fillSrc === 'string' ? fillSrc.trim().toLowerCase() : ''
  const fillIsColor =
    fillWord.length > 0 &&
    !(FILLS as readonly string[]).includes(fillWord) &&
    !(fillWord in FILL_SYNONYMS) &&
    (COLOR_NAMES.includes(fillWord as ColorName) || fillWord in COLOR_SYNONYMS)
  if (fillIsColor) {
    if (colorSrc === undefined) colorSrc = fillSrc
    fillSrc = 'solid'
    warnings.push(`fill "${fillWord}" read as colour ${colorSrc} with a solid fill`)
  }

  style.color = take(colorSrc, COLOR_NAMES, 'color', COLOR_SYNONYMS)
  style.fill = take(fillSrc, FILLS, 'fill', FILL_SYNONYMS)
  style.stroke = take(src.stroke ?? src.style, STROKES, 'stroke')
  style.textSize = take(src.textSize, TEXT_SIZES, 'textSize', SIZE_SYNONYMS)
  style.textAlign = take(src.textAlign, ALIGNS, 'textAlign')

  if (typeof src.strokeWidth === 'number') style.strokeWidth = clamp(src.strokeWidth, 0.5, 30)
  if (typeof src.rotation === 'number') style.rotation = src.rotation
  if (typeof src.opacity === 'number') style.opacity = clamp(src.opacity, 0, 1)
  return { style, warnings }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

// ---------------------------------------------------------------- executor

export interface ExecOptions {
  /** Marks new shapes so the board digest can distinguish AI from handwriting. */
  author?: 'ai' | 'human'
  /** Called once after the whole batch so the view repaints a single time. */
  onDone?: () => void
}

export function execute(
  store: BoardStore,
  commands: Command[],
  opts: ExecOptions = {},
): ExecReport {
  const author = opts.author ?? 'ai'
  const results: CommandResult[] = []
  const created: string[] = []

  store.transact('ai-batch', () => {
    commands.forEach((cmd, index) => {
      try {
        const res = runOne(store, cmd, author, created)
        results.push({ index, op: cmd?.op ?? '?', ...res })
      } catch (err) {
        results.push({
          index,
          op: (cmd as Command)?.op ?? '?',
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
  })

  opts.onDone?.()
  const errors = results.filter((r) => !r.ok).map((r) => `#${r.index} ${r.op}: ${r.error}`)
  const warnings = results.flatMap((r) => r.warnings ?? [])
  const messages = commands
    .filter((c): c is Extract<Command, { op: 'say' }> => c?.op === 'say')
    .map((c) => String(c.text ?? '').trim())
    .filter(Boolean)
  return { ok: errors.length === 0, results, created, errors, warnings, messages }
}

function runOne(
  store: BoardStore,
  cmd: Command,
  author: 'ai' | 'human',
  created: string[],
): Omit<CommandResult, 'index' | 'op'> {
  if (!cmd || typeof cmd !== 'object' || !('op' in cmd)) {
    return { ok: false, error: 'command must be an object with an "op" field' }
  }

  switch (cmd.op) {
    case 'add':
      return doAdd(store, cmd, author, created)
    case 'set':
      return doSet(store, cmd)
    case 'delete': {
      const names = resolveTargets(store, cmd.target)
      if (names.length === 0) return { ok: false, error: 'no matching shapes' }
      const gone = names.filter((n) => store.remove(n))
      return { ok: true, names: gone }
    }
    case 'move':
      return doMove(store, cmd)
    case 'resize':
      return doResize(store, cmd)
    case 'rename': {
      if (!store.has(cmd.target)) return { ok: false, error: `no shape named "${cmd.target}"` }
      if (store.has(cmd.to)) return { ok: false, error: `name "${cmd.to}" already taken` }
      store.rename(cmd.target, cmd.to)
      return { ok: true, names: [cmd.to] }
    }
    case 'connect':
      return doConnect(store, cmd, author, created)
    case 'align':
      return doAlign(store, cmd)
    case 'distribute':
      return doDistribute(store, cmd)
    case 'stack':
      return doStack(store, cmd)
    case 'grid':
      return doGrid(store, cmd)
    case 'order': {
      const names = resolveTargets(store, cmd.target)
      const bottom = Math.min(...store.all().map((s) => s.z), 0)
      for (const n of names) {
        store.update(n, { z: cmd.to === 'front' ? store.nextZ() : bottom - 1 })
      }
      return { ok: true, names }
    }
    case 'group': {
      const names = resolveTargets(store, cmd.target)
      if (names.length < 2) return { ok: false, error: 'need at least 2 shapes' }
      const groupId = cmd.name ?? `g${nextId()}`
      for (const n of names) store.update(n, { groupId })
      return { ok: true, names }
    }
    case 'ungroup': {
      const names = resolveTargets(store, cmd.target)
      for (const n of names) store.update(n, { groupId: undefined })
      return { ok: true, names }
    }
    case 'clear': {
      if (cmd.target === undefined) {
        store.clear()
        return { ok: true, names: [] }
      }
      const names = resolveTargets(store, cmd.target)
      for (const n of names) store.remove(n)
      return { ok: true, names }
    }
    case 'select': {
      const names = resolveTargets(store, cmd.target)
      store.selection = new Set(names.filter((n) => store.has(n)))
      return { ok: true, names: [...store.selection] }
    }
    case 'draw':
      return doDraw(store, cmd, author, created)
    case 'say':
      return { ok: typeof cmd.text === 'string' && cmd.text.length > 0, error: cmd.text ? undefined : 'say needs text' }
    case 'focus': {
      const names = resolveTargets(store, cmd.target ?? 'all')
      const rects = names.map((n) => store.bounds(n)).filter(Boolean) as Rect[]
      if (rects.length === 0) return { ok: false, error: 'nothing to focus on' }
      const box = unionRects(rects)
      store.camera = { x: box.x - 40, y: box.y - 40, zoom: store.camera.zoom }
      return { ok: true, names }
    }
    default:
      return { ok: false, error: `unknown op "${(cmd as { op: string }).op}"` }
  }
}

function doAdd(
  store: BoardStore,
  cmd: AddCommand,
  author: 'ai' | 'human',
  created: string[],
): Omit<CommandResult, 'index' | 'op'> {
  const kind = normalizeKind(cmd.shape)
  if (!kind) {
    return {
      ok: false,
      error: `shape "${cmd.shape}" unknown; use rect, ellipse, diamond, triangle, star, note, text, arrow, line, image`,
    }
  }
  // Models reach for `add` for everything. Route the ones that clearly meant
  // something else rather than refusing: an arrow with ends is a connect, a
  // shape carrying points is a freehand path.
  if (Array.isArray((cmd as { points?: unknown }).points)) {
    const draw = cmd as unknown as Extract<Command, { op: 'draw' }>
    const res = doDraw(store, { ...draw, op: 'draw' }, author, created)
    return { ...res, warnings: [...(res.warnings ?? []), 'add with points ran as draw'] }
  }
  if (kind === 'arrow' || kind === 'line') {
    const ends = cmd as unknown as { from?: string; to?: string }
    if (typeof ends.from === 'string' && typeof ends.to === 'string') {
      const res = doConnect(
        store,
        {
          ...(cmd as unknown as Extract<Command, { op: 'connect' }>),
          op: 'connect',
          arrowheads: kind === 'line' ? 'none' : 'end',
        },
        author,
        created,
      )
      return { ...res, warnings: [...(res.warnings ?? []), 'add arrow ran as connect'] }
    }
    return {
      ok: false,
      error:
        'arrows and lines are made with op "connect" (from/to shape names), or op "draw" for a freehand path',
    }
  }

  const { style, warnings } = readStyle(cmd as unknown as Record<string, unknown>)

  const size = resolveSize(store, cmd, kind)
  if (size.error) return { ok: false, error: size.error }

  const at = resolveAt(store, cmd.at, size)
  if (at.error) return { ok: false, error: at.error }
  // No position given: the engine finds an empty spot, so the model can stay
  // out of coordinate arithmetic entirely.
  const pos = at.pos ?? store.findFreeSpot(size.w, size.h)

  const name = store.allocName(kind, cmd.name)
  const shape: GeoShape = {
    id: nextId(),
    name,
    kind: kind as GeoShape['kind'],
    x: pos.x,
    y: pos.y,
    w: size.w,
    h: size.h,
    rotation: style.rotation ?? 0,
    color: style.color ?? DEFAULT_COLOR[kind] ?? 'blue',
    fill: style.fill ?? DEFAULT_FILL[kind] ?? 'none',
    stroke: style.stroke ?? 'solid',
    strokeWidth: style.strokeWidth ?? 2,
    opacity: style.opacity ?? 1,
    text: cmd.text ?? '',
    textAlign: style.textAlign ?? (kind === 'text' ? 'left' : 'center'),
    textSize: style.textSize ?? (kind === 'text' ? 'l' : 'm'),
    z: store.nextZ(),
    locked: false,
    author,
    src: cmd.src,
  }
  store.insert(shape)
  created.push(name)
  return { ok: true, names: [name], warnings }
}

function doSet(store: BoardStore, cmd: SetCommand): Omit<CommandResult, 'index' | 'op'> {
  const names = resolveTargets(store, cmd.target)
  if (names.length === 0) return { ok: false, error: 'no matching shapes' }
  const { style, warnings } = readStyle(cmd as unknown as Record<string, unknown>)

  const touched: string[] = []
  const missing: string[] = []
  for (const name of names) {
    const shape = store.get(name)
    if (!shape) {
      missing.push(name)
      continue
    }
    const patch: Partial<Shape> = { ...style }
    if (cmd.text !== undefined) patch.text = cmd.text
    if (cmd.size || cmd.w !== undefined || cmd.h !== undefined) {
      const size = resolveSize(store, cmd, shape.kind)
      if (size.error) return { ok: false, error: size.error }
      patch.w = size.w
      patch.h = size.h
    }
    if (cmd.at !== undefined) {
      const at = resolveAt(store, cmd.at, { w: shape.w, h: shape.h })
      if (at.error) return { ok: false, error: at.error }
      if (at.pos) {
        patch.x = at.pos.x
        patch.y = at.pos.y
      }
    }
    store.update(name, patch)
    touched.push(name)
  }
  if (touched.length === 0) {
    return { ok: false, error: `no shape named ${missing.map((m) => `"${m}"`).join(', ')}` }
  }
  return { ok: true, names: touched, warnings }
}

function doMove(
  store: BoardStore,
  cmd: { target: Target; at?: At; dx?: number; dy?: number },
): Omit<CommandResult, 'index' | 'op'> {
  const names = resolveTargets(store, cmd.target)
  if (names.length === 0) return { ok: false, error: 'no matching shapes' }
  const touched: string[] = []
  for (const name of names) {
    const shape = store.get(name)
    if (!shape) continue
    if (cmd.at !== undefined) {
      const at = resolveAt(store, cmd.at, { w: shape.w, h: shape.h })
      if (at.error) return { ok: false, error: at.error }
      if (at.pos) translateShape(store, name, at.pos.x - shape.x, at.pos.y - shape.y)
    } else {
      translateShape(store, name, cmd.dx ?? 0, cmd.dy ?? 0)
    }
    touched.push(name)
  }
  return touched.length ? { ok: true, names: touched } : { ok: false, error: 'no shapes found' }
}

/** Moves a shape, carrying ink points and free-floating connector ends with it. */
export function translateShape(store: BoardStore, name: string, dx: number, dy: number): void {
  const shape = store.get(name)
  if (!shape || (dx === 0 && dy === 0)) return
  if (shape.kind === 'ink') {
    store.update(name, {
      x: shape.x + dx,
      y: shape.y + dy,
      points: shape.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
    } as Partial<Shape>)
    return
  }
  if (isConnector(shape)) {
    const shift = (ep: Endpoint): Endpoint =>
      ep.kind === 'point' ? { kind: 'point', x: ep.x + dx, y: ep.y + dy } : ep
    store.update(name, {
      x: shape.x + dx,
      y: shape.y + dy,
      from: shift(shape.from),
      to: shift(shape.to),
    } as Partial<Shape>)
    return
  }
  store.update(name, { x: shape.x + dx, y: shape.y + dy })
}

function doResize(
  store: BoardStore,
  cmd: { target: Target; size?: string; w?: number; h?: number },
): Omit<CommandResult, 'index' | 'op'> {
  const names = resolveTargets(store, cmd.target)
  if (names.length === 0) return { ok: false, error: 'no matching shapes' }
  for (const name of names) {
    const shape = store.get(name)
    if (!shape) continue
    const size = resolveSize(store, cmd, shape.kind)
    if (size.error) return { ok: false, error: size.error }
    store.update(name, { w: size.w, h: size.h })
  }
  return { ok: true, names }
}

function doConnect(
  store: BoardStore,
  cmd: Extract<Command, { op: 'connect' }>,
  author: 'ai' | 'human',
  created: string[],
): Omit<CommandResult, 'index' | 'op'> {
  const from = endpointFor(store, cmd.from)
  if (!from) return { ok: false, error: `no shape named "${cmd.from}"` }
  const to = endpointFor(store, cmd.to)
  if (!to) return { ok: false, error: `no shape named "${cmd.to}"` }

  const { style, warnings } = readStyle(cmd as unknown as Record<string, unknown>)
  const heads = cmd.arrowheads ?? 'end'
  const name = store.allocName('arrow', cmd.name)
  const shape: ConnectorShape = {
    id: nextId(),
    name,
    kind: heads === 'none' ? 'line' : 'arrow',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    rotation: 0,
    color: style.color ?? 'black',
    fill: 'none',
    stroke: style.stroke ?? 'solid',
    strokeWidth: style.strokeWidth ?? 2,
    opacity: style.opacity ?? 1,
    text: cmd.text ?? '',
    textAlign: 'center',
    textSize: style.textSize ?? 's',
    z: store.nextZ(),
    locked: false,
    author,
    from,
    to,
    bend: cmd.bend ?? 0,
    headStart: heads === 'both',
    headEnd: heads === 'end' || heads === 'both',
  }
  store.insert(shape)
  created.push(name)
  return { ok: true, names: [name], warnings }
}

/**
 * Freehand path — how the AI adds marks that are not boxes: hair on a face,
 * a tick, an underline, a squiggle. Points are few and coarse; `smooth` runs a
 * Catmull-Rom pass so three points become a clean curve rather than a dogleg.
 */
function doDraw(
  store: BoardStore,
  cmd: Extract<Command, { op: 'draw' }>,
  author: 'ai' | 'human',
  created: string[],
): Omit<CommandResult, 'index' | 'op'> {
  if (!Array.isArray(cmd.points) || cmd.points.length < 2) {
    return { ok: false, error: 'draw needs at least 2 points' }
  }

  let frame: Rect | null = null
  if (cmd.relativeTo) {
    frame = store.bounds(cmd.relativeTo)
    if (!frame) return { ok: false, error: `no shape named "${cmd.relativeTo}"` }
  }

  const pts: { x: number; y: number }[] = []
  for (const raw of cmd.points) {
    const p = resolveDrawPoint(store, raw, frame)
    if (!p) {
      return {
        ok: false,
        error: cmd.relativeTo
          ? `point ${JSON.stringify(raw)} must be [u,v] fractions of ${cmd.relativeTo}, a cell ref, or {x,y}`
          : `point ${JSON.stringify(raw)} must be a cell ref like "C3" or {x,y}; pass relativeTo to use fractions`,
      }
    }
    pts.push(p)
  }

  const closed = cmd.closed === true
  const path =
    cmd.smooth === false
      ? closed ? [...pts, { ...pts[0] }] : pts
      : smoothPath(pts, closed)

  const { style, warnings } = readStyle(cmd as unknown as Record<string, unknown>)
  const name = store.allocName('ink', cmd.name)
  const shape: InkShape = {
    id: nextId(),
    name,
    kind: 'ink',
    x: path[0].x,
    y: path[0].y,
    w: 0,
    h: 0,
    rotation: 0,
    color: style.color ?? 'black',
    fill: 'none',
    stroke: 'solid',
    strokeWidth: style.strokeWidth ?? 4,
    opacity: style.opacity ?? 1,
    text: '',
    textAlign: 'left',
    textSize: 'm',
    z: store.nextZ(),
    locked: false,
    author,
    points: path.map((p) => ({ ...p, p: 0.6 })),
  }
  store.insert(shape)
  created.push(name)
  return { ok: true, names: [name], warnings }
}

function resolveDrawPoint(
  store: BoardStore,
  raw: DrawPoint,
  frame: Rect | null,
): { x: number; y: number } | null {
  if (typeof raw === 'string') {
    const cell = parseCell(raw)
    return cell ? cellToWorld(cell, store.cellSize) : null
  }
  if (Array.isArray(raw) && raw.length === 2 && raw.every((n) => typeof n === 'number')) {
    if (!frame) return null
    return { x: frame.x + raw[0] * frame.w, y: frame.y + raw[1] * frame.h }
  }
  if (raw && typeof raw === 'object' && 'x' in raw && 'y' in raw) {
    if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return null
    return { x: raw.x, y: raw.y }
  }
  return null
}

/**
 * Catmull-Rom through every control point. When `closed`, neighbours wrap
 * around, so four points describe a circle rather than a diamond with a corner
 * where the path rejoins itself.
 */
function smoothPath(
  pts: { x: number; y: number }[],
  closed = false,
  perSegment = 10,
): { x: number; y: number }[] {
  if (pts.length < 3) return closed ? [...pts, { ...pts[0] }] : pts
  const out: { x: number; y: number }[] = []
  const n = pts.length
  const at = (i: number) =>
    closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]
  const segments = closed ? n : n - 1
  for (let i = 0; i < segments; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment
      const t2 = t * t
      const t3 = t2 * t
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  out.push(closed ? { ...pts[0] } : pts[n - 1])
  return out
}

/** Accepts a shape name, or a cell ref for a loose endpoint. */
function endpointFor(store: BoardStore, ref: string): Endpoint | null {
  if (typeof ref !== 'string') return null
  if (store.has(ref)) return { kind: 'shape', name: ref }
  const cell = parseCell(ref)
  if (cell) {
    const p = cellToWorld(cell, store.cellSize)
    return { kind: 'point', x: p.x, y: p.y }
  }
  return null
}

function boundsOf(store: BoardStore, names: string[]): { name: string; r: Rect }[] {
  return names
    .map((name) => {
      const s = store.get(name)
      return s ? { name, r: shapeBounds(s, store.map()) } : null
    })
    .filter(Boolean) as { name: string; r: Rect }[]
}

function doAlign(
  store: BoardStore,
  cmd: Extract<Command, { op: 'align' }>,
): Omit<CommandResult, 'index' | 'op'> {
  const items = boundsOf(store, resolveTargets(store, cmd.target))
  if (items.length < 1) return { ok: false, error: 'no matching shapes' }
  const edges = ['left', 'right', 'top', 'bottom', 'centerx', 'centery'] as const
  const edge = String(cmd.edge ?? '').toLowerCase()
  if (!edges.includes(edge as (typeof edges)[number])) {
    return { ok: false, error: `align.edge "${cmd.edge}" invalid; use ${edges.join(', ')}` }
  }

  const xs = items.map((i) => i.r.x)
  const rights = items.map((i) => i.r.x + i.r.w)
  const ys = items.map((i) => i.r.y)
  const bottoms = items.map((i) => i.r.y + i.r.h)

  for (const { name, r } of items) {
    switch (edge) {
      case 'left':
        translateShape(store, name, Math.min(...xs) - r.x, 0)
        break
      case 'right':
        translateShape(store, name, Math.max(...rights) - (r.x + r.w), 0)
        break
      case 'top':
        translateShape(store, name, 0, Math.min(...ys) - r.y)
        break
      case 'bottom':
        translateShape(store, name, 0, Math.max(...bottoms) - (r.y + r.h))
        break
      case 'centerx': {
        const mid = (Math.min(...xs) + Math.max(...rights)) / 2
        translateShape(store, name, mid - (r.x + r.w / 2), 0)
        break
      }
      case 'centery': {
        const mid = (Math.min(...ys) + Math.max(...bottoms)) / 2
        translateShape(store, name, 0, mid - (r.y + r.h / 2))
        break
      }
    }
  }
  return { ok: true, names: items.map((i) => i.name) }
}

function doDistribute(
  store: BoardStore,
  cmd: Extract<Command, { op: 'distribute' }>,
): Omit<CommandResult, 'index' | 'op'> {
  const axis = cmd.axis === 'y' ? 'y' : 'x'
  const items = boundsOf(store, resolveTargets(store, cmd.target))
  if (items.length < 3 && cmd.gap === undefined) {
    return { ok: false, error: 'need 3+ shapes, or pass a gap' }
  }
  items.sort((a, b) => (axis === 'x' ? a.r.x - b.r.x : a.r.y - b.r.y))

  if (cmd.gap !== undefined) {
    let cursor = axis === 'x' ? items[0].r.x : items[0].r.y
    for (const { name, r } of items) {
      const delta = cursor - (axis === 'x' ? r.x : r.y)
      translateShape(store, name, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0)
      cursor += (axis === 'x' ? r.w : r.h) + cmd.gap
    }
  } else {
    const first = items[0].r
    const last = items[items.length - 1].r
    const span =
      axis === 'x' ? last.x + last.w - first.x : last.y + last.h - first.y
    const used = items.reduce((sum, i) => sum + (axis === 'x' ? i.r.w : i.r.h), 0)
    const gap = (span - used) / (items.length - 1)
    let cursor = axis === 'x' ? first.x : first.y
    for (const { name, r } of items) {
      const delta = cursor - (axis === 'x' ? r.x : r.y)
      translateShape(store, name, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0)
      cursor += (axis === 'x' ? r.w : r.h) + gap
    }
  }
  return { ok: true, names: items.map((i) => i.name) }
}

function doStack(
  store: BoardStore,
  cmd: Extract<Command, { op: 'stack' }>,
): Omit<CommandResult, 'index' | 'op'> {
  const items = boundsOf(store, resolveTargets(store, cmd.target))
  if (items.length === 0) return { ok: false, error: 'no matching shapes' }
  const dir = cmd.dir === 'right' ? 'right' : 'down'
  const gap = cmd.gap ?? store.cellSize / 2

  const start = resolveAt(store, cmd.at, { w: items[0].r.w, h: items[0].r.h })
  if (start.error) return { ok: false, error: start.error }
  const origin = start.pos ?? { x: items[0].r.x, y: items[0].r.y }

  let cursor = dir === 'down' ? origin.y : origin.x
  for (const { name, r } of items) {
    const dx = dir === 'down' ? origin.x - r.x : cursor - r.x
    const dy = dir === 'down' ? cursor - r.y : origin.y - r.y
    translateShape(store, name, dx, dy)
    cursor += (dir === 'down' ? r.h : r.w) + gap
  }
  return { ok: true, names: items.map((i) => i.name) }
}

function doGrid(
  store: BoardStore,
  cmd: Extract<Command, { op: 'grid' }>,
): Omit<CommandResult, 'index' | 'op'> {
  const items = boundsOf(store, resolveTargets(store, cmd.target))
  if (items.length === 0) return { ok: false, error: 'no matching shapes' }
  const cols = Math.max(1, cmd.cols ?? Math.ceil(Math.sqrt(items.length)))
  const gap = cmd.gap ?? store.cellSize / 2

  const start = resolveAt(store, cmd.at, { w: items[0].r.w, h: items[0].r.h })
  if (start.error) return { ok: false, error: start.error }
  const origin = start.pos ?? { x: items[0].r.x, y: items[0].r.y }

  const colWidth = Math.max(...items.map((i) => i.r.w)) + gap
  const rowHeight = Math.max(...items.map((i) => i.r.h)) + gap

  items.forEach(({ name, r }, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    translateShape(store, name, origin.x + col * colWidth - r.x, origin.y + row * rowHeight - r.y)
  })
  return { ok: true, names: items.map((i) => i.name) }
}

/** Centre point of a shape — used by the UI for connector previews. */
export function centerOf(store: BoardStore, name: string): { x: number; y: number } | null {
  const r = store.bounds(name)
  return r ? rectCenter(r) : null
}
