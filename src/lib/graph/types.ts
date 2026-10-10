export type NodeType = 'box' | 'cylinder' | 'frame' | 'text' | 'circle' | 'image' | 'sticky' | 'diamond' | 'triangle' | 'star' | 'hexagon' | 'cloud';

export type NodeColor = 'default' | 'primary' | 'success' | 'warning' | 'error';

export interface BoardNode {
  id: string;
  type: NodeType;
  label: string;
  gridPos: string; // Coarse spatial grid (e.g., "A1", "B2")
  x: number;
  y: number;
  width: number;
  height: number;
  color?: NodeColor;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  fontSize?: number;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  parentId?: string; // Explicit containment frame ID
  confidence?: number; // Recognition confidence (e.g. 0.72)
  imageUrl?: string; // Data URL or URL of extracted PDF diagram/image
}

export interface BoardEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed';
}

export interface InkStroke {
  id: string;
  points: number[][]; // [x, y, pressure]
  color: string;
  strokeWidth: number;
  parentId?: string; // Parent shape node ID if handwritten inside a box/frame
  recognizedText?: string;
  confidence?: number;
}

export interface SceneGraph {
  nodes: Record<string, BoardNode>;
  edges: Record<string, BoardEdge>;
  ink: Record<string, InkStroke>;
  version: number;
}

export interface Slide {
  id: string;
  title: string;
  nodes: Record<string, BoardNode>;
  edges: Record<string, BoardEdge>;
  ink: Record<string, InkStroke>;
}

export interface DocImage {
  id: string;
  docId: string;
  filename: string;
  pageNumber: number;
  dataUrl: string;
  caption?: string;
  /**
   * 'page'    — whole-page render, the fallback
   * 'crop'    — a captioned Table/Figure region
   * 'picture' — a picture embedded in the PDF (photo, logo, uncaptioned figure), cropped at
   *             its exact position on the page
   */
  kind: 'page' | 'crop' | 'picture';
  /**
   * Pixel size of dataUrl, so the board can keep the picture's proportions. Optional:
   * documents extracted before this was recorded do not have it.
   */
  width?: number;
  height?: number;
  /** Text read out of the picture by local OCR — its labels, or its words if it is text. */
  ocrText?: string;
  /**
   * A page render of a slide with no text of its own: the whole slide is one picture, so
   * it is offered as a picture rather than as a fallback page scan.
   */
  imageOnly?: boolean;
}

export type ActiveTool = 'select' | 'hand' | 'box' | 'cylinder' | 'frame' | 'text' | 'circle' | 'sticky' | 'diamond' | 'triangle' | 'star' | 'hexagon' | 'cloud' | 'connector' | 'pen' | 'laser' | 'eraser';

export interface GridCell {
  row: string; // 'A', 'B', 'C', ...
  col: number; // 1, 2, 3, ...
}
