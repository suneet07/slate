import type { ColorName } from '../engine/types'
import { COLOR_NAMES, PALETTE } from '../engine/palette'
import type { Tool } from './Whiteboard'

interface Props {
  tool: Tool
  onTool: (t: Tool) => void
  color: ColorName
  onColor: (c: ColorName) => void
  showGrid: boolean
  onShowGrid: (v: boolean) => void
  showLabels: boolean
  onShowLabels: (v: boolean) => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onFit: () => void
}

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: '⬚', hint: 'Select / move' },
  { id: 'pen', label: '✎', hint: 'Pen (stylus)' },
  { id: 'fill', label: '🪣', hint: 'Fill shape' },
  { id: 'eraser', label: '⌫', hint: 'Eraser' },
  { id: 'rect', label: '▭', hint: 'Rectangle' },
  { id: 'ellipse', label: '◯', hint: 'Ellipse' },
  { id: 'diamond', label: '◇', hint: 'Diamond' },
  { id: 'triangle', label: '△', hint: 'Triangle' },
  { id: 'star', label: '☆', hint: 'Star' },
  { id: 'note', label: '▤', hint: 'Sticky note' },
  { id: 'text', label: 'T', hint: 'Text' },
  { id: 'arrow', label: '↗', hint: 'Arrow — drag shape to shape' },
]

export function Toolbar({
  tool,
  onTool,
  color,
  onColor,
  showGrid,
  onShowGrid,
  showLabels,
  onShowLabels,
  onUndo,
  onRedo,
  onClear,
  onFit,
}: Props) {
  return (
    <div className="wb-toolbar">
      <div className="wb-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.hint}
            className={`wb-btn ${tool === t.id ? 'is-active' : ''}`}
            onClick={() => onTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="wb-divider" />

      <div className="wb-group">
        {COLOR_NAMES.filter((c) => c !== 'white').map((c: ColorName) => (
          <button
            key={c}
            title={c}
            className={`wb-swatch ${color === c ? 'is-active' : ''}`}
            style={{ background: PALETTE[c].solid }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>

      <div className="wb-divider" />

      <div className="wb-group">
        <button className="wb-btn" title="Undo (Ctrl+Z)" onClick={onUndo}>↶</button>
        <button className="wb-btn" title="Redo (Ctrl+Shift+Z)" onClick={onRedo}>↷</button>
        <button className="wb-btn" title="Fit board to view" onClick={onFit}>⤢</button>
        <button
          className={`wb-btn ${showGrid ? 'is-active' : ''}`}
          title="Show grid + cell references"
          onClick={() => onShowGrid(!showGrid)}
        >
          #
        </button>
        <button
          className={`wb-btn ${showLabels ? 'is-active' : ''}`}
          title="Show shape names (what the AI sees)"
          onClick={() => onShowLabels(!showLabels)}
        >
          🏷
        </button>
        <button className="wb-btn wb-danger" title="Clear board" onClick={onClear}>🗑</button>
      </div>
    </div>
  )
}
