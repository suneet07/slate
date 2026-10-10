import { useState } from 'react'
import { SPEC_DOCS } from '../ai/spec'

/**
 * Shows the exact instructions the model is given, split the same way the
 * backend concatenates them. Useful while teaching, and the first place to look
 * when the AI misunderstands something.
 */
export function SpecModal({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(SPEC_DOCS[0].id)
  const doc = SPEC_DOCS.find((d) => d.id === active) ?? SPEC_DOCS[0]

  return (
    <div className="wb-modal-backdrop" onClick={onClose}>
      <div className="wb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wb-modal-head">
          <strong>What the AI is told</strong>
          <button className="wb-btn" onClick={onClose}>✕</button>
        </div>
        <div className="wb-modal-tabs">
          {SPEC_DOCS.map((d) => (
            <button
              key={d.id}
              className={`wb-tab ${d.id === active ? 'is-active' : ''}`}
              onClick={() => setActive(d.id)}
            >
              {d.title}
            </button>
          ))}
        </div>
        <pre className="wb-modal-body">{doc.body}</pre>
      </div>
    </div>
  )
}
