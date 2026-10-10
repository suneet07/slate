import { DASH_PATTERN, FONT_SIZE, PALETTE } from './palette'
import { resolveEndpoint, shapeBounds } from './geometry'
import type { BoardStore } from './store'
import {
  type ConnectorShape,
  type GeoShape,
  type InkShape,
  type Point,
  type Shape,
  isConnector,
  isInk,
} from './types'

export interface RenderOptions {
  showGrid: boolean
  showLabels: boolean
  /** Cell reference currently hovered, drawn as a hint in the corner. */
  hoverCell?: string | null
  /** Optional marquee selection rectangle */
  marquee?: { x: number; y: number; w: number; h: number }
}

const FONT_STACK =
  '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif'

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private canvas: HTMLCanvasElement
  private store: BoardStore
  private dpr = 1

  constructor(canvas: HTMLCanvasElement, store: BoardStore) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.canvas = canvas
    this.store = store
    this.ctx = ctx
  }

  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.floor(width * this.dpr)
    this.canvas.height = Math.floor(height * this.dpr)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
  }

  get width(): number {
    return this.canvas.width / this.dpr
  }

  get height(): number {
    return this.canvas.height / this.dpr
  }

  render(opts: RenderOptions): void {
    const { ctx, store } = this
    const cam = store.camera
    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.fillStyle = '#fbfbfa'
    ctx.fillRect(0, 0, this.width, this.height)

    ctx.translate(-cam.x * cam.zoom, -cam.y * cam.zoom)
    ctx.scale(cam.zoom, cam.zoom)

    if (opts.showGrid) this.drawGrid()

    const shapes = store.all()
    for (const shape of shapes) this.drawShape(shape)
    if (opts.showLabels) {
      for (const shape of shapes) this.drawNameLabel(shape)
    }

    this.drawSelection()
    
    if (opts.marquee) {
      ctx.fillStyle = 'rgba(25, 113, 194, 0.1)'
      ctx.fillRect(opts.marquee.x, opts.marquee.y, opts.marquee.w, opts.marquee.h)
      ctx.strokeStyle = '#1971c2'
      ctx.lineWidth = 1 / cam.zoom
      ctx.strokeRect(opts.marquee.x, opts.marquee.y, opts.marquee.w, opts.marquee.h)
    }

    ctx.restore()
  }

  // ------------------------------------------------------------------- grid

  private drawGrid(): void {
    const { ctx, store } = this
    const { cellSize, cols, rows } = store
    const w = cols * cellSize
    const h = rows * cellSize

    ctx.save()
    ctx.lineWidth = 1 / store.camera.zoom

    ctx.strokeStyle = '#e6e6e3'
    ctx.beginPath()
    for (let c = 0; c <= cols; c++) {
      ctx.moveTo(c * cellSize, 0)
      ctx.lineTo(c * cellSize, h)
    }
    for (let r = 0; r <= rows; r++) {
      ctx.moveTo(0, r * cellSize)
      ctx.lineTo(w, r * cellSize)
    }
    ctx.stroke()

    // Column letters and row numbers in the gutter, so a human can read the
    // same addresses the AI is using.
    ctx.fillStyle = '#b6b6b0'
    ctx.font = `${11 / store.camera.zoom}px ${FONT_STACK}`
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'center'
    for (let c = 0; c < cols; c++) {
      ctx.fillText(colLetters(c), c * cellSize + cellSize / 2, -4 / store.camera.zoom)
    }
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let r = 0; r < rows; r++) {
      ctx.fillText(String(r + 1), -6 / store.camera.zoom, r * cellSize + cellSize / 2)
    }

    ctx.strokeStyle = '#d5d5d0'
    ctx.lineWidth = 1.5 / store.camera.zoom
    ctx.strokeRect(0, 0, w, h)
    ctx.restore()
  }

  // ----------------------------------------------------------------- shapes

  private drawShape(shape: Shape): void {
    const { ctx } = this
    ctx.save()
    ctx.globalAlpha = shape.opacity
    if (isConnector(shape)) this.drawConnector(shape)
    else if (isInk(shape)) this.drawInk(shape)
    else this.drawGeo(shape)
    ctx.restore()
  }

  private applyStroke(shape: Shape): void {
    const { ctx } = this
    const swatch = PALETTE[shape.color] ?? PALETTE.black
    ctx.strokeStyle = swatch.stroke
    ctx.lineWidth = shape.strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash(DASH_PATTERN[shape.stroke] ?? [])
  }

  private applyFill(shape: Shape): string | null {
    const swatch = PALETTE[shape.color] ?? PALETTE.black
    if (shape.fill === 'solid') return swatch.solid
    if (shape.fill === 'tint') return swatch.tint
    return null
  }

  private drawGeo(shape: GeoShape): void {
    const { ctx } = this
    const cx = shape.x + shape.w / 2
    const cy = shape.y + shape.h / 2
    if (shape.rotation) {
      ctx.translate(cx, cy)
      ctx.rotate((shape.rotation * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }

    if (shape.kind === 'text') {
      this.drawText(shape, { x: shape.x, y: shape.y, w: shape.w, h: shape.h })
      return
    }

    if (shape.kind === 'image' && shape.src) {
      const img = getImage(shape.src, () => this.store.emit('image-loaded'))
      if (img) ctx.drawImage(img, shape.x, shape.y, shape.w, shape.h)
      else {
        ctx.fillStyle = '#eee'
        ctx.fillRect(shape.x, shape.y, shape.w, shape.h)
      }
      return
    }

    this.applyStroke(shape)
    const fill = shape.kind === 'note' ? PALETTE[shape.color].tint : this.applyFill(shape)

    ctx.beginPath()
    switch (shape.kind) {
      case 'rect':
      case 'note':
        roundRect(ctx, shape.x, shape.y, shape.w, shape.h, shape.kind === 'note' ? 4 : 8)
        break
      case 'ellipse':
        ctx.ellipse(cx, cy, shape.w / 2, shape.h / 2, 0, 0, Math.PI * 2)
        break
      case 'diamond':
        polygon(ctx, [
          { x: cx, y: shape.y },
          { x: shape.x + shape.w, y: cy },
          { x: cx, y: shape.y + shape.h },
          { x: shape.x, y: cy },
        ])
        break
      case 'triangle':
        polygon(ctx, [
          { x: cx, y: shape.y },
          { x: shape.x + shape.w, y: shape.y + shape.h },
          { x: shape.x, y: shape.y + shape.h },
        ])
        break
      case 'star':
        polygon(ctx, starPoints(cx, cy, shape.w / 2, shape.h / 2))
        break
    }

    if (fill) {
      ctx.fillStyle = fill
      ctx.fill()
    }
    if (shape.kind === 'note') {
      ctx.strokeStyle = PALETTE[shape.color].stroke
      ctx.globalAlpha *= 0.4
      ctx.stroke()
      ctx.globalAlpha /= 0.4
    } else {
      ctx.stroke()
    }

    if (shape.text) {
      const pad = 10
      this.drawText(shape, {
        x: shape.x + pad,
        y: shape.y + pad,
        w: shape.w - pad * 2,
        h: shape.h - pad * 2,
      })
    }
  }

  private drawText(shape: Shape, box: { x: number; y: number; w: number; h: number }): void {
    const { ctx } = this
    if (!shape.text) return
    const size = FONT_SIZE[shape.textSize] ?? FONT_SIZE.m
    const swatch = PALETTE[shape.color] ?? PALETTE.black
    // Solid-filled shapes get light text so the label stays legible.
    const onSolid = shape.fill === 'solid' && shape.kind !== 'text' && shape.kind !== 'note'
    ctx.fillStyle = onSolid ? '#ffffff' : swatch.text
    ctx.font = `${size}px ${FONT_STACK}`
    ctx.textBaseline = 'top'
    ctx.textAlign = shape.textAlign

    const lines = wrapText(ctx, shape.text, Math.max(20, box.w))
    const lineHeight = size * 1.35
    const totalH = lines.length * lineHeight
    // Standalone text hangs from the top; labels inside shapes centre vertically.
    const startY = shape.kind === 'text' ? box.y : box.y + Math.max(0, (box.h - totalH) / 2)
    const anchorX =
      shape.textAlign === 'center' ? box.x + box.w / 2 : shape.textAlign === 'right' ? box.x + box.w : box.x

    lines.forEach((line, i) => {
      ctx.fillText(line, anchorX, startY + i * lineHeight)
    })
  }

  private drawConnector(shape: ConnectorShape): void {
    const { ctx } = this
    const map = this.store.map()
    const a = resolveEndpoint(shape.from, map, shape)
    const b = resolveEndpoint(shape.to, map, shape)
    this.applyStroke(shape)

    const mid = bendPoint(a, b, shape.bend)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    if (shape.bend) ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y)
    else ctx.lineTo(b.x, b.y)
    ctx.stroke()

    ctx.setLineDash([])
    const headSize = 6 + shape.strokeWidth * 2.5
    if (shape.headEnd) this.drawArrowhead(b, shape.bend ? mid : a, headSize, shape)
    if (shape.headStart) this.drawArrowhead(a, shape.bend ? mid : b, headSize, shape)

    if (shape.text) {
      const label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const size = FONT_SIZE[shape.textSize] ?? FONT_SIZE.s
      ctx.font = `${size}px ${FONT_STACK}`
      const metrics = ctx.measureText(shape.text)
      ctx.fillStyle = '#fbfbfa'
      ctx.fillRect(label.x - metrics.width / 2 - 4, label.y - size / 2 - 3, metrics.width + 8, size + 6)
      ctx.fillStyle = PALETTE[shape.color].text
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(shape.text, label.x, label.y)
    }
  }

  private drawArrowhead(tip: Point, from: Point, size: number, shape: Shape): void {
    const { ctx } = this
    const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
    const spread = 0.45
    ctx.beginPath()
    ctx.moveTo(tip.x, tip.y)
    ctx.lineTo(tip.x - size * Math.cos(angle - spread), tip.y - size * Math.sin(angle - spread))
    ctx.lineTo(tip.x - size * Math.cos(angle + spread), tip.y - size * Math.sin(angle + spread))
    ctx.closePath()
    ctx.fillStyle = PALETTE[shape.color].stroke
    ctx.fill()
  }

  private drawInk(shape: InkShape): void {
    const { ctx } = this
    const pts = shape.points
    if (pts.length < 2) {
      if (pts.length === 1) {
        ctx.beginPath()
        ctx.arc(pts[0].x, pts[0].y, shape.strokeWidth / 2, 0, Math.PI * 2)
        ctx.fillStyle = PALETTE[shape.color].stroke
        ctx.fill()
      }
      return
    }
    ctx.strokeStyle = PALETTE[shape.color].stroke
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])

    const fill = this.applyFill(shape)
    if (fill) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.fillStyle = fill
      ctx.fill()
    }

    // Segment-by-segment so stylus pressure can modulate width.
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1]
      const cur = pts[i]
      ctx.beginPath()
      ctx.lineWidth = shape.strokeWidth * (0.5 + ((prev.p + cur.p) / 2) * 0.9)
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(cur.x, cur.y)
      ctx.stroke()
    }
  }

  private drawNameLabel(shape: Shape): void {
    const { ctx, store } = this
    const r = shapeBounds(shape, store.map())
    const zoom = store.camera.zoom
    const size = 10 / zoom
    ctx.save()
    ctx.font = `${size}px ${FONT_STACK}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    const w = ctx.measureText(shape.name).width
    ctx.fillStyle = shape.author === 'ai' ? 'rgba(112,72,232,0.12)' : 'rgba(0,0,0,0.06)'
    ctx.fillRect(r.x, r.y - size - 4 / zoom, w + 8 / zoom, size + 4 / zoom)
    ctx.fillStyle = shape.author === 'ai' ? '#5f3dc4' : '#777'
    ctx.fillText(shape.name, r.x + 4 / zoom, r.y - 2 / zoom)
    ctx.restore()
  }

  private drawSelection(): void {
    const { ctx, store } = this
    if (store.selection.size === 0) return
    const zoom = store.camera.zoom
    ctx.save()
    ctx.strokeStyle = '#1971c2'
    ctx.lineWidth = 1.5 / zoom
    ctx.setLineDash([])
    for (const name of store.selection) {
      const shape = store.get(name)
      if (!shape) continue
      const r = shapeBounds(shape, store.map())
      const pad = 4 / zoom
      ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2)
      const hs = 4 / zoom
      ctx.fillStyle = '#ffffff'
      for (const [hx, hy] of [
        [r.x, r.y],
        [r.x + r.w, r.y],
        [r.x, r.y + r.h],
        [r.x + r.w, r.y + r.h],
      ]) {
        ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2)
        ctx.strokeRect(hx - hs, hy - hs, hs * 2, hs * 2)
      }
    }
    ctx.restore()
  }
}

// ------------------------------------------------------------------ helpers

function colLetters(col: number): string {
  let n = col
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function polygon(ctx: CanvasRenderingContext2D, pts: Point[]): void {
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
}

function starPoints(cx: number, cy: number, rx: number, ry: number): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2
    const f = i % 2 === 0 ? 1 : 0.42
    pts.push({ x: cx + Math.cos(angle) * rx * f, y: cy + Math.sin(angle) * ry * f })
  }
  return pts
}

function bendPoint(a: Point, b: Point, bend: number): Point {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  if (!bend) return { x: mx, y: my }
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: mx + (-dy / len) * bend * 2, y: my + (dx / len) * bend * 2 }
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = test
      }
    }
    lines.push(line)
  }
  return lines
}

const imageCache = new Map<string, HTMLImageElement | null>()

function getImage(src: string, onLoad: () => void): HTMLImageElement | null {
  const cached = imageCache.get(src)
  if (cached !== undefined) return cached
  imageCache.set(src, null)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    imageCache.set(src, img)
    onLoad()
  }
  img.src = src
  return null
}
