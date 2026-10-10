import React, { useState, useRef, useEffect } from 'react';
import { Group, Rect, Path, Text, Tag, Label, Circle, Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import { BoardNode, NodeColor } from '../../lib/graph/types';
import { useBoardStore } from '../../store/useBoardStore';

interface ShapeNodeProps {
  node: BoardNode;
  isSelected: boolean;
  onSelect: (id: string, isShift: boolean) => void;
  onChange: (id: string, patch: Partial<BoardNode>) => void;
  onStartConnect?: (id: string) => void;
  onStartEdit?: (id: string) => void;
}

const COLOR_MAP: Record<NodeColor, { fill: string; stroke: string; text: string }> = {
  default: { fill: '#e4e9ea', stroke: '#5f6b6e', text: '#14181a' },
  primary: { fill: 'rgba(47, 191, 212, 0.18)', stroke: '#2fbfd4', text: '#14181a' },
  success: { fill: 'rgba(87, 184, 148, 0.18)', stroke: '#57b894', text: '#14181a' },
  warning: { fill: 'rgba(224, 161, 55, 0.18)', stroke: '#e0a137', text: '#14181a' },
  error: { fill: 'rgba(224, 92, 74, 0.18)', stroke: '#e05c4a', text: '#14181a' }
};

const KonvaImageNode: React.FC<{ url: string; width: number; height: number; stroke: string; isSelected: boolean }> = ({ url, width, height, stroke, isSelected }) => {
  const [imageObj, setImageObj] = useState<HTMLImageElement | undefined>();

  useEffect(() => {
    if (!url) return;
    const img = new window.Image();
    img.src = url;
    img.onload = () => setImageObj(img);
  }, [url]);

  if (!imageObj) {
    return (
      <Rect
        width={width}
        height={height}
        fill="#1e2230"
        stroke={isSelected ? '#818cf8' : stroke}
        strokeWidth={2}
        cornerRadius={8}
      />
    );
  }

  return (
    <Group>
      <KonvaImage
        image={imageObj}
        width={width}
        height={height}
        cornerRadius={8}
      />
      <Rect
        width={width}
        height={height}
        stroke={isSelected ? '#818cf8' : stroke}
        strokeWidth={isSelected ? 3 : 2}
        cornerRadius={8}
      />
    </Group>
  );
};

export const ShapeNode: React.FC<ShapeNodeProps> = ({
  node,
  isSelected,
  onSelect,
  onChange,
  onStartEdit
}) => {
  const isPresenting = useBoardStore((s) => s.isPresenting);
  const activeTool = useBoardStore((s) => s.activeTool);
  const shapeRef = useRef<Konva.Group>(null);

  // While presenting, and while an ink/pan tool owns the pointer, shapes are scenery:
  // dragging or selecting them mid-lecture was moving the diagram out from under the teacher.
  const isLocked = isPresenting || ['hand', 'pen', 'laser', 'eraser'].includes(activeTool);

  const presetColors = COLOR_MAP[node.color as NodeColor] || COLOR_MAP.default;
  const fillColor = node.fillColor || presetColors.fill;
  const strokeColor = isSelected ? '#2fbfd4' : (node.strokeColor || presetColors.stroke);
  const strokeWidth = isSelected ? (node.strokeWidth ? node.strokeWidth + 1 : 3) : (node.strokeWidth || 2);
  const dash = node.strokeStyle === 'dashed' ? [6, 4] : (node.strokeStyle === 'dotted' ? [2, 4] : undefined);
  const fontSize = node.fontSize || 14;
  const fontFamily = node.fontFamily || 'Inter, sans-serif';
  const textAlign = node.textAlign || 'center';

  return (
    <Group
      id={node.id}
      name="shape-node"
      x={node.x}
      y={node.y}
      draggable={!isLocked}
      listening={!isLocked}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(node.id, e.evt.shiftKey);
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect(node.id, e.evt.shiftKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(node.id, e.evt.shiftKey);
      }}
      onDragEnd={(e) => {
        onChange(node.id, { x: e.target.x(), y: e.target.y() });
      }}
      onTransformEnd={() => {
        const nodeGroup = shapeRef.current;
        if (nodeGroup) {
          const scaleX = nodeGroup.scaleX();
          const scaleY = nodeGroup.scaleY();
          nodeGroup.scaleX(1);
          nodeGroup.scaleY(1);
          const newW = Math.max(40, Math.round(node.width * scaleX));
          const newH = Math.max(30, Math.round(node.height * scaleY));
          onChange(node.id, {
            x: nodeGroup.x(),
            y: nodeGroup.y(),
            width: newW,
            height: newH
          });
        }
      }}
      onDblClick={(e) => {
        e.cancelBubble = true;
        if (onStartEdit) onStartEdit(node.id);
      }}
      ref={shapeRef}
    >
      {/* Box Node */}
      {node.type === 'box' && (
        <Rect
          width={node.width}
          height={node.height}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash}
          cornerRadius={8}
          shadowColor="rgba(0, 0, 0, 0.4)"
          shadowBlur={10}
          shadowOffsetY={4}
        />
      )}

      {/* Frame Node */}
      {node.type === 'frame' && (
        <>
          <Rect
            width={node.width}
            height={node.height}
            fill={node.fillColor || "rgba(30, 34, 48, 0.25)"}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            dash={dash || [6, 4]}
            cornerRadius={8}
          />
          {/* Header Tab */}
          <Rect
            x={0}
            y={0}
            width={Math.min(node.width, 140)}
            height={28}
            fill="#374151"
            cornerRadius={[8, 0, 8, 0]}
          />
        </>
      )}

      {/* Cylinder Database Node */}
      {node.type === 'cylinder' && (
        <Group>
          <Rect
            x={0}
            y={12}
            width={node.width}
            height={node.height - 24}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            dash={dash}
          />
          <Path
            data={`M 0 ${node.height - 12} A ${node.width / 2} 12 0 0 0 ${node.width} ${node.height - 12}`}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill={fillColor}
            dash={dash}
          />
          <Path
            data={`M 0 12 A ${node.width / 2} 12 0 1 1 ${node.width} 12 A ${node.width / 2} 12 0 1 1 0 12`}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            dash={dash}
          />
        </Group>
      )}

      {/* Text Only Node */}
      {node.type === 'text' && (
        <Rect
          width={node.width}
          height={node.height}
          fill={node.fillColor || "transparent"}
          stroke={isSelected ? '#818cf8' : (node.strokeColor || 'transparent')}
          strokeWidth={1}
          dash={dash || [4, 4]}
        />
      )}

      {/* Circle Node */}
      {node.type === 'circle' && (
        <Circle
          x={node.width / 2}
          y={node.height / 2}
          radius={Math.min(node.width, node.height) / 2}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash}
          shadowColor="rgba(0, 0, 0, 0.4)"
          shadowBlur={10}
          shadowOffsetY={4}
        />
      )}

      {/* Sticky Note Node */}
      {node.type === 'sticky' && (
        <Group>
          <Rect
            width={node.width}
            height={node.height}
            fill={node.fillColor || "#fef08a"}
            stroke={isSelected ? '#818cf8' : (node.strokeColor || '#facc15')}
            strokeWidth={strokeWidth}
            dash={dash}
            shadowColor="rgba(0, 0, 0, 0.2)"
            shadowBlur={8}
            shadowOffsetX={2}
            shadowOffsetY={6}
          />
          <Path
            data={`M ${node.width - 16} ${node.height} L ${node.width} ${node.height - 16} L ${node.width} ${node.height} Z`}
            fill="#fde047"
          />
        </Group>
      )}

      {/* Diamond Node */}
      {node.type === 'diamond' && (
        <Path
          data={`M ${node.width / 2} 0 L ${node.width} ${node.height / 2} L ${node.width / 2} ${node.height} L 0 ${node.height / 2} Z`}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash}
          shadowColor="rgba(0, 0, 0, 0.4)"
          shadowBlur={10}
        />
      )}

      {/* Triangle Node */}
      {node.type === 'triangle' && (
        <Path
          data={`M ${node.width / 2} 0 L ${node.width} ${node.height} L 0 ${node.height} Z`}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash}
          shadowColor="rgba(0, 0, 0, 0.4)"
          shadowBlur={10}
        />
      )}

      {/* Hexagon Node */}
      {node.type === 'hexagon' && (
        <Path
          data={`M ${node.width * 0.25} 0 L ${node.width * 0.75} 0 L ${node.width} ${node.height * 0.5} L ${node.width * 0.75} ${node.height} L ${node.width * 0.25} ${node.height} L 0 ${node.height * 0.5} Z`}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash}
          shadowColor="rgba(0, 0, 0, 0.4)"
          shadowBlur={10}
        />
      )}

      {/* Star Node */}
      {node.type === 'star' && (
        <Path
          data={`M ${node.width * 0.5} 0 L ${node.width * 0.63} ${node.height * 0.38} L ${node.width} ${node.height * 0.38} L ${node.width * 0.7} ${node.height * 0.62} L ${node.width * 0.82} ${node.height} L ${node.width * 0.5} ${node.height * 0.76} L ${node.width * 0.18} ${node.height} L ${node.width * 0.3} ${node.height * 0.62} L 0 ${node.height * 0.38} L ${node.width * 0.37} ${node.height * 0.38} Z`}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash}
          shadowColor="rgba(0, 0, 0, 0.4)"
          shadowBlur={10}
        />
      )}

      {/* Cloud Node */}
      {node.type === 'cloud' && (
        <Path
          data={`M ${node.width * 0.2} ${node.height * 0.7} C ${node.width * 0.05} ${node.height * 0.7} 0 ${node.height * 0.5} ${node.width * 0.15} ${node.height * 0.35} C ${node.width * 0.15} ${node.height * 0.15} ${node.width * 0.4} 0 ${node.width * 0.6} ${node.height * 0.2} C ${node.width * 0.75} ${node.height * 0.1} ${node.width} ${node.height * 0.25} ${node.width * 0.95} ${node.height * 0.45} C ${node.width * 1.05} ${node.height * 0.65} ${node.width * 0.85} ${node.height * 0.85} ${node.width * 0.7} ${node.height * 0.8} C ${node.width * 0.55} ${node.height} ${node.width * 0.35} ${node.height} ${node.width * 0.2} ${node.height * 0.7} Z`}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          dash={dash}
          shadowColor="rgba(0, 0, 0, 0.4)"
          shadowBlur={10}
        />
      )}

      {/* Image Node */}
      {node.type === 'image' && (
        <KonvaImageNode
          url={node.imageUrl || ''}
          width={node.width}
          height={node.height}
          stroke={strokeColor}
          isSelected={isSelected}
        />
      )}

      {/* Node Text Label */}
      {node.type !== 'image' && (
        <Text
          x={10}
          y={node.type === 'frame' ? 6 : 10}
          width={node.width - 20}
          height={node.height - 20}
          text={node.label || (node.type === 'text' || node.type === 'sticky' ? 'Type text...' : '...')}
          fontSize={fontSize}
          fontFamily={fontFamily}
          fontStyle="500"
          fill={node.type === 'sticky' && !node.fillColor ? '#1f2937' : (node.type === 'text' && !node.label ? '#6b7280' : presetColors.text)}
          align={textAlign}
          verticalAlign="middle"
          wrap="word"
        />
      )}

      {/* Sleek top title tag for Image Nodes */}
      {node.type === 'image' && node.label && (
        <Label x={6} y={6}>
          <Tag fill="rgba(15, 17, 23, 0.85)" stroke="#6366f1" strokeWidth={1} cornerRadius={4} />
          <Text
            text={node.label.length > 45 ? `${node.label.slice(0, 42)}...` : node.label}
            fontSize={11}
            fontFamily="Inter, sans-serif"
            fontStyle="600"
            fill="#e0e7ff"
            padding={4}
          />
        </Label>
      )}

      {/* Grid position badge in corner — authoring aid, hidden from the audience */}
      {!isPresenting && (
        <Label x={node.width - 32} y={4}>
          <Tag fill="rgba(0, 0, 0, 0.4)" cornerRadius={4} />
          <Text
            text={node.gridPos}
            fontSize={10}
            fontFamily="JetBrains Mono, monospace"
            fill="#9ca3af"
            padding={3}
          />
        </Label>
      )}

      {/* Confidence Badge if low confidence (<1.0) */}
      {node.confidence !== undefined && node.confidence < 1.0 && (
        <Label x={4} y={node.height - 18}>
          <Tag fill="rgba(245, 158, 11, 0.85)" cornerRadius={3} />
          <Text
            text={`?${Math.round(node.confidence * 100)}%`}
            fontSize={9}
            fontFamily="Inter, sans-serif"
            fill="#ffffff"
            padding={2}
          />
        </Label>
      )}
    </Group>
  );
};
