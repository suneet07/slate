import { useEffect, useState } from 'react'
import { Whiteboard, type Tool } from './components/Whiteboard'
import { execute, type Command } from './ai/commands'
import { digestBoard } from './ai/serialize'
import { Toolbar } from './components/Toolbar'
import { AiPanel } from './components/AiPanel'
import { SpecModal } from './components/SpecModal'
import { useBoard } from './hooks/useBoard'
import type { ColorName } from './engine/types'
import './index.css'

export default function App() {
  const { store, version } = useBoard()
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState<ColorName>('blue')
  const [showGrid, setShowGrid] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [hoverCell, setHoverCell] = useState<string | null>(null)
  const [showSpec, setShowSpec] = useState(false)

  // Dev console handle: drive the board with the exact command language the
  // model uses — `board.run([{op:'add',shape:'rect',at:'C3'}])`, `board.digest()`.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>).board = {
      store,
      run: (commands: Command[]) => execute(store, commands, { author: 'ai' }),
      digest: () => digestBoard(store),
    }
  }, [store])

  const fitToView = () => {
    const pad = 40
    const vw = window.innerWidth - 380
    const vh = window.innerHeight - 60
    const w = store.cols * store.cellSize
    const h = store.rows * store.cellSize
    const zoom = Math.min(vw / (w + pad * 2), vh / (h + pad * 2))
    const cx = (w - vw / zoom) / 2
    const cy = (h - vh / zoom) / 2
    store.camera = { x: cx, y: cy, zoom: Math.max(0.1, zoom) }
    store.emit('fit')
  }

  useEffect(() => {
    fitToView()
    window.addEventListener('resize', fitToView)
    return () => window.removeEventListener('resize', fitToView)
  }, [store])

  return (
    <div className="wb-app">
      <header className="wb-header">
        <div className="wb-brand">
          <span className="wb-logo">◧</span> AI Whiteboard
        </div>
        <Toolbar
          tool={tool}
          onTool={setTool}
          color={color}
          onColor={setColor}
          showGrid={showGrid}
          onShowGrid={setShowGrid}
          showLabels={showLabels}
          onShowLabels={setShowLabels}
          onUndo={() => store.undo()}
          onRedo={() => store.redo()}
          onFit={fitToView}
          onClear={() => {
            if (confirm('Clear the whole board?')) store.transact('clear', () => store.clear())
          }}
        />
        <div className="wb-cell-readout">{hoverCell ?? '—'}</div>
      </header>

      <main className="wb-main">
        <Whiteboard
          store={store}
          version={version}
          tool={tool}
          color={color}
          showGrid={showGrid}
          showLabels={showLabels}
          onToolDone={() => setTool('select')}
          onHoverCell={setHoverCell}
        />
        <AiPanel store={store} version={version} onShowSpec={() => setShowSpec(true)} />
      </main>

      {showSpec && <SpecModal onClose={() => setShowSpec(false)} />}
    </div>
  )
}
