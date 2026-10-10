import React from 'react';
import { Arrow, Text, Group, Label, Tag } from 'react-konva';
import { BoardEdge, BoardNode } from '../../lib/graph/types';

interface ConnectorEdgeProps {
  edge: BoardEdge;
  fromNode?: BoardNode;
  toNode?: BoardNode;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

export const ConnectorEdge: React.FC<ConnectorEdgeProps> = ({
  edge,
  fromNode,
  toNode,
  isSelected,
  onSelect
}) => {
  if (!fromNode || !toNode) return null;

  // Calculate center coordinates
  const fromCenter = {
    x: fromNode.x + fromNode.width / 2,
    y: fromNode.y + fromNode.height / 2
  };
  const toCenter = {
    x: toNode.x + toNode.width / 2,
    y: toNode.y + toNode.height / 2
  };

  // Compute border intersection points
  const start = getIntersectionPoint(fromCenter, toCenter, fromNode);
  const end = getIntersectionPoint(toCenter, fromCenter, toNode);

  // Label position (midpoint of the route)
  const routePoints = getRoutingPoints(start, end);
  const midPointIdx = Math.floor(routePoints.length / 4) * 2;
  const midX = routePoints[midPointIdx];
  const midY = routePoints[midPointIdx + 1];

  return (
    <Group onClick={() => onSelect(edge.id)}>
      <Arrow
        points={routePoints}
        stroke={isSelected ? '#2fbfd4' : '#5f6b6e'}
        fill={isSelected ? '#2fbfd4' : '#5f6b6e'}
        strokeWidth={isSelected ? 3 : 2}
        pointerLength={8}
        pointerWidth={8}
        dash={edge.style === 'dashed' ? [6, 4] : undefined}
        tension={0.2}
        lineJoin="round"
      />
      {edge.label && (
        <Label x={midX - 30} y={midY - 12}>
          <Tag fill="#1f2937" stroke="#374151" strokeWidth={1} cornerRadius={4} />
          <Text
            text={edge.label}
            fontSize={11}
            fontFamily="Inter, sans-serif"
            fill="#d1d5db"
            padding={4}
          />
        </Label>
      )}
    </Group>
  );
};

// Calculate perimeter intersection for clean arrow attachment
function getIntersectionPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  node: BoardNode
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const halfW = node.width / 2;
  const halfH = node.height / 2;

  if (dx === 0 && dy === 0) return from;

  const tanTheta = Math.abs(dy / dx);
  const tanAspect = halfH / halfW;

  let x = 0;
  let y = 0;

  if (tanTheta < tanAspect) {
    // Left or Right border
    x = dx > 0 ? halfW : -halfW;
    y = x * (dy / dx);
  } else {
    // Top or Bottom border
    y = dy > 0 ? halfH : -halfH;
    x = y * (dx / dy);
  }

  return {
    x: from.x + x,
    y: from.y + y
  };
}

// Generates orthogonal routing points for the arrow
function getRoutingPoints(
  start: { x: number; y: number },
  end: { x: number; y: number }
): number[] {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  
  if (dx > dy) {
    const midX = (start.x + end.x) / 2;
    return [start.x, start.y, midX, start.y, midX, end.y, end.x, end.y];
  } else {
    const midY = (start.y + end.y) / 2;
    return [start.x, start.y, start.x, midY, end.x, midY, end.x, end.y];
  }
}
