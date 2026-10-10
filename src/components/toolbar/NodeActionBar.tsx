import React, { useState } from 'react';
import { Mic, MicOff, Keyboard, Trash2, Indent, Outdent, AlignLeft, AlignCenter, AlignRight, Type, PaintBucket, PenTool } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { NodeColor } from '../../lib/graph/types';

interface NodeActionBarProps {
  onOpenKeyboard: () => void;
}

const COLOR_OPTIONS: { id: NodeColor; bg: string; label: string }[] = [
  { id: 'default', bg: '#5f6b6e', label: 'Paper Ink' },
  { id: 'primary', bg: '#2fbfd4', label: 'Cyan' },
  { id: 'success', bg: '#57b894', label: 'Data Green' },
  { id: 'warning', bg: '#e0a137', label: 'Warm' },
  { id: 'error', bg: '#e05c4a', label: 'Danger' }
];

export const NodeActionBar: React.FC<NodeActionBarProps> = ({ onOpenKeyboard }) => {
  const { selectedIds, nodes, updateNode, deleteNode, indentNode, outdentNode, setAiStatus, isPresenting } =
    useBoardStore();

  const [isDictating, setIsDictating] = useState(false);

  if (isPresenting || selectedIds.length === 0) return null;

  const targetId = selectedIds[0];
  const targetNode = nodes[targetId];
  if (!targetNode) return null;

  // Single Click Voice Dictation for Node Label
  const startVoiceDictation = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setIsDictating(true);
    setAiStatus(true, 'Dictating node label... Speak the title now.');

    recognition.onresult = (event: any) => {
      const speechResult = event.results[0][0].transcript;
      if (speechResult) {
        updateNode(targetId, { label: speechResult });
        setAiStatus(false, `Renamed to "${speechResult}"!`);
      }
      setIsDictating(false);
    };

    recognition.onerror = (err: any) => {
      console.error('Speech recognition error:', err);
      setAiStatus(false, 'Speech recognition failed.');
      setIsDictating(false);
    };

    recognition.onend = () => {
      setIsDictating(false);
    };

    recognition.start();
  };

  return (
    <div
      style={{
        // Sits below the 68px header. At top:18px it was drawn underneath the header
        // (z-index 45 vs 50), so selecting a node appeared to do nothing.
        position: 'absolute',
        top: '80px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 46,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        justifyContent: 'center',
        maxWidth: 'calc(100vw - 120px)',
        gap: '9px',
        padding: '7px 12px',
        borderRadius: '12px',
        background: 'var(--s-app-2)',
        border: '1px solid var(--s-line)',
        boxShadow: '0 14px 34px -12px rgba(0,0,0,0.6)'
      }}
    >
      {/* Physical Keyboard Text Input Field */}
      <input
        type="text"
        value={targetNode.label}
        onChange={(e) => updateNode(targetId, { label: e.target.value })}
        placeholder="Type label with keyboard..."
        style={{
          height: '34px',
          padding: '0 11px',
          borderRadius: '8px',
          border: '1px solid var(--s-accent-line)',
          background: 'var(--s-app-3)',
          color: 'var(--s-ink)',
          fontFamily: 'inherit',
          fontSize: 'var(--s-fs)',
          width: '168px',
          outline: 'none'
        }}
      />

      {/* Voice Dictate Button */}
      <button
        onClick={startVoiceDictation}
        title="Dictate label by voice"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '34px',
          padding: '0 12px',
          borderRadius: '8px',
          border: 'none',
          background: isDictating ? 'var(--s-danger)' : 'var(--s-accent)',
          color: isDictating ? '#fff' : 'var(--s-accent-ink)',
          fontFamily: 'inherit',
          fontSize: 'var(--s-fs-sm)',
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        {isDictating ? <MicOff size={15} /> : <Mic size={15} />}
        <span>{isDictating ? 'Listening...' : 'Dictate'}</span>
      </button>

      {/* On-Screen Visual Keyboard Button */}
      <button
        onClick={onOpenKeyboard}
        title="Open On-Screen Virtual Keyboard"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '34px',
          padding: '0 12px',
          borderRadius: '8px',
          border: '1px solid var(--s-line)',
          background: 'var(--s-app-3)',
          color: 'var(--s-ink)',
          fontFamily: 'inherit',
          fontSize: 'var(--s-fs-sm)',
          fontWeight: 500,
          cursor: 'pointer'
        }}
      >
        <Keyboard size={15} />
        <span>Keyboard</span>
      </button>

      <div style={{ width: '1px', height: '22px', background: 'var(--s-line)' }} />

      {/* Font Size Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="Font Size">
        <Type size={13} color="var(--s-ink-2)" />
        <select
          value={targetNode.fontSize || 14}
          onChange={(e) => updateNode(targetId, { fontSize: Number(e.target.value) })}
          style={{
            background: 'var(--s-app-3)',
            color: 'var(--s-ink)',
            border: '1px solid var(--s-line)',
            borderRadius: '6px',
            fontSize: '12px',
            padding: '2px 4px',
            outline: 'none',
            cursor: 'pointer'
          }}
        >
          <option value={12}>12px</option>
          <option value={14}>14px</option>
          <option value={16}>16px</option>
          <option value={18}>18px</option>
          <option value={20}>20px</option>
          <option value={24}>24px</option>
          <option value={32}>32px</option>
          <option value={48}>48px</option>
        </select>
      </div>

      {/* Font Family Selector */}
      <select
        value={targetNode.fontFamily || 'Inter, sans-serif'}
        onChange={(e) => updateNode(targetId, { fontFamily: e.target.value })}
        title="Font Family"
        style={{
          background: '#0f1117',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '6px',
          fontSize: '12px',
          padding: '2px 4px',
          outline: 'none',
          cursor: 'pointer'
        }}
      >
        <option value="Inter, sans-serif">Sans (Inter)</option>
        <option value="serif">Serif</option>
        <option value="monospace">Monospace</option>
        <option value="cursive">Handwriting</option>
      </select>

      {/* Text Alignment */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'var(--s-app-3)', borderRadius: '6px', padding: '2px' }}>
        <button
          onClick={() => updateNode(targetId, { textAlign: 'left' })}
          title="Align Left"
          style={{
            background: (targetNode.textAlign || 'center') === 'left' ? 'var(--s-accent)' : 'transparent',
            border: 'none',
            color: (targetNode.textAlign || 'center') === 'left' ? 'var(--s-accent-ink)' : 'var(--s-ink)',
            borderRadius: '4px',
            padding: '3px',
            cursor: 'pointer'
          }}
        >
          <AlignLeft size={13} />
        </button>
        <button
          onClick={() => updateNode(targetId, { textAlign: 'center' })}
          title="Align Center"
          style={{
            background: (targetNode.textAlign || 'center') === 'center' ? 'var(--s-accent)' : 'transparent',
            border: 'none',
            color: (targetNode.textAlign || 'center') === 'center' ? 'var(--s-accent-ink)' : 'var(--s-ink)',
            borderRadius: '4px',
            padding: '3px',
            cursor: 'pointer'
          }}
        >
          <AlignCenter size={13} />
        </button>
        <button
          onClick={() => updateNode(targetId, { textAlign: 'right' })}
          title="Align Right"
          style={{
            background: (targetNode.textAlign || 'center') === 'right' ? 'var(--s-accent)' : 'transparent',
            border: 'none',
            color: (targetNode.textAlign || 'center') === 'right' ? 'var(--s-accent-ink)' : 'var(--s-ink)',
            borderRadius: '4px',
            padding: '3px',
            cursor: 'pointer'
          }}
        >
          <AlignRight size={13} />
        </button>
      </div>

      <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.15)' }} />

      {/* Custom Fill Color Picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="Fill Color">
        <PaintBucket size={13} color="var(--s-ink-2)" />
        <input
          type="color"
          value={targetNode.fillColor || '#1e2230'}
          onChange={(e) => updateNode(targetId, { fillColor: e.target.value })}
          style={{
            width: '22px',
            height: '22px',
            padding: 0,
            border: 'none',
            borderRadius: '4px',
            background: 'none',
            cursor: 'pointer'
          }}
        />
      </div>

      {/* Custom Stroke Color Picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="Stroke Color">
        <PenTool size={13} color="var(--s-ink-2)" />
        <input
          type="color"
          value={targetNode.strokeColor || '#374151'}
          onChange={(e) => updateNode(targetId, { strokeColor: e.target.value })}
          style={{
            width: '22px',
            height: '22px',
            padding: 0,
            border: 'none',
            borderRadius: '4px',
            background: 'none',
            cursor: 'pointer'
          }}
        />
      </div>

      {/* Stroke Width */}
      <select
        value={targetNode.strokeWidth || 2}
        onChange={(e) => updateNode(targetId, { strokeWidth: Number(e.target.value) })}
        title="Stroke Width"
        style={{
          background: '#0f1117',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '6px',
          fontSize: '12px',
          padding: '2px 4px',
          outline: 'none',
          cursor: 'pointer'
        }}
      >
        <option value={1}>1px</option>
        <option value={2}>2px</option>
        <option value={4}>4px</option>
        <option value={6}>6px</option>
      </select>

      {/* Stroke Style */}
      <select
        value={targetNode.strokeStyle || 'solid'}
        onChange={(e) => updateNode(targetId, { strokeStyle: e.target.value as any })}
        title="Stroke Style"
        style={{
          background: '#0f1117',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '6px',
          fontSize: '12px',
          padding: '2px 4px',
          outline: 'none',
          cursor: 'pointer'
        }}
      >
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </select>

      <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.15)' }} />

      {/* Preset Color Tokens Picker */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        {COLOR_OPTIONS.map((col) => (
          <button
            key={col.id}
            onClick={() => updateNode(targetId, { color: col.id, fillColor: undefined, strokeColor: undefined })}
            title={`Reset to preset theme: ${col.label}`}
            style={{
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              background: col.bg,
              border: targetNode.color === col.id ? '2px solid var(--s-ink)' : 'none',
              cursor: 'pointer'
            }}
          />
        ))}
      </div>

      <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.15)' }} />

      {/* Outline indent / outdent — outdent also detaches the node from its frame */}
      <div style={{ display: 'flex', gap: '2px' }}>
        <button
          onClick={() => outdentNode(targetId)}
          title="Outdent (move left, leave frame)"
          style={{ width: '28px', height: '30px', border: 'none', background: 'none', color: 'var(--s-ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <Outdent size={15} />
        </button>
        <button
          onClick={() => indentNode(targetId)}
          title="Indent (move right, join enclosing frame)"
          style={{ width: '28px', height: '30px', border: 'none', background: 'none', color: 'var(--s-ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <Indent size={15} />
        </button>
      </div>

      <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.15)' }} />

      {/* Delete Button */}
      <button
        onClick={() => deleteNode(targetId)}
        title="Delete Node"
        style={{ width: '32px', height: '34px', border: 'none', background: 'none', color: 'var(--s-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
};
