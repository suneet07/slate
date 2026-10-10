import React, { useState } from 'react';
import { Keyboard, Delete, CornerDownLeft, X, Space, ArrowBigUp } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';

interface VirtualKeyboardProps {
  targetId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_LABELS = [
  'API Gateway',
  'Load Balancer',
  'PostgreSQL',
  'Redis Cache',
  'Auth Service',
  'Worker Queue',
  'Client App',
  'S3 Storage',
  'Microservice',
  'GraphQL API'
];

const KEYBOARD_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '-', '_', '.']
];

export const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({ targetId, isOpen, onClose }) => {
  const { nodes, updateNode } = useBoardStore();
  const targetNode = targetId ? nodes[targetId] : null;

  const [inputText, setInputText] = useState(targetNode ? targetNode.label : '');
  const [isShifted, setIsShifted] = useState(true);
  const [isShiftLocked, setIsShiftLocked] = useState(false);

  // Keep input text synced when the target node changes.
  // Depends on the node id only — depending on the node object re-ran this on every
  // keystroke and clobbered what was being typed.
  React.useEffect(() => {
    const node = targetId ? useBoardStore.getState().nodes[targetId] : null;
    setInputText(node ? node.label : '');
  }, [targetId]);

  if (!isOpen) return null;

  // The keyboard writes into a node label, so it needs a selected node. Saying so beats
  // the old behaviour of rendering nothing when the toolbar button was pressed.
  if (!targetNode) {
    return (
      <div
        className="glass-panel"
        style={{
          position: 'fixed',
          bottom: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 90,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: 'var(--s-ink)'
        }}
      >
        <Keyboard size={17} color="var(--s-accent)" />
        <span style={{ fontSize: '13.5px' }}>Select a shape first — the on-screen keyboard types into its label.</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--s-ink-3)', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>
    );
  }

  const handleKeyPress = (char: string) => {
    const updated = inputText + (isShifted ? char.toUpperCase() : char.toLowerCase());
    setInputText(updated);
    updateNode(targetNode.id, { label: updated });
    if (isShifted && !isShiftLocked) setIsShifted(false);
  };

  const handleBackspace = () => {
    const updated = inputText.slice(0, -1);
    setInputText(updated);
    updateNode(targetNode.id, { label: updated });
  };

  const handleClear = () => {
    setInputText('');
    updateNode(targetNode.id, { label: '' });
  };

  const handlePresetClick = (preset: string) => {
    setInputText(preset);
    updateNode(targetNode.id, { label: preset });
  };

  return (
    <div
      className="glass-panel"
      style={{
        position: 'fixed',
        bottom: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        width: '620px',
        padding: '20px',
        color: 'var(--s-ink)',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Keyboard size={18} color="var(--s-accent)" />
          <span style={{ fontSize: '14px', fontWeight: 600 }}>On-Screen Virtual Keyboard</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--s-ink-3)', cursor: 'pointer' }}>
          <X size={18} />
        </button>
      </div>

      {/* Target Node Label Preview */}
      <div
        style={{
          background: 'var(--s-app-3)',
          padding: '10px 14px',
          borderRadius: '8px',
          border: '1px solid var(--s-accent-line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span className="mono-font" style={{ fontSize: '15px', color: 'var(--s-accent)', fontWeight: 600 }}>
          {inputText || <em style={{ color: 'var(--s-ink-3)' }}>Click keys below to set label...</em>}
        </span>
        <button
          onClick={handleClear}
          style={{ fontSize: '11px', color: 'var(--s-danger)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Clear All
        </button>
      </div>

      {/* Quick Presets Chips */}
      <div>
        <span style={{ fontSize: '11px', color: 'var(--s-ink-2)', display: 'block', marginBottom: '6px' }}>
          One-Click Quick Presets:
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {PRESET_LABELS.map((preset) => (
            <button
              key={preset}
              onClick={() => handlePresetClick(preset)}
              style={{
                padding: '4px 10px',
                borderRadius: '12px',
                border: '1px solid var(--s-line)',
                background: 'var(--s-app-3)',
                color: 'var(--s-ink-2)',
                fontSize: '12px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* QWERTY Keys Container */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {KEYBOARD_ROWS.map((row, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
            {/* Shift lives on the letter row so the reach matches a real keyboard */}
            {idx === 3 && (
              <button
                onClick={() => {
                  if (isShiftLocked) {
                    setIsShiftLocked(false);
                    setIsShifted(false);
                  } else if (isShifted) {
                    setIsShiftLocked(true);
                  } else {
                    setIsShifted(true);
                  }
                }}
                title={isShiftLocked ? 'Caps lock on — click to turn off' : 'Shift (click twice for caps lock)'}
                style={{
                  width: '58px',
                  height: '42px',
                  borderRadius: '6px',
                  border: '1px solid var(--s-line)',
                  background: isShiftLocked ? 'var(--s-accent)' : isShifted ? 'var(--s-accent-soft)' : 'var(--s-app-3)',
                  color: isShiftLocked ? 'var(--s-accent-ink)' : 'var(--s-ink)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ArrowBigUp size={18} />
              </button>
            )}

            {row.map((char) => (
              <button
                key={char}
                onClick={() => handleKeyPress(char)}
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '6px',
                  border: '1px solid var(--s-line)',
                  background: 'var(--s-app-3)',
                  color: 'var(--s-ink)',
                  fontFamily: 'var(--s-font-mono)',
                  fontSize: '15px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                  transition: 'background 0.1s ease'
                }}
              >
                {/^[a-z]$/i.test(char) && !isShifted ? char.toLowerCase() : char}
              </button>
            ))}
          </div>
        ))}

        {/* Space, Backspace & Done controls row */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '4px' }}>
          <button
            onClick={() => handleKeyPress(' ')}
            style={{
              flex: 1,
              height: '42px',
              borderRadius: '6px',
              border: '1px solid var(--s-line)',
              background: 'var(--s-app-3)',
              color: 'var(--s-ink)',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Space size={16} />
            <span>Space</span>
          </button>

          <button
            onClick={handleBackspace}
            style={{
              width: '80px',
              height: '42px',
              borderRadius: '6px',
              border: '1px solid var(--s-danger)',
              background: 'rgba(224, 92, 74, 0.18)',
              color: 'var(--s-danger)',
              fontSize: '13px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}
          >
            <Delete size={16} />
            <span>Back</span>
          </button>

          <button
            onClick={onClose}
            style={{
              width: '90px',
              height: '42px',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--s-accent)',
              color: 'var(--s-accent-ink)',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}
          >
            <CornerDownLeft size={16} />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  );
};
