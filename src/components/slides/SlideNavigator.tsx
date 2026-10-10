import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Layers, Pencil, Check, Play, X, Trash2 } from 'lucide-react';
import { useBoardStore } from '../../store/useBoardStore';

export const SlideNavigator: React.FC = () => {
  const {
    slides,
    activeSlideId,
    addSlide,
    deleteSlide,
    switchSlide,
    nextSlide,
    prevSlide,
    renameSlide,
    isPresenting,
    setPresenting
  } = useBoardStore();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleVal, setEditingTitleVal] = useState('');
  const [showThumbnails, setShowThumbnails] = useState(false);

  const activeIndex = slides.findIndex((s) => s.id === activeSlideId);
  const currentSlide = slides[activeIndex] || slides[0];

  // Presentation keyboard control: arrows/space advance, Escape leaves.
  useEffect(() => {
    if (!isPresenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresenting(false);
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') nextSlide();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prevSlide();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPresenting, setPresenting, nextSlide, prevSlide]);

  const handleStartPresenting = () => {
    setShowThumbnails(false);
    setIsEditingTitle(false);
    setPresenting(true);
    document.documentElement.requestFullscreen?.().catch(() => {
      /* fullscreen is a nicety; presentation mode still works without it */
    });
  };

  const handleStopPresenting = () => {
    setPresenting(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };

  // ─── Presenting: minimal auto-hiding control strip, no authoring chrome ───
  if (isPresenting) {
    return (
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '6px 12px',
          borderRadius: '12px',
          background: 'rgba(23, 27, 29, 0.85)',
          border: '1px solid var(--s-line)',
          opacity: 0.45,
          transition: 'opacity 0.15s'
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.45')}
      >
        <button
          onClick={prevSlide}
          disabled={activeIndex <= 0}
          title="Previous slide (←)"
          style={{ width: '30px', height: '32px', border: 'none', background: 'none', color: activeIndex > 0 ? 'var(--s-ink)' : 'var(--s-ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <ChevronLeft size={20} />
        </button>
        <span style={{ fontFamily: 'var(--s-font-mono)', fontSize: '12px', color: 'var(--s-ink-2)' }}>
          {activeIndex + 1} / {slides.length}
        </span>
        <button
          onClick={nextSlide}
          disabled={activeIndex >= slides.length - 1}
          title="Next slide (→)"
          style={{ width: '30px', height: '32px', border: 'none', background: 'none', color: activeIndex < slides.length - 1 ? 'var(--s-ink)' : 'var(--s-ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <ChevronRight size={20} />
        </button>
        <div style={{ width: '1px', height: '18px', background: 'var(--s-line)' }} />
        <button
          onClick={handleStopPresenting}
          title="Exit presentation (Esc)"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '32px', padding: '0 11px', borderRadius: '8px', border: '1px solid var(--s-line)', background: 'var(--s-app-3)', color: 'var(--s-ink)', fontFamily: 'inherit', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
        >
          <X size={14} />
          <span>Exit</span>
        </button>
      </div>
    );
  }

  const handleStartRename = () => {
    setEditingTitleVal(currentSlide.title);
    setIsEditingTitle(true);
  };

  const handleSaveRename = () => {
    if (editingTitleVal.trim()) {
      renameSlide(currentSlide.id, editingTitleVal.trim());
    }
    setIsEditingTitle(false);
  };

  return (
    <>
      {/* ─── Bottom Center Slide Control Bar ─── */}
      <div
        style={{
          position: 'absolute',
          bottom: '18px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '7px 14px',
          borderRadius: '14px',
          background: 'var(--s-app-2)',
          border: '1px solid var(--s-line)',
          boxShadow: '0 16px 34px -14px rgba(0,0,0,0.6)'
        }}
      >
        {/* Deck toggle */}
        <button
          onClick={() => setShowThumbnails(!showThumbnails)}
          title="Toggle Slide Deck Thumbnails"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            height: '34px',
            padding: '0 12px',
            borderRadius: '9px',
            border: '1px solid var(--s-accent-line)',
            background: 'var(--s-accent-soft)',
            color: 'var(--s-ink)',
            fontFamily: 'inherit',
            fontSize: 'var(--s-fs-sm)',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <Layers size={15} />
          <span>Deck {slides.length}</span>
        </button>

        {/* Divider */}
        <div style={{ width: '1px', height: '20px', background: 'var(--s-line)' }} />

        {/* Previous slide */}
        <button
          onClick={prevSlide}
          disabled={activeIndex <= 0}
          title="Previous Slide"
          style={{
            width: '30px',
            height: '34px',
            border: 'none',
            background: 'none',
            color: activeIndex > 0 ? 'var(--s-ink)' : 'var(--s-ink-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: activeIndex > 0 ? 'pointer' : 'default'
          }}
        >
          <ChevronLeft size={20} />
        </button>

        {/* Current slide title + edit + counter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          {isEditingTitle ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="text"
                value={editingTitleVal}
                onChange={(e) => setEditingTitleVal(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveRename()}
                autoFocus
                style={{
                  background: 'var(--s-app-3)',
                  color: 'var(--s-ink)',
                  border: '1px solid var(--s-accent-line)',
                  borderRadius: '6px',
                  padding: '2px 8px',
                  fontSize: '14px',
                  fontFamily: 'var(--s-font-display)',
                  outline: 'none'
                }}
              />
              <button
                onClick={handleSaveRename}
                style={{
                  height: '28px',
                  padding: '0 8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'var(--s-accent)',
                  color: 'var(--s-accent-ink)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <Check size={14} />
              </button>
            </div>
          ) : (
            <>
              <span
                style={{
                  fontFamily: 'var(--s-font-display)',
                  fontSize: '17px',
                  fontWeight: 600,
                  color: 'var(--s-ink)',
                  cursor: 'pointer'
                }}
                onClick={handleStartRename}
                title="Click to rename slide"
              >
                {currentSlide.title}
              </span>
              <Pencil
                size={13}
                color="var(--s-ink-3)"
                style={{ cursor: 'pointer' }}
                onClick={handleStartRename}
              />
            </>
          )}

          <span
            style={{
              fontFamily: 'var(--s-font-mono)',
              fontSize: '12px',
              color: 'var(--s-ink-2)',
              background: 'var(--s-app-3)',
              padding: '3px 9px',
              borderRadius: '10px'
            }}
          >
            {activeIndex + 1} / {slides.length}
          </span>
        </div>

        {/* Next slide */}
        <button
          onClick={nextSlide}
          disabled={activeIndex >= slides.length - 1}
          title="Next Slide"
          style={{
            width: '30px',
            height: '34px',
            border: 'none',
            background: 'none',
            color: activeIndex < slides.length - 1 ? 'var(--s-ink)' : 'var(--s-ink-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: activeIndex < slides.length - 1 ? 'pointer' : 'default'
          }}
        >
          <ChevronRight size={20} />
        </button>

        {/* Divider */}
        <div style={{ width: '1px', height: '20px', background: 'var(--s-line)' }} />

        {/* New slide */}
        <button
          onClick={addSlide}
          title="Add New Slide"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            height: '34px',
            padding: '0 13px',
            borderRadius: '9px',
            border: 'none',
            background: 'var(--s-accent)',
            color: 'var(--s-accent-ink)',
            fontFamily: 'inherit',
            fontSize: 'var(--s-fs-sm)',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <Plus size={15} />
          <span>New slide</span>
        </button>

        {/* Present button */}
        <button
          onClick={handleStartPresenting}
          title="Present slideshow (Esc to exit)"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            height: '34px',
            padding: '0 13px',
            borderRadius: '9px',
            border: '1px solid var(--s-line)',
            background: 'var(--s-app-3)',
            color: 'var(--s-ink)',
            fontFamily: 'inherit',
            fontSize: 'var(--s-fs-sm)',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <Play size={15} />
          <span>Present</span>
        </button>
      </div>

      {/* ─── Slide Thumbnails Drawer ─── */}
      {showThumbnails && (
        <div
          style={{
            position: 'absolute',
            bottom: '76px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 49,
            display: 'flex',
            gap: '12px',
            padding: '12px 16px',
            maxWidth: '90vw',
            overflowX: 'auto',
            borderRadius: '14px',
            background: 'var(--s-app-2)',
            border: '1px solid var(--s-line)',
            boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.5)'
          }}
        >
          {slides.map((slide, idx) => {
            const isActive = slide.id === activeSlideId;
            const nodeCount = Object.keys(slide.nodes).length;
            const inkCount = Object.keys(slide.ink).length;

            return (
              <div
                key={slide.id}
                onClick={() => switchSlide(slide.id)}
                style={{
                  width: '140px',
                  height: '84px',
                  borderRadius: '8px',
                  border: isActive ? '2px solid var(--s-accent)' : '1px solid var(--s-line)',
                  background: isActive ? 'var(--s-accent-soft)' : 'var(--s-app-3)',
                  padding: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  boxShadow: isActive ? '0 0 15px var(--s-accent-soft)' : 'none',
                  flexShrink: 0,
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '4px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: isActive ? 'var(--s-accent)' : 'var(--s-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {idx + 1}. {slide.title}
                  </div>
                  {slides.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSlide(slide.id);
                      }}
                      title="Delete this slide"
                      style={{ flexShrink: 0, border: 'none', background: 'none', color: 'var(--s-danger)', padding: 0, cursor: 'pointer', display: 'flex' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--s-ink-2)', marginTop: 'auto' }}>
                  {nodeCount} shape{nodeCount === 1 ? '' : 's'} · {inkCount} ink
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
