import React, { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Line, Rect, Circle, Text, Group, Transformer } from 'react-konva';
import Konva from 'konva';
import { useBoardStore } from '../../store/useBoardStore';
import { ShapeNode } from './ShapeNode';
import { ConnectorEdge } from './ConnectorEdge';
import { InkStroke } from './InkStroke';

// Fixed Slide Dimensions (16:9 aspect ratio finite presentation frame)
const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;

export const BoardCanvas: React.FC = () => {
  const {
    nodes,
    edges,
    ink,
    slides,
    activeSlideId,
    activeTool,
    inkColor,
    isPresenting,
    selectedIds,
    connectingFromId,
    stageScale,
    stagePos,
    setActiveTool,
    setSelectedIds,
    setConnectingFromId,
    setStageScale,
    setStagePos,
    addNode,
    updateNode,
    addEdge,
    addInk,
    deleteNode,
    deleteEdge,
    deleteInk,
    eraseAtPosition
  } = useBoardStore();

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<number[][]>([]);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  const activeSlideIndex = Math.max(0, slides.findIndex((s) => s.id === activeSlideId));
  const currentSlide = slides[activeSlideIndex] || slides[0];

  // Keep Konva Transformer handles attached to selected shape nodes
  useEffect(() => {
    if (transformerRef.current && stageRef.current) {
      const selectedKonvaNodes = selectedIds
        .map((id) => stageRef.current?.findOne('#' + id))
        .filter(Boolean) as Konva.Node[];

      transformerRef.current.nodes(selectedKonvaNodes);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selectedIds, nodes]);

  // Center the finite slide frame in viewport on init
  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    handleResize();

    // Center slide frame on screen
    const centerX = (window.innerWidth - SLIDE_WIDTH * stageScale) / 2;
    const centerY = (window.innerHeight - SLIDE_HEIGHT * stageScale) / 2;
    setStagePos({ x: Math.max(20, centerX), y: Math.max(90, centerY) });

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fit the whole slide to the viewport whenever presentation mode is entered or the
  // window resizes while presenting — a presented slide must never need manual panning.
  useEffect(() => {
    if (!isPresenting) return;
    const fit = () => {
      const scale = Math.min(window.innerWidth / SLIDE_WIDTH, window.innerHeight / SLIDE_HEIGHT);
      setStageScale(scale);
      setStagePos({
        x: (window.innerWidth - SLIDE_WIDTH * scale) / 2,
        y: (window.innerHeight - SLIDE_HEIGHT * scale) / 2
      });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [isPresenting, setStageScale, setStagePos]);

  // Keyboard Delete / Backspace listener for removing selected nodes/edges
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
        selectedIds.forEach((id) => {
          if (nodes[id]) deleteNode(id);
          if (edges[id]) deleteEdge(id);
          if (ink[id]) deleteInk(id);
        });
        setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds, nodes, edges, ink, deleteNode, deleteEdge, deleteInk, setSelectedIds]);

  // Stage Wheel Zoom handler
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.05;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.4, Math.min(newScale, 2.5));

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale
    };

    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale
    };

    setStageScale(clampedScale);
    setStagePos(newPos);
  };

  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  // Canvas Click / MouseDown Handler
  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (isPresenting || activeTool === 'hand') return;
    const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'slide-bg';
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const canvasX = (pointer.x - stagePos.x) / stageScale;
    const canvasY = (pointer.y - stagePos.y) / stageScale;

    if (activeTool === 'eraser') {
      setIsDrawing(true);
      eraseAtPosition(canvasX, canvasY, 25);
      return;
    }

    if (activeTool === 'pen' || activeTool === 'laser') {
      setIsDrawing(true);
      const pressure = (e.evt as unknown as PointerEvent).pressure || 0.5;
      setCurrentStroke([[canvasX, canvasY, pressure]]);
      return;
    }

    if (clickedOnEmpty) {
      setSelectedIds([]);
      setConnectingFromId(null);
      setEditingNodeId(null);

      // Node creation tools
      if (['box', 'cylinder', 'frame', 'text', 'circle', 'sticky', 'diamond', 'triangle', 'star', 'hexagon', 'cloud'].includes(activeTool)) {
        const isSticky = activeTool === 'sticky';
        const newId = addNode({
          type: activeTool as any,
          label: '', // Empty label by default for strict user precision
          x: Math.max(20, Math.min(canvasX - (isSticky ? 70 : 80), SLIDE_WIDTH - 180)),
          y: Math.max(20, Math.min(canvasY - (isSticky ? 70 : 35), SLIDE_HEIGHT - 90)),
          width: isSticky ? 140 : undefined,
          height: isSticky ? 140 : undefined
        });
        setActiveTool('select');
        setEditingNodeId(newId);
      }
    }
  };

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const canvasX = (pointer.x - stagePos.x) / stageScale;
    const canvasY = (pointer.y - stagePos.y) / stageScale;

    if (activeTool === 'eraser') {
      setEraserPos({ x: canvasX, y: canvasY });
      if (isDrawing) {
        eraseAtPosition(canvasX, canvasY, 25);
      }
      return;
    }

    if (!isDrawing || (activeTool !== 'pen' && activeTool !== 'laser')) return;

    const pressure = (e.evt as unknown as PointerEvent).pressure || 0.5;
    setCurrentStroke((prev) => [...prev, [canvasX, canvasY, pressure]]);
  };

  const handleStageMouseUp = () => {
    if (isDrawing && currentStroke.length > 1) {
      const isLaser = activeTool === 'laser';
      const strokeId = addInk({
        points: currentStroke,
        // Ink lands on the white paper slide — the old near-white default was invisible.
        color: isLaser ? '#e05c4a' : inkColor,
        strokeWidth: isLaser ? 6 : 5
      });
      if (isLaser) {
        setTimeout(() => {
          deleteInk(strokeId);
        }, 1500);
      }
    }
    setIsDrawing(false);
    setCurrentStroke([]);
  };

  const handleNodeSelect = (id: string, isShift: boolean) => {
    if (isPresenting || activeTool === 'hand') return;

    if (activeTool === 'connector') {
      if (!connectingFromId) {
        setConnectingFromId(id);
      } else if (connectingFromId !== id) {
        addEdge(connectingFromId, id);
        setActiveTool('select');
      }
      return;
    }

    if (isShift) {
      setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
    } else {
      setSelectedIds([id]);
    }
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        const imageFile = files.find((f) => f.type.startsWith('image/'));
        if (imageFile) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const dataUrl = evt.target?.result as string;
            if (dataUrl) {
              const rect = e.currentTarget.getBoundingClientRect();
              const dropX = (e.clientX - rect.left - stagePos.x) / stageScale;
              const dropY = (e.clientY - rect.top - stagePos.y) / stageScale;
              addNode({
                type: 'image',
                label: imageFile.name,
                imageUrl: dataUrl,
                x: Math.max(20, dropX - 120),
                y: Math.max(20, dropY - 90),
                width: 240,
                height: 180
              });
            }
          };
          reader.readAsDataURL(imageFile);
        }
      }}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#101314',
        backgroundImage: 'radial-gradient(rgba(233, 238, 240, 0.07) 1px, transparent 1px)',
        backgroundSize: '26px 26px',
        cursor: activeTool === 'hand' ? 'grab' : activeTool === 'eraser' ? 'none' : 'default'
      }}
    >
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        draggable={
          !isPresenting &&
          (activeTool === 'hand' || (activeTool === 'select' && selectedIds.length === 0 && !isDrawing))
        }
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            setStagePos({ x: e.target.x(), y: e.target.y() });
          }
        }}
      >
        <Layer>
          {/* Finite Slide Frame Boundary Container */}
          <Group name="slide-container">
            {/* Blueprint-White Paper Slide Background Card */}
            <Rect
              name="slide-bg"
              x={0}
              y={0}
              width={SLIDE_WIDTH}
              height={SLIDE_HEIGHT}
              fill="#f2f4f5"
              stroke="rgba(0, 0, 0, 0.15)"
              strokeWidth={1}
              cornerRadius={10}
              shadowColor="rgba(0, 0, 0, 0.6)"
              shadowBlur={40}
              shadowOffsetY={15}
            />

            {/* Slide Header Banner */}
            <Rect
              x={0}
              y={0}
              width={SLIDE_WIDTH}
              height={40}
              fill="#e4e9ea"
              stroke="rgba(20, 24, 26, 0.11)"
              strokeWidth={1}
              cornerRadius={[10, 10, 0, 0]}
            />
            <Text
              x={18}
              y={12}
              text={`SLIDE ${activeSlideIndex + 1} · ${currentSlide?.title || 'SYSTEM OVERVIEW'}`}
              fontSize={13}
              fontStyle="bold"
              fontFamily="'JetBrains Mono', monospace"
              fill="#14181a"
              letterSpacing={1.2}
            />
            <Text
              x={SLIDE_WIDTH - 150}
              y={13}
              text={`${SLIDE_WIDTH} × ${SLIDE_HEIGHT} · 16:9`}
              fontSize={12}
              fontFamily="'JetBrains Mono', monospace"
              fill="#5f6b6e"
            />

            {/* Render Connections / Edges */}
            {Object.values(edges).map((edge) => (
              <ConnectorEdge
                key={edge.id}
                edge={edge}
                fromNode={nodes[edge.from]}
                toNode={nodes[edge.to]}
                isSelected={selectedIds.includes(edge.id)}
                onSelect={(id) => setSelectedIds([id])}
              />
            ))}

            {/* Render Shape Nodes */}
            {Object.values(nodes).map((node) => (
              <ShapeNode
                key={node.id}
                node={node}
                isSelected={selectedIds.includes(node.id) || connectingFromId === node.id}
                onSelect={handleNodeSelect}
                onChange={updateNode}
                onStartEdit={(id) => setEditingNodeId(id)}
              />
            ))}

            {/* Render Permanent Ink Strokes */}
            {Object.values(ink).map((stroke) => (
              <InkStroke
                key={stroke.id}
                stroke={stroke}
                isSelected={selectedIds.includes(stroke.id)}
                onSelect={(id) => setSelectedIds([id])}
              />
            ))}

            {/* Active Ink Drawing Preview */}
            {isDrawing && currentStroke.length > 0 && (
              <InkStroke
                stroke={{
                  id: 'preview',
                  points: currentStroke,
                  color: activeTool === 'laser' ? '#e05c4a' : inkColor,
                  strokeWidth: activeTool === 'laser' ? 6 : 5
                }}
              />
            )}

            {/* Konva Transformer Handles for Resizing Selected Shapes */}
            <Transformer
              ref={transformerRef}
              borderStroke="#818cf8"
              borderStrokeWidth={2}
              anchorFill="#818cf8"
              anchorStroke="#ffffff"
              anchorSize={9}
              anchorCornerRadius={2}
              rotateEnabled={false}
              boundBoxFunc={(oldBox, newBox) => (newBox.width < 40 || newBox.height < 30 ? oldBox : newBox)}
            />
          </Group>

          {/* Eraser Cursor Circle Overlay */}
          {activeTool === 'eraser' && eraserPos && (
            <Circle
              x={eraserPos.x}
              y={eraserPos.y}
              radius={25}
              fill="rgba(239, 68, 68, 0.25)"
              stroke="#ef4444"
              strokeWidth={1}
              dash={[4, 4]}
            />
          )}
        </Layer>
      </Stage>

      {/* Inline Physical Keyboard Canvas Textarea Overlay */}
      {editingNodeId && nodes[editingNodeId] && (
        <textarea
          autoFocus
          value={nodes[editingNodeId].label}
          onChange={(e) => updateNode(editingNodeId, { label: e.target.value })}
          onBlur={() => setEditingNodeId(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              setEditingNodeId(null);
            }
          }}
          style={{
            position: 'absolute',
            left: `${nodes[editingNodeId].x * stageScale + stagePos.x + 8 * stageScale}px`,
            top: `${nodes[editingNodeId].y * stageScale + stagePos.y + (nodes[editingNodeId].type === 'frame' ? 6 : 8) * stageScale}px`,
            width: `${Math.max(120, (nodes[editingNodeId].width - 16) * stageScale)}px`,
            height: `${Math.max(40, (nodes[editingNodeId].height - 16) * stageScale)}px`,
            zIndex: 80,
            background: 'var(--s-app-3)',
            color: 'var(--s-ink)',
            border: '2px solid var(--s-accent)',
            borderRadius: 'var(--s-radius-sm)',
            padding: '4px 8px',
            fontSize: `${Math.max(12, (nodes[editingNodeId].fontSize || 14) * stageScale)}px`,
            fontFamily: nodes[editingNodeId].fontFamily || 'var(--s-font-ui)',
            textAlign: nodes[editingNodeId].textAlign || 'center',
            outline: 'none',
            resize: 'none',
            boxShadow: '0 4px 20px var(--s-accent-soft)'
          }}
        />
      )}
    </div>
  );
};
