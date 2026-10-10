import React, { useState, useRef, useEffect } from 'react';
import {
  MousePointer,
  Hand,
  Square,
  Database,
  Frame,
  Type,
  ArrowRight,
  PenTool,
  Eraser,
  RotateCcw,
  RotateCw,
  Trash2,
  Settings,
  Code,
  MessageSquare,
  Circle,
  BookOpen,
  StickyNote,
  ScanText,
  Diamond,
  Triangle,
  Star,
  Hexagon,
  Cloud,
  Highlighter,
  ImagePlus,
  Shapes,
  ChevronDown
} from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';
import { ActiveTool } from '../../lib/graph/types';
import { VoiceButton } from './VoiceButton';
import { SettingsModal } from './SettingsModal';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import { DocumentUploadModal } from './DocumentUploadModal';
import { serializeSceneGraph } from '../../lib/graph/serializer';
import { processClusteredInkOcr } from '../../lib/ocr/trocrClient';
import { readInkLocally } from '../../lib/ocr/localInkReader';

/** Shapes the canvas renderer and the AI diff format both support, kept out of the main row */
const EXTRA_SHAPES: { tool: ActiveTool; title: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { tool: 'diamond', title: 'Diamond (decision)', Icon: Diamond },
  { tool: 'triangle', title: 'Triangle', Icon: Triangle },
  { tool: 'star', title: 'Star', Icon: Star },
  { tool: 'hexagon', title: 'Hexagon', Icon: Hexagon },
  { tool: 'cloud', title: 'Cloud', Icon: Cloud }
];

/** Ink colours for the pen, chosen to read against the white paper slide */
const INK_COLORS = [
  { value: '#14181a', label: 'Paper ink' },
  { value: '#2fbfd4', label: 'Cyan' },
  { value: '#57b894', label: 'Data green' },
  { value: '#e05c4a', label: 'Danger red' }
];

export const TopNav: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    selectedIds,
    clearBoard,
    undo,
    redo,
    getSceneGraph,
    isChatOpen,
    toggleChat,
    ink,
    trocrUrl,
    uploadedDocs,
    setAiStatus,
    addChatMessage,
    inkColor,
    setInkColor,
    addNode
  } = useBoardStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGraphModalOpen, setIsGraphModalOpen] = useState(false);
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [isShapesOpen, setIsShapesOpen] = useState(false);
  const shapesRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Close the extra-shapes popover on any outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (shapesRef.current && !shapesRef.current.contains(e.target as Node)) setIsShapesOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      if (!dataUrl) return;
      addNode({ type: 'image', label: file.name, imageUrl: dataUrl, x: 220, y: 160, width: 320, height: 220 });
    };
    reader.readAsDataURL(file);
  };

  const handleRunOcr = async () => {
    const inkStrokes = Object.values(ink);
    if (inkStrokes.length === 0) {
      alert('No handwritten ink strokes found on canvas. Use the Ink Pen (🖊️) to draw handwriting first!');
      return;
    }

    // No TrOCR server: read locally rather than refusing. TrOCR stays the upgrade path.
    if (!trocrUrl) {
      const lines = readInkLocally(inkStrokes.map((s) => ({ id: s.id, points: s.points })));
      if (lines.length === 0) {
        setAiStatus(false, 'No writing found — strokes look like a drawing, or joined-up writing the local reader cannot split.');
        return;
      }
      lines.forEach((line, idx) => {
        addChatMessage({
          sender: 'ai',
          text: `🖊️ Handwriting #${idx + 1} (read locally${line.uncertain ? ', uncertain' : ''}): "${line.text}"`
        });
      });
      setAiStatus(false, `Read ${lines.length} line(s) of handwriting locally.`);
      return;
    }

    setAiStatus(true, 'Clustering spatial strokes and querying TrOCR GPU...');
    try {
      const clusterResults = await processClusteredInkOcr(
        inkStrokes.map((s) => ({ id: s.id, points: s.points })),
        trocrUrl
      );

      for (let idx = 0; idx < clusterResults.length; idx++) {
        const res = clusterResults[idx];
        if (res.text) {
          addChatMessage({
            sender: 'ai',
            text: `🖊️ TrOCR Recognized Handwriting (Cluster #${idx + 1}): "${res.text}"`,
            imageCropUrl: res.imageCropDataUrl
          });
        }
      }

      setAiStatus(false, `Sent ${clusterResults.length} recognized handwriting outputs to Chat Feed!`);
    } catch (err: any) {
      console.error('TrOCR error:', err);
      setAiStatus(false, `OCR Failed: ${err.message}`);
      alert(`TrOCR OCR failed: ${err.message}`);
    }
  };

  /* ─── Tool icon button helper ─── */
  const ToolBtn: React.FC<{ tool: ActiveTool; title: string; children: React.ReactNode }> = ({ tool, title, children }) => {
    const isActive = activeTool === tool;
    return (
      <button
        onClick={() => setActiveTool(tool)}
        title={title}
        style={{
          width: 'var(--s-tap)',
          height: 'var(--s-tap)',
          borderRadius: '8px',
          border: 'none',
          background: isActive ? 'var(--s-accent)' : 'transparent',
          color: isActive ? 'var(--s-accent-ink)' : 'var(--s-ink-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'background 0.12s, color 0.12s'
        }}
      >
        {children}
      </button>
    );
  };

  /* ─── Small icon-only util button ─── */
  const UtilBtn: React.FC<{
    onClick: () => void; title: string; color?: string;
    bg?: string; border?: string; size?: number; children: React.ReactNode
  }> = ({ onClick, title, color = 'var(--s-ink-2)', bg = 'var(--s-app-3)', border = 'var(--s-line)', size, children }) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: size || 'var(--s-tap)',
        height: 'var(--s-tap)',
        borderRadius: '9px',
        border: `1px solid ${border}`,
        background: bg,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  );

  const serializedGraph = serializeSceneGraph(getSceneGraph());

  return (
    <>
      {/* ─── Header: height 68px, app-2 bg, line border-bottom ─── */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '68px',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '14px',
          padding: '0 16px',
          background: 'var(--s-app-2)',
          borderBottom: '1px solid var(--s-line)'
        }}
      >
        {/* ─── Brand: S badge + Slate ─── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', flexShrink: 0 }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '9px',
              background: 'var(--s-accent)',
              color: 'var(--s-accent-ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--s-font-display)',
              fontSize: '21px',
              fontWeight: 700,
              lineHeight: 1
            }}
          >
            S
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            <div style={{ fontFamily: 'var(--s-font-display)', fontSize: '20px', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1, color: 'var(--s-ink)' }}>
              Slate
            </div>
            <div style={{ fontSize: '10.5px', letterSpacing: '0.09em', textTransform: 'uppercase' as const, color: 'var(--s-ink-3)' }}>
              Structured AI whiteboard
            </div>
          </div>
        </div>

        {/* ─── Center palette: icon-only tool buttons ─── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'var(--s-app-3)', padding: '4px', borderRadius: '12px', border: '1px solid var(--s-line-2)' }}>
          <ToolBtn tool="select" title="Select (V)"><MousePointer size={19} /></ToolBtn>
          <ToolBtn tool="hand" title="Pan the board (H)"><Hand size={19} /></ToolBtn>
          {/* Divider */}
          <div style={{ width: '1px', height: '22px', background: 'var(--s-line)', margin: '0 4px' }} />
          <ToolBtn tool="box" title="Box"><Square size={19} /></ToolBtn>
          <ToolBtn tool="circle" title="Circle"><Circle size={19} /></ToolBtn>
          <ToolBtn tool="cylinder" title="Cylinder (DB)"><Database size={19} /></ToolBtn>
          <ToolBtn tool="frame" title="Frame container"><Frame size={19} /></ToolBtn>

          {/* Extra shapes the renderer and the AI diff format already support */}
          <div ref={shapesRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setIsShapesOpen(!isShapesOpen)}
              title="More shapes"
              style={{
                width: 'var(--s-tap)',
                height: 'var(--s-tap)',
                borderRadius: '8px',
                border: 'none',
                background: EXTRA_SHAPES.some((s) => s.tool === activeTool) ? 'var(--s-accent)' : 'transparent',
                color: EXTRA_SHAPES.some((s) => s.tool === activeTool) ? 'var(--s-accent-ink)' : 'var(--s-ink-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
            >
              <Shapes size={19} />
            </button>

            {isShapesOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '46px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 100,
                  display: 'flex',
                  gap: '2px',
                  padding: '5px',
                  borderRadius: '11px',
                  background: 'var(--s-app-2)',
                  border: '1px solid var(--s-line)',
                  boxShadow: '0 14px 34px -12px rgba(0,0,0,0.6)'
                }}
              >
                {EXTRA_SHAPES.map(({ tool, title, Icon }) => (
                  <button
                    key={tool}
                    onClick={() => {
                      setActiveTool(tool);
                      setIsShapesOpen(false);
                    }}
                    title={title}
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '7px',
                      border: 'none',
                      background: activeTool === tool ? 'var(--s-accent)' : 'transparent',
                      color: activeTool === tool ? 'var(--s-accent-ink)' : 'var(--s-ink-2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer'
                    }}
                  >
                    <Icon size={17} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <ToolBtn tool="connector" title="Connector edge"><ArrowRight size={19} /></ToolBtn>
          {/* Divider */}
          <div style={{ width: '1px', height: '22px', background: 'var(--s-line)', margin: '0 4px' }} />
          <ToolBtn tool="text" title="Text label"><Type size={19} /></ToolBtn>
          <ToolBtn tool="sticky" title="Sticky note"><StickyNote size={19} /></ToolBtn>

          {/* Place an image straight onto the slide (drag-and-drop also works) */}
          <button
            onClick={() => imageInputRef.current?.click()}
            title="Place an image on the slide"
            style={{
              width: 'var(--s-tap)',
              height: 'var(--s-tap)',
              borderRadius: '8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--s-ink-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <ImagePlus size={19} />
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            onChange={handleImagePick}
            style={{ display: 'none' }}
          />
        </div>

        {/* ─── Right action bar ─── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {/* Notes upload */}
          <button
            onClick={() => setIsNotesModalOpen(true)}
            title="Upload lecture notes for retrieval"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              height: 'var(--s-tap)',
              padding: '0 13px',
              borderRadius: '9px',
              border: '1px solid var(--s-ai-line)',
              background: 'var(--s-ai-soft)',
              color: 'var(--s-ink)',
              fontSize: 'var(--s-fs-sm)',
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer'
            }}
          >
            <BookOpen size={16} color="var(--s-ai)" />
            <span>Notes {uploadedDocs.length}</span>
          </button>

          {/* Model selector */}
          <ModelSelectorDropdown />

          {/* TrOCR scan button */}
          <button
            onClick={handleRunOcr}
            title="Read handwriting (local, or TrOCR if configured)"
            style={{
              width: 'var(--s-tap)',
              height: 'var(--s-tap)',
              borderRadius: '9px',
              border: '1px solid var(--s-line)',
              background: 'var(--s-app-3)',
              color: 'var(--s-ink-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative'
            }}
          >
            <ScanText size={18} />
            {Object.keys(ink).length > 0 && (
              <span style={{
                position: 'absolute', top: '5px', right: '5px',
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--s-data)'
              }} />
            )}
          </button>

          {/* Push-to-talk Speak */}
          <VoiceButton />

          {/* Chat feed toggle */}
          <button
            onClick={toggleChat}
            title="Toggle chat feed"
            style={{
              width: 'var(--s-tap)',
              height: 'var(--s-tap)',
              borderRadius: '9px',
              border: '1px solid var(--s-ai-line)',
              background: 'var(--s-ai-soft)',
              color: 'var(--s-ai)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <MessageSquare size={18} />
          </button>

          {/* Divider */}
          <div style={{ width: '1px', height: '26px', background: 'var(--s-line)' }} />

          {/* Undo */}
          <button
            onClick={undo}
            title="Undo"
            style={{ width: '34px', height: 'var(--s-tap)', border: 'none', background: 'none', color: 'var(--s-ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <RotateCcw size={17} />
          </button>

          {/* Redo */}
          <button
            onClick={redo}
            title="Redo"
            style={{ width: '34px', height: 'var(--s-tap)', border: 'none', background: 'none', color: 'var(--s-ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <RotateCw size={17} />
          </button>

          {/* Clear canvas */}
          <button
            onClick={clearBoard}
            title="Clear canvas"
            style={{ width: '34px', height: 'var(--s-tap)', border: 'none', background: 'none', color: 'var(--s-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <Trash2 size={17} />
          </button>

          {/* Inspect scene graph */}
          <UtilBtn onClick={() => setIsGraphModalOpen(true)} title="Inspect scene graph">
            <Code size={17} />
          </UtilBtn>

          {/* Settings */}
          <UtilBtn onClick={() => setIsSettingsOpen(true)} title="Settings & API keys">
            <Settings size={18} />
          </UtilBtn>
        </div>
      </header>

      {/* ─── Left sidebar: ink tools ─── */}
      <div style={{
        position: 'absolute',
        top: '84px',
        left: '14px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
        padding: '7px 5px',
        borderRadius: '14px',
        background: 'var(--s-app-2)',
        border: '1px solid var(--s-line)',
        zIndex: 44
      }}>
        <ToolBtn tool="pen" title="Ink pen (P)"><PenTool size={18} /></ToolBtn>
        <ToolBtn tool="laser" title="Laser pointer — strokes fade after 1.5s"><Highlighter size={18} /></ToolBtn>
        <ToolBtn tool="eraser" title="Eraser (E)"><Eraser size={18} /></ToolBtn>
        {/* Divider */}
        <div style={{ width: '22px', height: '1px', background: 'var(--s-line)', margin: '5px 0' }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
          <span style={{ fontFamily: 'var(--s-font-mono)', fontSize: '9.5px', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--s-ink-3)' }}>ink</span>
          {INK_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => {
                setInkColor(c.value);
                setActiveTool('pen');
              }}
              title={`Ink colour: ${c.label}`}
              style={{
                width: '20px',
                height: '20px',
                padding: 0,
                borderRadius: '50%',
                background: c.value,
                border: inkColor === c.value ? '2px solid var(--s-ink)' : '1px solid var(--s-line)',
                boxShadow: inkColor === c.value ? '0 0 0 2px var(--s-accent-soft)' : 'none',
                cursor: 'pointer'
              }}
            />
          ))}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Teacher Notes Vectorless RAG Document Upload Modal */}
      <DocumentUploadModal isOpen={isNotesModalOpen} onClose={() => setIsNotesModalOpen(false)} />

      {/* Scene Graph Raw Inspector Modal */}
      {isGraphModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(6px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div
            style={{
              width: '540px',
              maxHeight: '80vh',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              background: 'var(--s-app-2)',
              border: '1px solid var(--s-line)',
              borderRadius: '14px',
              boxShadow: '0 30px 60px rgba(0,0,0,0.6)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Code size={18} color="var(--s-accent)" />
                <span>Serialized Scene Graph Format</span>
              </h3>
              <button
                onClick={() => setIsGraphModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--s-ink-3)', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--s-ink-2)' }}>
              This flat, line-per-entity text representation is sent to the LLM instead of raw pixels, reducing token consumption by ~80%.
            </p>
            <pre
              className="mono-font"
              style={{
                background: 'var(--s-app)',
                padding: '16px',
                borderRadius: '8px',
                border: '1px solid var(--s-line)',
                fontSize: '13px',
                color: 'var(--s-data)',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap'
              }}
            >
              {serializedGraph}
            </pre>
          </div>
        </div>
      )}
    </>
  );
};
