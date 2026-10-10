import React, { useEffect, useState } from 'react';
import { TopNav } from './components/toolbar/TopNav';
import { BoardCanvas } from './components/canvas/BoardCanvas';
import { NodeActionBar } from './components/toolbar/NodeActionBar';
import { VirtualKeyboard } from './components/keyboard/VirtualKeyboard';
import { ChatSidebar } from './components/chat/ChatSidebar';
import { SlideNavigator } from './components/slides/SlideNavigator';
import { useBoardStore } from './store/useBoardStore';
import { ZoomIn, ZoomOut, Maximize2, Keyboard } from 'lucide-react';

export const App: React.FC = () => {
  const { stageScale, setStageScale, setStagePos, selectedIds, isChatOpen, isPresenting } = useBoardStore();
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  // Notes uploaded in an earlier session come back with their indexes, so the LLM tree is
  // built once per document rather than once per page load.
  useEffect(() => {
    void useBoardStore.getState().hydrateDocuments();
  }, []);

  const handleZoomIn = () => setStageScale(Math.min(2.5, stageScale * 1.15));
  const handleZoomOut = () => setStageScale(Math.max(0.4, stageScale / 1.15));
  const handleResetZoom = () => {
    setStageScale(1.0);
    const centerX = (window.innerWidth - 1280) / 2;
    const centerY = (window.innerHeight - 720) / 2;
    setStagePos({ x: Math.max(20, centerX), y: Math.max(90, centerY) });
  };

  const selectedNodeId = selectedIds.length > 0 ? selectedIds[0] : null;

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Authoring chrome — hidden while presenting so the audience sees only the slide */}
      {!isPresenting && (
        <>
          {/* Top Header Toolbar */}
          <TopNav />

          {/* AI Voice & Text Chat Sidebar */}
          <ChatSidebar />

          {/* Floating Node Action Bar */}
          <NodeActionBar onOpenKeyboard={() => setIsKeyboardOpen(true)} />

          {/* On-Screen Virtual Keyboard */}
          <VirtualKeyboard
            targetId={selectedNodeId}
            isOpen={isKeyboardOpen}
            onClose={() => setIsKeyboardOpen(false)}
          />
        </>
      )}

      {/* Slide Deck Presentation Navigator (Bottom Center) */}
      <SlideNavigator />

      {/* Primary Konva Canvas Layer (Finite Slide Viewport) */}
      <BoardCanvas />

      {/* Floating Bottom Right Controls (Zoom) */}
      <div
        style={{
          display: isPresenting ? 'none' : 'flex',
          position: 'absolute',
          bottom: '18px',
          right: isChatOpen ? '396px' : '20px',
          zIndex: 40,
          alignItems: 'center',
          gap: '6px',
          padding: '5px 9px',
          borderRadius: '11px',
          background: 'var(--s-app-2)',
          border: '1px solid var(--s-line)',
          color: 'var(--s-ink-2)'
        }}
      >
        <button
          onClick={() => setIsKeyboardOpen(!isKeyboardOpen)}
          title="Toggle On-Screen Virtual Keyboard"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            height: '30px',
            padding: '0 10px',
            borderRadius: '7px',
            border: isKeyboardOpen ? '1px solid var(--s-accent-line)' : '1px solid var(--s-line)',
            background: isKeyboardOpen ? 'var(--s-accent-soft)' : 'var(--s-app-3)',
            color: 'var(--s-ink)',
            fontFamily: 'inherit',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <Keyboard size={14} />
          <span>Keyboard</span>
        </button>

        <div style={{ width: '1px', height: '18px', background: 'var(--s-line)' }} />

        <button
          onClick={handleZoomOut}
          title="Zoom out"
          style={{ width: '28px', height: '30px', border: 'none', background: 'none', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <ZoomOut size={16} />
        </button>
        <span className="mono-font" style={{ fontFamily: 'var(--s-font-mono)', fontSize: '12px', minWidth: '44px', textAlign: 'center' as const, color: 'var(--s-ink)' }}>
          {Math.round(stageScale * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          title="Zoom in"
          style={{ width: '28px', height: '30px', border: 'none', background: 'none', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={handleResetZoom}
          title="Fit slide"
          style={{ width: '28px', height: '30px', border: 'none', background: 'none', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
};
export default App;
