import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Renderer } from '../engine/renderer'
import { hitTest, shapeBounds, simplifyStroke } from '../engine/geometry'
import { snapToGrid, worldToCellRef } from '../engine/grid'
import { nextId, type BoardStore } from '../engine/store'
import {
  type ColorName,
  type GeoShape,
  type InkShape,
  type Point,
  type ShapeKind,
  type StrokePoint,
  isConnector,
} from '../engine/types'
import { execute, translateShape } from '../ai/commands'

export type Tool =
  | 'select'
  | 'pen'
  | 'eraser'
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'star'
  | 'note'
  | 'text'
  | 'arrow'
  | 'fill'

interface Props {
  store: BoardStore
  version: number
  tool: Tool
  color: ColorName
  showGrid: boolean
  showLabels: boolean
  onToolDone: () => void
  onHoverCell: (cell: string | null) => void
}

type Drag =
  | { mode: 'none' }
  | { mode: 'pan'; startScreen: Point; startCam: Point }
  | { mode: 'move'; names: string[]; last: Point }
  | { mode: 'marquee'; start: Point; current: Point }
  | { mode: 'create'; name: string; origin: Point }
  | { mode: 'ink'; name: string; points: StrokePoint[] }
  | { mode: 'connect'; from: string; current: Point }

export function Whiteboard({
  store,
  version,
  tool,
  color,
  showGrid,
  showLabels,
  onToolDone,
  onHoverCell,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const dragRef = useRef<Drag>({ mode: 'none' })
  const [editing, setEditing] = useState<{ name: string; value: string } | null>(null)

  const screenToWorld = useCallback(
    (sx: number, sy: number): Point => {
      const rect = canvasRef.current?.getBoundingClientRect()
      const px = sx - (rect?.left ?? 0)
      const py = sy - (rect?.top ?? 0)
      const cam = store.camera
      return { x: px / cam.zoom + cam.x, y: py / cam.zoom + cam.y }
    },
    [store],
  )

  // ------------------------------------------------------------ render loop

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const renderer = new Renderer(canvas, store)
    rendererRef.current = renderer

    const resize = () => {
      const r = wrap.getBoundingClientRect()
      renderer.resize(r.width, r.height)
      renderer.render({ showGrid, showLabels })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [store, showGrid, showLabels])

  useEffect(() => {
    const drag = dragRef.current
    const marquee = drag.mode === 'marquee' ? normalizeRect(drag.start, drag.current) : undefined
    rendererRef.current?.render({ showGrid, showLabels, marquee })
  }, [version, showGrid, showLabels, store.camera.x, store.camera.y, store.camera.zoom])

  // ------------------------------------------------------------ interaction

  const beginShape = (kind: ShapeKind, at: Point): string => {
    const name = store.allocName(kind)
    const shape: GeoShape = {
      id: nextId(),
      name,
      kind: kind as GeoShape['kind'],
      x: at.x,
      y: at.y,
      w: 0,
      h: 0,
      rotation: 0,
      color: kind === 'note' ? 'yellow' : color,
      fill: kind === 'note' ? 'tint' : 'none',
      stroke: 'solid',
      strokeWidth: 2,
      opacity: 1,
      text: '',
      textAlign: kind === 'text' ? 'left' : 'center',
      textSize: kind === 'text' ? 'l' : 'm',
      z: store.nextZ(),
      locked: false,
      author: 'human',
    }
    store.insert(shape)
    return name
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    const world = screenToWorld(e.clientX, e.clientY)

    // Panning disabled to keep the grid locked.
    if (e.button === 1 || e.buttons === 4 || spaceHeld) {
      return
    }

    if (tool === 'pen') {
      const name = store.allocName('ink')
      const first: StrokePoint = { x: world.x, y: world.y, p: e.pressure || 0.5 }
      const shape: InkShape = {
        id: nextId(),
        name,
        kind: 'ink',
        x: world.x,
        y: world.y,
        w: 0,
        h: 0,
        rotation: 0,
        color,
        fill: 'none',
        stroke: 'solid',
        strokeWidth: 4,
        opacity: 1,
        text: '',
        textAlign: 'left',
        textSize: 'm',
        z: store.nextZ(),
        locked: false,
        author: 'human',
        points: [first],
      }
      store.insert(shape)
      dragRef.current = { mode: 'ink', name, points: [first] }
      store.emit('ink-start')
      return
    }

    if (tool === 'eraser') {
      const hit = topShapeAt(store, world)
      if (hit) store.transact('erase', () => store.remove(hit))
      return
    }

    if (tool === 'fill') {
      const hit = topShapeAt(store, world, true)
      if (hit) {
        store.transact('fill', () => {
          const shape = store.get(hit)
          if (!shape) return
          if (shape.kind === 'line' || shape.kind === 'arrow' || shape.kind === 'text') {
            store.update(hit, { color })
          } else {
            store.update(hit, { color, fill: 'solid' })
          }
        })
      }
      return
    }

    if (tool === 'arrow') {
      const hit = topShapeAt(store, world)
      if (hit) {
        dragRef.current = { mode: 'connect', from: hit, current: world }
        return
      }
      onToolDone()
      return
    }

    if (tool !== 'select') {
      const snapped = { x: snapToGrid(world.x, store.cellSize), y: snapToGrid(world.y, store.cellSize) }
      const name = store.transact('create', () => beginShape(tool as ShapeKind, snapped))
      dragRef.current = { mode: 'create', name, origin: snapped }
      return
    }

    // --- select tool
    const hit = topShapeAt(store, world)
    if (hit) {
      const shape = store.get(hit)!
      const additive = e.shiftKey
      if (!store.selection.has(hit)) {
        if (!additive) store.selection.clear()
        store.selection.add(hit)
      } else if (additive) {
        store.selection.delete(hit)
      }
      // Selecting one member of a group selects the whole group.
      if (shape.groupId) {
        for (const s of store.all()) {
          if (s.groupId === shape.groupId) store.selection.add(s.name)
        }
      }
      dragRef.current = { mode: 'move', names: [...store.selection], last: world }
      store.emit('select')
      return
    }
    if (!e.shiftKey) store.selection.clear()
    dragRef.current = { mode: 'marquee', start: world, current: world }
    store.emit('select')
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const world = screenToWorld(e.clientX, e.clientY)
    onHoverCell(worldToCellRef(world.x, world.y, store.cellSize))
    const drag = dragRef.current

    switch (drag.mode) {
      case 'none':
        return
      case 'pan': {
        const dx = (e.clientX - drag.startScreen.x) / store.camera.zoom
        const dy = (e.clientY - drag.startScreen.y) / store.camera.zoom
        store.camera = { ...store.camera, x: drag.startCam.x - dx, y: drag.startCam.y - dy }
        store.emit('pan')
        return
      }
      case 'move': {
        const dx = world.x - drag.last.x
        const dy = world.y - drag.last.y
        for (const name of drag.names) translateShape(store, name, dx, dy)
        drag.last = world
        store.emit('move')
        return
      }
      case 'marquee': {
        drag.current = world
        const box = normalizeRect(drag.start, drag.current)
        store.selection = new Set(
          store.all()
            .filter((s) => {
              const r = shapeBounds(s, store.map())
              return r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h
            })
            .map((s) => s.name),
        )
        store.emit('marquee')
        return
      }
      case 'create': {
        const box = normalizeRect(drag.origin, world)
        store.update(drag.name, { x: box.x, y: box.y, w: box.w, h: box.h })
        store.emit('create')
        return
      }
      case 'ink': {
        const shape = store.get(drag.name) as InkShape | undefined
        if (!shape) return
        drag.points.push({ x: world.x, y: world.y, p: e.pressure || 0.5 })
        store.update(drag.name, { points: [...drag.points] } as Partial<InkShape>)
        store.emit('ink')
        return
      }
      case 'connect': {
        drag.current = world
        store.emit('connect-preview')
        return
      }
      default:
        return
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current
    const world = screenToWorld(e.clientX, e.clientY)
    dragRef.current = { mode: 'none' }

    if (drag.mode === 'create') {
      const shape = store.get(drag.name)
      if (shape && (shape.w < 8 || shape.h < 8)) {
        // A click rather than a drag: fall back to a sensible default size.
        const w = store.cellSize * (shape.kind === 'text' ? 4 : 3)
        const h = store.cellSize * (shape.kind === 'text' ? 1 : 2)
        store.update(drag.name, { w, h })
      } else if (shape) {
        store.update(drag.name, {
          x: snapToGrid(shape.x, store.cellSize),
          y: snapToGrid(shape.y, store.cellSize),
          w: Math.max(store.cellSize / 2, snapToGrid(shape.w, store.cellSize)),
          h: Math.max(store.cellSize / 2, snapToGrid(shape.h, store.cellSize)),
        })
      }
      store.selection = new Set([drag.name])
      onToolDone()
      const created = store.get(drag.name)
      if (created && (created.kind === 'text' || created.kind === 'note')) {
        setEditing({ name: drag.name, value: '' })
      }
      store.emit('create-done')
      return
    }

    if (drag.mode === 'ink') {
      const shape = store.get(drag.name) as InkShape | undefined
      if (shape) {
        if (shape.points.length < 2) store.remove(drag.name)
        else store.update(drag.name, { points: simplifyStroke(shape.points, 1.1) } as Partial<InkShape>)
      }
      store.emit('ink-done')
      return
    }

    if (drag.mode === 'connect') {
      const target = topShapeAt(store, world)
      if (target && target !== drag.from) {
        execute(store, [{ op: 'connect', from: drag.from, to: target, color }], { author: 'human' })
      }
      onToolDone()
      store.emit('connect-done')
      return
    }

    if (drag.mode === 'move' || drag.mode === 'marquee' || drag.mode === 'pan') {
      store.emit('drag-done')
    }
  }

  const onDoubleClick = (e: React.PointerEvent) => {
    const world = screenToWorld(e.clientX, e.clientY)
    const hit = topShapeAt(store, world)
    if (!hit) return
    const shape = store.get(hit)
    if (!shape || shape.kind === 'ink') return
    setEditing({ name: hit, value: shape.text })
  }

  // ------------------------------------------------------------------ wheel

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // -------------------------------------------------------------- shortcuts

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return
      if (e.key === ' ') spaceHeld = true

      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        store.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        store.selection = new Set(store.names())
        store.emit('select-all')
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selection.size > 0) {
        e.preventDefault()
        const names = [...store.selection]
        store.transact('delete', () => names.forEach((n) => store.remove(n)))
        return
      }
      // Arrow keys nudge; shift makes it a whole cell.
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      if (nudge[e.key] && store.selection.size > 0) {
        e.preventDefault()
        const step = e.shiftKey ? store.cellSize : 5
        const [dx, dy] = nudge[e.key]
        const names = [...store.selection]
        store.transact('nudge', () =>
          names.forEach((n) => translateShape(store, n, dx * step, dy * step)),
        )
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [store])

  // ------------------------------------------------------------ text editor

  const commitEdit = () => {
    if (!editing) return
    const { name, value } = editing
    setEditing(null)
    const shape = store.get(name)
    if (!shape) return
    if (!value.trim() && shape.kind === 'text') store.transact('edit-text', () => store.remove(name))
    else store.transact('edit-text', () => store.update(name, { text: value }))
  }

  const editorBox = editing ? store.bounds(editing.name) : null

  return (
    <div ref={wrapRef} className="wb-canvas-wrap">
      <canvas
        ref={canvasRef}
        className={`wb-canvas wb-tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick as unknown as React.MouseEventHandler}
        onPointerLeave={() => onHoverCell(null)}
      />
      {editing && editorBox && (
        <textarea
          className="wb-text-editor"
          autoFocus
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
              e.preventDefault()
              commitEdit()
            }
          }}
          style={{
            left: (editorBox.x - store.camera.x) * store.camera.zoom,
            top: (editorBox.y - store.camera.y) * store.camera.zoom,
            width: Math.max(80, editorBox.w * store.camera.zoom),
            height: Math.max(32, editorBox.h * store.camera.zoom),
          }}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ helpers

let spaceHeld = false

function topShapeAt(store: BoardStore, p: Point, fillHollow = false): string | null {
  const shapes = store.all()
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]
    const tol = isConnector(s) ? 8 : 4
    if (hitTest(s, p, store.map(), tol, fillHollow)) return s.name
  }
  return null
}

function normalizeRect(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}
