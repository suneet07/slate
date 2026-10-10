import React from 'react';
import { Path } from 'react-konva';
import getStroke from 'perfect-freehand';
import { InkStroke as InkStrokeType } from '../../lib/graph/types';

interface InkStrokeProps {
  stroke: InkStrokeType;
  isSelected?: boolean;
  onSelect?: (id: string) => void;
}

export const InkStroke: React.FC<InkStrokeProps> = ({ stroke, isSelected, onSelect }) => {
  if (!stroke.points || stroke.points.length === 0) return null;

  const outlinePoints = getStroke(stroke.points, {
    size: stroke.strokeWidth || 6,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.55
  });

  const pathData = getSvgPathFromStroke(outlinePoints);

  return (
    <Path
      data={pathData}
      fill={stroke.color || '#f3f4f6'}
      stroke={isSelected ? '#818cf8' : undefined}
      strokeWidth={isSelected ? 1 : 0}
      onClick={() => onSelect && onSelect(stroke.id)}
    />
  );
};

function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', stroke[0][0], stroke[0][1], 'Q'] as (string | number)[]
  );

  d.push('Z');
  return d.join(' ');
}
