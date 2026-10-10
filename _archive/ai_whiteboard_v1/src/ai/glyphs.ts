/**
 * What every letter looks like, in coordinates.
 *
 * This is the reference the recogniser compares pen strokes against. It lives
 * here, in code, rather than in the model's prompt on purpose: shipping an
 * alphabet table to the model would cost tokens on every single request and
 * would still leave the model doing geometry in its head. Matching coordinates
 * against coordinates is something a computer does exactly and for free, so the
 * model receives finished words instead of a puzzle.
 *
 * Each glyph is one or more polylines in a 0..1 box, x rightwards and y
 * DOWNWARDS — the same orientation as the canvas, so nothing has to be flipped.
 * The box is the glyph's own bounding box, not a shared baseline: the matcher
 * normalises size away, so only proportions and topology matter here.
 *
 * A glyph may appear more than once. Handwriting has genuine variants — a
 * seven with and without a bar, an open and a closed four — and it is cheaper
 * to list both than to make one template stretch to cover them.
 */

export type Polyline = number[][]

export interface Glyph {
  char: string
  strokes: Polyline[]
  /**
   * True when the capital and small letter are the same shape at different
   * sizes (c, o, s, v, w, x, z...). Case is then decided from the letter's
   * height on its line, not from its shape.
   */
  caseless?: boolean
  /**
   * How wide the letter really is against its own height. The strokes above are
   * drawn in a square box because that is easier to read and to edit, but an I
   * is not as wide as it is tall and the matcher has to know that — width is
   * the one proportion it cannot recover from the shape. Left unset, the box's
   * own ratio is used, which is right for anything genuinely square.
   */
  aspect?: number
}

// A circle, sampled often enough that the rasteriser draws a smooth ring.
function ring(cx: number, cy: number, rx: number, ry: number, from = 0, to = Math.PI * 2): Polyline {
  const steps = 24
  const out: Polyline = []
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    out.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry])
  }
  return out
}

export const GLYPHS: Glyph[] = [
  // ------------------------------------------------------------- capitals
  { char: 'A', aspect: 0.72, strokes: [[[0, 1], [0.5, 0], [1, 1]], [[0.18, 0.62], [0.82, 0.62]]] },
  {
    char: 'B', aspect: 0.66,
    strokes: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.62, 0.03], [0.85, 0.22], [0.62, 0.46], [0, 0.5]],
      [[0, 0.5], [0.72, 0.55], [0.96, 0.76], [0.7, 0.97], [0, 1]],
    ],
  },
  { char: 'C', aspect: 0.7, caseless: true, strokes: [ring(0.5, 0.5, 0.5, 0.5, -Math.PI * 0.28, Math.PI * 1.28)] },
  {
    char: 'D', aspect: 0.7,
    strokes: [[[0, 0], [0, 1]], [[0, 0], [0.55, 0.04], [0.95, 0.35], [0.95, 0.65], [0.55, 0.96], [0, 1]]],
  },
  {
    char: 'E', aspect: 0.62,
    strokes: [[[0, 0], [0, 1]], [[0, 0], [1, 0]], [[0, 0.5], [0.8, 0.5]], [[0, 1], [1, 1]]],
  },
  { char: 'F', aspect: 0.6, strokes: [[[0, 0], [0, 1]], [[0, 0], [1, 0]], [[0, 0.48], [0.8, 0.48]]] },
  {
    char: 'G', aspect: 0.72,
    strokes: [
      ring(0.5, 0.5, 0.5, 0.5, -Math.PI * 0.28, Math.PI * 1.28),
      [[0.92, 0.86], [0.95, 0.55], [0.55, 0.55]],
    ],
  },
  { char: 'H', aspect: 0.7, strokes: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]] },
  { char: 'I', aspect: 0.18, strokes: [[[0.5, 0], [0.5, 1]]] },
  { char: 'I', aspect: 0.6, strokes: [[[0.5, 0], [0.5, 1]], [[0.1, 0], [0.9, 0]], [[0.1, 1], [0.9, 1]]] },
  { char: 'J', aspect: 0.5, caseless: true, strokes: [[[0.85, 0], [0.85, 0.75], [0.65, 0.97], [0.35, 1], [0.1, 0.82]]] },
  { char: 'K', aspect: 0.68, caseless: true, strokes: [[[0, 0], [0, 1]], [[1, 0], [0.05, 0.55]], [[0.1, 0.5], [1, 1]]] },
  { char: 'L', aspect: 0.58, strokes: [[[0, 0], [0, 1], [1, 1]]] },
  { char: 'M', aspect: 0.86, strokes: [[[0, 1], [0, 0], [0.5, 0.68], [1, 0], [1, 1]]] },
  { char: 'N', aspect: 0.74, strokes: [[[0, 1], [0, 0], [1, 1], [1, 0]]] },
  { char: 'O', aspect: 0.78, caseless: true, strokes: [ring(0.5, 0.5, 0.5, 0.5)] },
  {
    char: 'P', aspect: 0.62,
    caseless: true,
    strokes: [[[0, 0], [0, 1]], [[0, 0], [0.72, 0.04], [0.92, 0.26], [0.72, 0.48], [0, 0.53]]],
  },
  { char: 'Q', aspect: 0.8, caseless: true, strokes: [ring(0.5, 0.42, 0.5, 0.42), [[0.6, 0.62], [0.95, 1]]] },
  {
    char: 'R', aspect: 0.66,
    strokes: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.72, 0.04], [0.92, 0.26], [0.72, 0.48], [0, 0.53]],
      [[0.12, 0.5], [1, 1]],
    ],
  },
  {
    char: 'S', aspect: 0.62,
    caseless: true,
    strokes: [
      [[0.92, 0.14], [0.6, 0], [0.22, 0.08], [0.14, 0.32], [0.5, 0.48], [0.88, 0.62], [0.82, 0.9], [0.4, 1], [0.08, 0.86]],
    ],
  },
  { char: 'T', aspect: 0.66, strokes: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]] },
  { char: 'U', aspect: 0.72, caseless: true, strokes: [[[0, 0], [0, 0.68], [0.2, 0.94], [0.5, 1], [0.8, 0.94], [1, 0.68], [1, 0]]] },
  { char: 'V', aspect: 0.72, caseless: true, strokes: [[[0, 0], [0.5, 1], [1, 0]]] },
  { char: 'W', aspect: 0.98, caseless: true, strokes: [[[0, 0], [0.25, 1], [0.5, 0.32], [0.75, 1], [1, 0]]] },
  { char: 'X', aspect: 0.68, caseless: true, strokes: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]] },
  { char: 'Y', aspect: 0.68, strokes: [[[0, 0], [0.5, 0.52], [1, 0]], [[0.5, 0.52], [0.5, 1]]] },
  { char: 'Z', aspect: 0.64, caseless: true, strokes: [[[0, 0], [1, 0], [0, 1], [1, 1]]] },

  // --------------------------------------------------------- small letters
  // Only the ones whose shape genuinely differs from the capital. The rest are
  // marked `caseless` above and resolved by height.
  {
    char: 'a', aspect: 0.82,
    strokes: [
      ring(0.45, 0.6, 0.4, 0.4),
      [[0.85, 0.2], [0.85, 1]],
    ],
  },
  { char: 'b', aspect: 0.62, strokes: [[[0.08, 0], [0.08, 1]], ring(0.52, 0.62, 0.44, 0.38)] },
  { char: 'd', aspect: 0.62, strokes: [[[0.92, 0], [0.92, 1]], ring(0.44, 0.62, 0.42, 0.38)] },
  {
    char: 'e', aspect: 0.86,
    strokes: [[[0.05, 0.5], [0.95, 0.44], [0.78, 0.12], [0.4, 0.05], [0.08, 0.4], [0.1, 0.78], [0.48, 1], [0.9, 0.86]]],
  },
  { char: 'f', aspect: 0.44, strokes: [[[0.85, 0.06], [0.55, 0], [0.34, 0.2], [0.34, 1]], [[0.05, 0.36], [0.78, 0.36]]] },
  { char: 'g', aspect: 0.66, strokes: [ring(0.45, 0.32, 0.42, 0.3), [[0.88, 0.05], [0.88, 0.76], [0.6, 1], [0.2, 0.92]]] },
  { char: 'h', aspect: 0.62, strokes: [[[0.1, 0], [0.1, 1]], [[0.1, 0.56], [0.45, 0.38], [0.82, 0.56], [0.82, 1]]] },
  { char: 'i', aspect: 0.18, strokes: [[[0.5, 0.28], [0.5, 1]], [[0.5, 0], [0.5, 0.06]]] },
  { char: 'j', aspect: 0.3, strokes: [[[0.68, 0.28], [0.68, 0.82], [0.45, 1], [0.15, 0.9]], [[0.68, 0], [0.68, 0.06]]] },
  { char: 'l', aspect: 0.18, strokes: [[[0.5, 0], [0.5, 1]]] },
  {
    char: 'm', aspect: 1.05,
    strokes: [[[0.05, 0.2], [0.05, 1]], [[0.05, 0.35], [0.3, 0.12], [0.5, 0.32], [0.5, 1]], [[0.5, 0.32], [0.72, 0.12], [0.95, 0.35], [0.95, 1]]],
  },
  { char: 'n', aspect: 0.8, strokes: [[[0.1, 0.15], [0.1, 1]], [[0.1, 0.38], [0.45, 0.08], [0.85, 0.38], [0.85, 1]]] },
  { char: 'q', aspect: 0.66, strokes: [ring(0.45, 0.32, 0.42, 0.3), [[0.88, 0.05], [0.88, 1]]] },
  { char: 'r', aspect: 0.62, strokes: [[[0.2, 0.1], [0.2, 1]], [[0.2, 0.36], [0.5, 0.08], [0.9, 0.16]]] },
  { char: 't', aspect: 0.44, strokes: [[[0.45, 0], [0.45, 0.85], [0.75, 1]], [[0.12, 0.28], [0.85, 0.28]]] },
  { char: 'y', aspect: 0.72, strokes: [[[0.05, 0], [0.5, 0.62]], [[0.95, 0], [0.28, 1]]] },

  // ---------------------------------------------------------------- digits
  { char: '0', aspect: 0.62, strokes: [ring(0.5, 0.5, 0.42, 0.5)] },
  { char: '0', aspect: 0.62, strokes: [ring(0.5, 0.5, 0.42, 0.5), [[0.85, 0.12], [0.15, 0.88]]] },
  { char: '1', aspect: 0.3, strokes: [[[0.15, 0.22], [0.5, 0], [0.5, 1]]] },
  { char: '2', aspect: 0.6, strokes: [[[0.08, 0.22], [0.38, 0], [0.8, 0.12], [0.82, 0.4], [0.08, 1], [1, 1]]] },
  {
    char: '3', aspect: 0.6,
    strokes: [[[0.08, 0.12], [0.5, 0], [0.86, 0.2], [0.48, 0.46], [0.9, 0.68], [0.7, 0.96], [0.18, 0.94]]],
  },
  { char: '4', aspect: 0.66, strokes: [[[0.72, 0], [0.04, 0.7], [1, 0.7]], [[0.72, 0], [0.72, 1]]] },
  {
    char: '5', aspect: 0.6,
    strokes: [[[0.9, 0], [0.16, 0], [0.1, 0.44], [0.5, 0.36], [0.86, 0.58], [0.76, 0.9], [0.3, 1], [0.05, 0.88]]],
  },
  {
    char: '6', aspect: 0.6,
    strokes: [[[0.85, 0.04], [0.4, 0.12], [0.1, 0.54], [0.14, 0.86], [0.5, 1], [0.86, 0.84], [0.8, 0.58], [0.4, 0.48], [0.12, 0.62]]],
  },
  { char: '7', aspect: 0.6, strokes: [[[0, 0], [1, 0], [0.34, 1]]] },
  { char: '7', aspect: 0.6, strokes: [[[0, 0], [1, 0], [0.34, 1]], [[0.2, 0.5], [0.75, 0.5]]] },
  { char: '8', aspect: 0.6, strokes: [ring(0.5, 0.24, 0.34, 0.24), ring(0.5, 0.73, 0.44, 0.27)] },
  {
    char: '9', aspect: 0.6,
    strokes: [[[0.15, 0.96], [0.6, 0.88], [0.9, 0.46], [0.86, 0.14], [0.5, 0], [0.14, 0.16], [0.2, 0.42], [0.6, 0.52], [0.88, 0.38]]],
  },

  // ----------------------------------------------------------- punctuation
  // A full stop and a comma are not here: normalised to a box they are just a
  // blob, indistinguishable from an O. They are recognised by size and position
  // on the line instead, in handwriting.ts.
  { char: '-', aspect: 3.0, strokes: [[[0, 0.5], [1, 0.5]]] },
  { char: '+', aspect: 1.0, strokes: [[[0, 0.5], [1, 0.5]], [[0.5, 0], [0.5, 1]]] },
  { char: '=', aspect: 1.4, strokes: [[[0, 0.3], [1, 0.3]], [[0, 0.7], [1, 0.7]]] },
  { char: '/', aspect: 0.45, strokes: [[[1, 0], [0, 1]]] },
  { char: '(', aspect: 0.3, strokes: [ring(0.9, 0.5, 0.85, 0.5, Math.PI * 0.65, Math.PI * 1.35)] },
  { char: ')', aspect: 0.3, strokes: [ring(0.1, 0.5, 0.85, 0.5, -Math.PI * 0.35, Math.PI * 0.35)] },
  {
    char: '?', aspect: 0.6,
    strokes: [[[0.1, 0.18], [0.4, 0], [0.8, 0.1], [0.8, 0.34], [0.45, 0.5], [0.45, 0.68]], [[0.45, 0.9], [0.47, 1]]],
  },
  { char: '!', aspect: 0.18, strokes: [[[0.5, 0], [0.5, 0.7]], [[0.5, 0.9], [0.52, 1]]] },
]

/**
 * Characters that are the same drawing.
 *
 * No amount of measurement separates a capital O from a zero, or a capital I
 * from a small l from a one — they are one shape with several meanings, and
 * which meaning applies depends on the word, which is a question for the model
 * and not for geometry. So the matcher never silently picks one: when a winner
 * belongs to a set here, its fellows are offered alongside it and the reading
 * comes out as `[O|0]` for the model to settle from context.
 */
export const CONFUSABLE: string[][] = [
  ['O', '0', 'o', 'D'],
  ['I', 'l', '1', '!', '/'],
  ['S', '5'],
  ['Z', '2'],
  ['B', '8'],
  ['G', '6'],
  ['q', '9', 'g'],
  ['U', 'V'],
  ['C', 'c', '('],
  ['n', 'h'],
  ['u', 'v'],
]

/** The other characters that look the same as this one, if any. */
export function confusableWith(char: string): string[] {
  const out = new Set<string>()
  for (const set of CONFUSABLE) {
    if (set.includes(char)) for (const c of set) if (c !== char) out.add(c)
  }
  return [...out]
}
