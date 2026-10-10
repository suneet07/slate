/**
 * Core scene-graph types for the whiteboard engine.
 *
 * Design rule: everything the AI touches is addressed by a short, readable
 * `name` (e.g. "box1", "title"), never by an opaque uuid. Names are unique
 * per board and are generated deterministically when the AI omits one.
 */

export type ShapeKind =
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'star'
  | 'note'
  | 'text'
  | 'line'
  | 'arrow'
  | 'ink'
  | 'image'

/** Named palette. Models pick a word, never a hex code. */
export type ColorName =
  | 'black'
  | 'grey'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'violet'
  | 'pink'
  | 'white'

export type FillStyle = 'none' | 'solid' | 'tint'
export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type TextAlign = 'left' | 'center' | 'right'
export type TextSize = 's' | 'm' | 'l' | 'xl'

export interface Point {
  x: number
  y: number
}

/** A point captured from a stylus, with pressure for ink rendering. */
export interface StrokePoint extends Point {
  p: number
}

/** Endpoint of a line/arrow: either a fixed world point or bound to a shape. */
export type Endpoint =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'shape'; name: string }

export interface BaseShape {
  /** Stable unique id used internally by the renderer/store. */
  id: string
  /** Short readable handle. This is the only address the AI ever uses. */
  name: string
  kind: ShapeKind
  /** Top-left corner in world units. */
  x: number
  y: number
  /** Bounding size in world units. Ignored by line/arrow (endpoint-driven). */
  w: number
  h: number
  /** Rotation in degrees, clockwise, about the shape centre. */
  rotation: number
  color: ColorName
  fill: FillStyle
  stroke: StrokeStyle
  strokeWidth: number
  opacity: number
  text: string
  textAlign: TextAlign
  textSize: TextSize
  /** Stacking order; higher renders on top. */
  z: number
  locked: boolean
  /** Who created it — lets the UI and the AI tell handwriting from generated content. */
  author: 'human' | 'ai'
  /** Group membership; shapes with the same groupId move together. */
  groupId?: string
}

export interface GeoShape extends BaseShape {
  kind: 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'star' | 'note' | 'text' | 'image'
  /** Only meaningful for kind === 'image'. */
  src?: string
}

export interface ConnectorShape extends BaseShape {
  kind: 'line' | 'arrow'
  from: Endpoint
  to: Endpoint
  /** Perpendicular bow of the curve in world units. 0 = straight. */
  bend: number
  /** Arrowheads. */
  headStart: boolean
  headEnd: boolean
}

export interface InkShape extends BaseShape {
  kind: 'ink'
  /** Points are absolute world coordinates. */
  points: StrokePoint[]
}

export type Shape = GeoShape | ConnectorShape | InkShape

export interface Camera {
  x: number
  y: number
  zoom: number
}

export interface Board {
  /** Grid width/height measured in cells. Defines the addressable A1..Zn space. */
  cols: number
  rows: number
  /** World units per grid cell. */
  cellSize: number
  shapes: Shape[]
  camera: Camera
}

export const isConnector = (s: Shape): s is ConnectorShape =>
  s.kind === 'line' || s.kind === 'arrow'

export const isInk = (s: Shape): s is InkShape => s.kind === 'ink'

export const isGeo = (s: Shape): s is GeoShape =>
  !isConnector(s) && !isInk(s)
