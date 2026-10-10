import type { ConnectorShape, Endpoint, InkShape, Point, Shape } from './types'
import { isConnector, isInk } from './types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function shapeBounds(shape: Shape, all: Map<string, Shape>): Rect {
  if (isConnector(shape)) {
    const a = resolveEndpoint(shape.from, all, shape)
    const b = resolveEndpoint(shape.to, all, shape)
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    }
  }
  if (isInk(shape)) return inkBounds(shape)
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
}

export function inkBounds(shape: InkShape): Rect {
  if (shape.points.length === 0) return { x: shape.x, y: shape.y, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of shape.points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

export function unionRects(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  )
}

/**
 * Where a connector actually starts/ends. Shape-bound endpoints resolve to the
 * point on the target's border facing the other end, so arrows stay attached
 * and correctly clipped when either shape moves.
 */
export function resolveEndpoint(
  ep: Endpoint,
  all: Map<string, Shape>,
  connector?: ConnectorShape,
): Point {
  if (ep.kind === 'point') return { x: ep.x, y: ep.y }
  const target = all.get(ep.name)
  if (!target) return { x: 0, y: 0 }
  const rect = shapeBounds(target, all)
  const center = rectCenter(rect)
  if (!connector) return center

  const other = ep === connector.from ? connector.to : connector.from
  const towards = otherPoint(other, all, target.name)
  return borderPoint(rect, towards ?? center)
}

function otherPoint(
  ep: Endpoint,
  all: Map<string, Shape>,
  skipName: string,
): Point | null {
  if (ep.kind === 'point') return { x: ep.x, y: ep.y }
  if (ep.name === skipName) return null
  const s = all.get(ep.name)
  if (!s) return null
  return rectCenter(shapeBounds(s, all))
}

/** Intersection of the ray centre->towards with the rectangle border. */
export function borderPoint(rect: Rect, towards: Point): Point {
  const c = rectCenter(rect)
  const dx = towards.x - c.x
  const dy = towards.y - c.y
  if (dx === 0 && dy === 0) return c
  const hw = rect.w / 2
  const hh = rect.h / 2
  // Scale the direction vector until it hits the nearer of the two edge pairs.
  const scale = Math.min(
    dx === 0 ? Infinity : hw / Math.abs(dx),
    dy === 0 ? Infinity : hh / Math.abs(dy),
  )
  return { x: c.x + dx * scale, y: c.y + dy * scale }
}

export function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return (
    p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad
  )
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

/** Hit test in world space. Tolerance is in world units. */
export function hitTest(shape: Shape, p: Point, all: Map<string, Shape>, tol = 6, fillHollow = false): boolean {
  if (isConnector(shape)) {
    const a = resolveEndpoint(shape.from, all, shape)
    const b = resolveEndpoint(shape.to, all, shape)
    return distToSegment(p, a, b) <= tol + shape.strokeWidth
  }
  if (isInk(shape)) {
    for (let i = 1; i < shape.points.length; i++) {
      if (distToSegment(p, shape.points[i - 1], shape.points[i]) <= tol + shape.strokeWidth) {
        return true
      }
    }
    if ((fillHollow || shape.fill !== 'none') && shape.points.length > 2 && pointInPolygon(p, shape.points)) {
      return true
    }
    return false
  }
  const r = { x: shape.x, y: shape.y, w: shape.w, h: shape.h }
  if (!fillHollow && shape.fill === 'none' && shape.kind !== 'note' && shape.kind !== 'text') {
    // Hollow shapes are only grabbable near their outline.
    const inner = { x: r.x + tol, y: r.y + tol, w: r.w - tol * 2, h: r.h - tol * 2 }
    return pointInRect(p, r, tol) && !(inner.w > 0 && inner.h > 0 && pointInRect(p, inner))
  }
  return pointInRect(p, r, tol)
}

/** Ramer-Douglas-Peucker — keeps ink light before it is stored or serialized. */
export function simplifyStroke<T extends Point>(points: T[], epsilon = 1.2): T[] {
  if (points.length < 3) return points
  let maxDist = 0
  let index = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment(points[i], first, last)
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist <= epsilon) return [first, last]
  const left = simplifyStroke(points.slice(0, index + 1), epsilon)
  const right = simplifyStroke(points.slice(index), epsilon)
  return [...left.slice(0, -1), ...right]
}

export function pointInPolygon(p: Point, pts: Point[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y
    const xj = pts[j].x, yj = pts[j].y
    const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}
