import { SceneGraph, BoardNode } from './types';
import { coordsToGridPos } from './quantizer';

/**
 * Serializes the current board SceneGraph into a flat, token-efficient text format.
 * Example output:
 * n1  box       "HTTP Request"     @ A1
 * n2  box       "Load Balancer"    @ B1
 * n3  cylinder  "Postgres"         @ C2
 * g1  frame     "Backend" { n2 n3 }
 *
 * n1 -> n2
 * n2 -> n3  "query"
 */
export interface OcrHandwritingSnippet {
  text: string;
  gridPos: string;
  /** The ink strokes this reading came from, so unread ink can be told apart. */
  strokeIds?: string[];
}

/**
 * Pen strokes nobody read: neither a recognised line of writing nor a shape node. Without
 * this, a board holding only ink the reader could not make out serialised as "empty", and
 * the model told the teacher there was nothing there while their writing was on screen.
 * Specks — a stray tap of the pen — are left out; they are noise, not content.
 */
function unreadInk(graph: SceneGraph, read: OcrHandwritingSnippet[]): { count: number; from: string; to: string } | null {
  const covered = new Set(read.flatMap((h) => h.strokeIds ?? []));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const stroke of Object.values(graph.ink ?? {})) {
    if (covered.has(stroke.id) || stroke.points.length === 0) continue;
    const xs = stroke.points.map((p) => p[0]);
    const ys = stroke.points.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (Math.hypot(w, h) < 6) continue;
    count++;
    minX = Math.min(minX, ...xs);
    minY = Math.min(minY, ...ys);
    maxX = Math.max(maxX, ...xs);
    maxY = Math.max(maxY, ...ys);
  }
  if (count === 0) return null;
  return { count, from: coordsToGridPos(minX, minY), to: coordsToGridPos(maxX, maxY) };
}

export function serializeSceneGraph(
  graph: SceneGraph,
  ocrHandwriting?: OcrHandwritingSnippet[]
): string {
  const lines: string[] = [];

  // Group nodes by type & frame containment
  const nodes = Object.values(graph.nodes);
  const edges = Object.values(graph.edges);

  const unread = unreadInk(graph, ocrHandwriting ?? []);

  if (nodes.length === 0 && edges.length === 0 && (!ocrHandwriting || ocrHandwriting.length === 0) && !unread) {
    return '# Board is currently empty';
  }

  // Find children of frames
  const frameChildrenMap: Record<string, string[]> = {};
  nodes.forEach((node) => {
    if (node.parentId) {
      if (!frameChildrenMap[node.parentId]) {
        frameChildrenMap[node.parentId] = [];
      }
      frameChildrenMap[node.parentId].push(node.id);
    }
  });

  // 1. Serialize Nodes
  nodes.forEach((node) => {
    const grid = node.gridPos || coordsToGridPos(node.x, node.y);
    const label = JSON.stringify(node.label || '');
    let line = `${node.id.padEnd(4)} ${node.type.padEnd(9)} ${label.padEnd(20)} @ ${grid}`;

    if (node.confidence !== undefined && node.confidence < 1.0) {
      line += `  ?${node.confidence.toFixed(2)}`;
    }

    if (node.color && node.color !== 'default') {
      line += `  [${node.color}]`;
    }

    if (node.type === 'frame' && frameChildrenMap[node.id]) {
      const childrenStr = frameChildrenMap[node.id].join(' ');
      line += ` { ${childrenStr} }`;
    }

    lines.push(line);
  });

  // 2. Serialize Edges
  if (edges.length > 0) {
    lines.push(''); // Empty line separator
    edges.forEach((edge) => {
      let line = `${edge.from} -> ${edge.to}`;
      if (edge.label) {
        line += `  ${JSON.stringify(edge.label)}`;
      }
      if (edge.style === 'dashed') {
        line += `  [dashed]`;
      }
      lines.push(line);
    });
  }

  // 3. Serialize handwritten text (TrOCR when configured, otherwise read locally)
  if (ocrHandwriting && ocrHandwriting.length > 0) {
    lines.push('');
    lines.push('# HANDWRITTEN NOTES ON SLIDE:');
    ocrHandwriting.forEach((h, idx) => {
      lines.push(`ink_${idx + 1}  handwritten ${JSON.stringify(h.text)} @ ${h.gridPos}`);
    });
  }

  if (unread) {
    lines.push('');
    lines.push('# UNREAD PEN STROKES ON SLIDE:');
    lines.push(
      `${unread.count} stroke(s) spanning ${unread.from}..${unread.to} could not be read as text — a drawing, ` +
        'or writing too joined-up or unclear to split into letters. The board is NOT empty: say there is ' +
        'pen content here you cannot read, and do not guess at what it says.'
    );
  }

  return lines.join('\n');
}
