/**
 * The note tree is the real "vectorless" index: a hierarchy the model reads and navigates,
 * instead of an embedding space it can only be pushed through.
 *
 * Types live in their own module because both `pdfExtractor` (which stores a tree on a
 * document) and `treeIndexer` (which builds one) need them — importing either from the
 * other would be circular.
 */

export interface NoteTreeNode {
  /** `note_<docId>_p<page>` for a page leaf, `sec_<docId>_<n>` for a section. Fetchable. */
  id: string;
  title: string;
  summary: string;
  topics: string[];
  pageStart: number;
  pageEnd: number;
  hasDiagram?: boolean;
  children?: NoteTreeNode[];
}

export interface NoteTree {
  docId: string;
  filename: string;
  generatedAt: string;
  /** Which model wrote it — a tree built by an 8B model is worth less than one from a 70B. */
  model: string;
  /** True when the LLM pass failed and this is the mechanical fallback, not a real tree. */
  degraded?: boolean;
  nodes: NoteTreeNode[];
}

export function leafNoteId(docId: string, pageNumber: number): string {
  return `note_${docId}_p${pageNumber}`;
}

export function sectionNoteId(docId: string, index: number): string {
  return `sec_${docId}_${index}`;
}

export function parseLeafNoteId(id: string): { docId: string; pageNumber: number } | undefined {
  const match = (id || '').match(/^note_(.+)_p(\d+)$/);
  return match ? { docId: match[1], pageNumber: parseInt(match[2], 10) } : undefined;
}

export function parseSectionNoteId(id: string): { docId: string; index: number } | undefined {
  const match = (id || '').match(/^sec_(.+)_(\d+)$/);
  return match ? { docId: match[1], index: parseInt(match[2], 10) } : undefined;
}

/** Depth-first walk over a tree's nodes, sections included. */
export function walkTree(nodes: NoteTreeNode[], visit: (node: NoteTreeNode, depth: number) => void, depth = 0): void {
  nodes.forEach((node) => {
    visit(node, depth);
    if (node.children && node.children.length > 0) walkTree(node.children, visit, depth + 1);
  });
}

export function findTreeNode(tree: NoteTree, id: string): NoteTreeNode | undefined {
  let found: NoteTreeNode | undefined;
  walkTree(tree.nodes, (node) => {
    if (!found && node.id === id) found = node;
  });
  return found;
}

/** Every page leaf in the tree, in page order. */
export function collectLeaves(tree: NoteTree): NoteTreeNode[] {
  const leaves: NoteTreeNode[] = [];
  walkTree(tree.nodes, (node) => {
    if (!node.children || node.children.length === 0) leaves.push(node);
  });
  return leaves.sort((a, b) => a.pageStart - b.pageStart);
}

/**
 * Renders the tree for the system prompt. Indentation carries the hierarchy, so the model
 * can skip a whole section by its heading instead of reading every page line.
 */
export function renderNoteTree(tree: NoteTree): string {
  const lines: string[] = [];

  walkTree(tree.nodes, (node, depth) => {
    const indent = '  '.repeat(depth);
    const pages = node.pageStart === node.pageEnd ? `p.${node.pageStart}` : `p.${node.pageStart}-${node.pageEnd}`;
    const isSection = !!(node.children && node.children.length > 0);
    const topics = node.topics.length > 0 ? ` | topics: ${node.topics.join(', ')}` : '';
    const diagram = node.hasDiagram ? ' | has_diagram' : '';

    if (isSection) {
      lines.push(`${indent}- [SECTION ${node.id}] ${node.title} (${pages})${topics}`);
      if (node.summary) lines.push(`${indent}    ${node.summary}`);
    } else {
      lines.push(`${indent}- ${node.id} | ${node.title} (${pages})${topics}${diagram}`);
      if (node.summary) lines.push(`${indent}    ${node.summary}`);
    }
  });

  return lines.join('\n');
}
