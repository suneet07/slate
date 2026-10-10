import { NodeType, NodeColor } from '../graph/types';

export interface AddNodeOp {
  kind: 'add';
  id: string;
  type: NodeType;
  label: string;
  gridPos?: string;
  color?: NodeColor;
}

export interface DeleteNodeOp {
  kind: 'delete';
  id: string;
}

export interface ConnectOp {
  kind: 'connect';
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed';
}

export interface DisconnectOp {
  kind: 'disconnect';
  from: string;
  to: string;
}

export interface UpdateNodeOp {
  kind: 'update';
  id: string;
  label?: string;
  color?: NodeColor;
}

export type DiffOp = AddNodeOp | DeleteNodeOp | ConnectOp | DisconnectOp | UpdateNodeOp;

/**
 * Parses raw text diff emitted by LLM into structured operations.
 * Example diff lines:
 * add n4 box "Retry Queue" @ B3
 * delete n2
 * connect n2 -> n4 "cache check"
 * update n1 label "HTTPS Request"
 */
export interface ParsedDiff {
  ops: DiffOp[];
  /** Lines that looked like operations but could not be parsed — reported, never dropped silently */
  unparsed: string[];
  /** Note IDs the model asked to read before it can answer (drives the second turn) */
  fetches: string[];
}

// Lines the model writes as commentary rather than operations; ignoring these is correct
const PROSE_LINE = /^(ok(ay)?|sure|here|note|explanation|i |the |this |that |we |you )/i;

export function parseGraphDiff(diffText: string): ParsedDiff {
  const lines = diffText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const ops: DiffOp[] = [];
  const unparsed: string[] = [];
  const fetches: string[] = [];

  lines.forEach((line) => {
    // Fetch note: fetch note_doc_123_p4
    // Accepts both `fetch note_x` and the function-call shape `fetch("note_x")`
    const fetchMatch = line.match(/^(?:fetch|get_note|read)(?:\s+|\s*\(\s*)["']?([a-zA-Z0-9_]+)["']?\s*\)?\s*$/i);
    if (fetchMatch) {
      if (!fetches.includes(fetchMatch[1])) fetches.push(fetchMatch[1]);
      return;
    }

    // Add Node: add n4 box "Retry Queue" @ B3 [primary] OR add n4 image "Diagram" @ B3
    // The label, grid position and colour are each optional and stripped from the tail,
    // so an unquoted or omitted label no longer causes the whole line to be dropped.
    const addMatch = line.match(/^add\s+([a-zA-Z0-9_]+)\s+(box|cylinder|frame|text|circle|ellipse|image|sticky|diamond|triangle|star|hexagon|cloud)\b(.*)$/i);
    if (addMatch) {
      const parsedType = (addMatch[2].toLowerCase() === 'ellipse' ? 'circle' : addMatch[2].toLowerCase()) as NodeType;

      let color: string | undefined;
      let gridPos: string | undefined;

      let body = addMatch[3]
        .replace(/\[\s*([a-zA-Z]+)\s*\]\s*$/, (_m, c) => {
          color = c.toLowerCase();
          return '';
        })
        .trim();

      body = body
        .replace(/@\s*([A-Za-z]{1,3}\s?\d{1,3})\s*$/, (_m, g) => {
          gridPos = g.replace(/\s+/g, '').toUpperCase();
          return '';
        })
        .trim();

      const quoted = body.match(/^"([^"]*)"$/);
      const label = decodeLabel(quoted ? quoted[1] : body.replace(/^["']|["']$/g, '').trim());

      ops.push({
        kind: 'add',
        id: addMatch[1],
        type: parsedType,
        label,
        gridPos,
        color: color as NodeColor
      });
      return;
    }

    // Connect: connect n1 -> n2 "label"
    const connectMatch = line.match(/^(?:connect|add\s+edge)\s+([a-zA-Z0-9_]+)\s*->\s*([a-zA-Z0-9_]+)(?:\s+"([^"]*)")?/i);
    if (connectMatch) {
      ops.push({
        kind: 'connect',
        from: connectMatch[1],
        to: connectMatch[2],
        label: connectMatch[3] === undefined ? undefined : decodeLabel(connectMatch[3])
      });
      return;
    }

    // Delete Node or Edge: delete n2 OR delete edge n1->n2
    const deleteMatch = line.match(/^delete\s+([a-zA-Z0-9_]+)$/i);
    if (deleteMatch) {
      ops.push({
        kind: 'delete',
        id: deleteMatch[1]
      });
      return;
    }

    // Update Node: update n1 label "HTTPS Request"
    // At least one field is required — a bare "update n1" is a no-op that would otherwise
    // still be counted as an applied change.
    const updateMatch = line.match(/^update\s+([a-zA-Z0-9_]+)(?:\s+label\s+"([^"]*)")?(?:\s+color\s+([a-zA-Z]+))?\s*$/i);
    if (updateMatch && (updateMatch[2] !== undefined || updateMatch[3] !== undefined)) {
      ops.push({
        kind: 'update',
        id: updateMatch[1],
        label: updateMatch[2] === undefined ? undefined : decodeLabel(updateMatch[2]),
        color: updateMatch[3]?.toLowerCase() as NodeColor
      });
      return;
    }

    // Nothing matched. Commentary is expected and ignored; anything else is a real
    // instruction the board silently lost, so it gets reported.
    if (!PROSE_LINE.test(line)) {
      unparsed.push(line);
    }
  });

  return { ops, unparsed, fetches };
}

/**
 * Turns escape sequences in a label into the characters they stand for.
 *
 * A diff line is one line of text, so a model writing a two-line label has no choice but to
 * escape the break. Passing the label through verbatim put a literal backslash-n on the
 * board instead of a line break.
 */
function decodeLabel(raw: string): string {
  if (!raw || raw.indexOf('\\') === -1) return raw;

  return raw
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}
