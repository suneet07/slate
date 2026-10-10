import dagre from 'dagre';
import { SceneGraph, BoardNode, BoardEdge } from '../graph/types';
import { gridPosToCoords, coordsToGridPos } from '../graph/quantizer';
import { DiffOp } from './diffParser';

/**
 * Calculates auto-layout positions for nodes using Dagre
 */
export function applyAutoLayout(nodes: Record<string, BoardNode>, edges: Record<string, BoardEdge>): Record<string, BoardNode> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  Object.values(nodes).forEach((node) => {
    g.setNode(node.id, { width: node.width, height: node.height });
  });

  Object.values(edges).forEach((edge) => {
    if (nodes[edge.from] && nodes[edge.to]) {
      g.setEdge(edge.from, edge.to);
    }
  });

  dagre.layout(g);

  const updatedNodes = { ...nodes };
  Object.values(nodes).forEach((node) => {
    const layoutNode = g.node(node.id);
    if (layoutNode) {
      const x = Math.max(40, layoutNode.x - node.width / 2);
      const y = Math.max(40, layoutNode.y - node.height / 2);
      updatedNodes[node.id] = {
        ...node,
        x,
        y,
        gridPos: coordsToGridPos(x, y)
      };
    }
  });

  return updatedNodes;
}

export function computeDynamicNodeDimensions(type: string, label: string): { width: number; height: number } {
  if (type === 'image') return { width: 380, height: 260 };
  if (type === 'frame') return { width: 340, height: 240 };

  const baseWidth = Math.max(180, Math.min(420, (label || '').length * 8 + 40));
  const approxCharsPerLine = Math.max(20, Math.floor((baseWidth - 24) / 7.5));
  const lineCount = Math.max(1, Math.ceil((label || '').length / approxCharsPerLine));
  const calculatedHeight = Math.max(70, lineCount * 22 + 32);

  return { width: baseWidth, height: calculatedHeight };
}

function rectsOverlap(a: BoardNode, b: { x: number; y: number; width: number; height: number }): boolean {
  const gap = 12;
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/**
 * Finds a free spot for a new node, starting from the position the model asked for.
 * Walks the grid in reading order rather than shoving the node somewhere arbitrary, so
 * the model's spatial intent is honoured whenever the cell is actually free.
 */
function findFreePosition(
  preferred: { x: number; y: number },
  dims: { width: number; height: number },
  placed: BoardNode[]
): { x: number; y: number } {
  const collides = (x: number, y: number) =>
    placed.some((n) => rectsOverlap(n, { x, y, width: dims.width, height: dims.height }));

  if (!collides(preferred.x, preferred.y)) return preferred;

  const STEP_X = 240;
  const STEP_Y = 160;
  for (let ring = 1; ring <= 12; ring++) {
    for (let dy = 0; dy <= ring; dy++) {
      for (const dx of [ring, -ring]) {
        const x = Math.max(40, preferred.x + dx * STEP_X);
        const y = Math.max(40, preferred.y + dy * STEP_Y);
        if (!collides(x, y)) return { x, y };
      }
    }
    const y = preferred.y + ring * STEP_Y;
    if (!collides(preferred.x, y)) return { x: preferred.x, y };
  }

  return { x: preferred.x, y: preferred.y + 13 * STEP_Y };
}

/**
 * Applies graph diff operations onto a scene graph state, resolving new node coordinates.
 *
 * Existing nodes keep their exact positions. Running a whole-board auto-layout on every
 * AI turn threw away both the teacher's manual arrangement and the grid position the
 * model had just chosen — and left the model reading back coordinates it never picked,
 * so its spatial grounding degraded turn over turn.
 */
export function applyDiffToGraph(
  graph: SceneGraph,
  ops: DiffOp[]
): { graph: SceneGraph; addedNodeIds: string[]; renamedIds: Record<string, string> } {
  const newNodes = { ...graph.nodes };
  const newEdges = { ...graph.edges };
  const addedNodeIds: string[] = [];

  // An `add` reusing a live ID would overwrite the teacher's node. Remap it to a fresh ID
  // instead, and resolve later references in the same diff to the node the model believes
  // it just created.
  const renamedIds: Record<string, string> = {};
  const resolveId = (id: string) => renamedIds[id] || id;

  let idCounter = Object.keys(newNodes).length + 1;
  const freshId = (): string => {
    let candidate = `n${idCounter++}`;
    while (newNodes[candidate]) candidate = `n${idCounter++}`;
    return candidate;
  };

  ops.forEach((op) => {
    if (op.kind === 'add') {
      const targetId = newNodes[op.id] ? freshId() : op.id;
      if (targetId !== op.id) renamedIds[op.id] = targetId;

      const dims = computeDynamicNodeDimensions(op.type, op.label || '');
      const preferred = op.gridPos ? gridPosToCoords(op.gridPos) : { x: 300, y: 200 };
      const { x, y } = findFreePosition(preferred, dims, Object.values(newNodes));

      newNodes[targetId] = {
        id: targetId,
        type: op.type,
        label: op.label,
        gridPos: coordsToGridPos(x, y),
        x,
        y,
        width: dims.width,
        height: dims.height,
        color: op.color || 'primary'
      };
      addedNodeIds.push(targetId);
    } else if (op.kind === 'delete') {
      const id = resolveId(op.id);
      delete newNodes[id];
      Object.values(newEdges).forEach((e) => {
        if (e.from === id || e.to === id) {
          delete newEdges[e.id];
        }
      });
    } else if (op.kind === 'connect') {
      const from = resolveId(op.from);
      const to = resolveId(op.to);
      const edgeId = `e_${from}_${to}`;
      newEdges[edgeId] = {
        id: edgeId,
        from,
        to,
        label: op.label
      };
    } else if (op.kind === 'update') {
      const id = resolveId(op.id);
      if (newNodes[id]) {
        newNodes[id] = {
          ...newNodes[id],
          ...(op.label ? { label: op.label } : {}),
          ...(op.color ? { color: op.color } : {})
        };
      }
    }
  });

  return {
    graph: {
      ...graph,
      nodes: newNodes,
      edges: newEdges
    },
    addedNodeIds,
    renamedIds
  };
}
