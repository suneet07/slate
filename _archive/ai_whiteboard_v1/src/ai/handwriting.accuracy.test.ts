/**
 * Accuracy harness for the handwriting recogniser. Not part of `npm test` —
 * run it directly when tuning glyphs or thresholds:
 *
 *   npm run test:handwriting
 */
import { GLYPHS } from './glyphs'
import { lineMetrics, recognizeLine, recognizeWord, spellWord, type StrokeInput } from './handwriting'
import type { Point } from '../engine/types'

// A tiny deterministic PRNG: the same run twice must give the same numbers, or
// a threshold that "improved" is just a lucky seed.
let seed = 12345
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

interface Pen {
  /** Fraction of the letter's size the pen wanders by. */
  jitter: number
  /** Radians of slant. */
  skew: number
}

/** Draws a glyph the way a hand would: wobbling, slanted, and a bit off-square. */
function penStrokes(char: string, x: number, y: number, size: number, pen: Pen, tag: string): StrokeInput[] {
  const glyph = GLYPHS.find((g) => g.char === char) ?? GLYPHS.find((g) => g.char.toLowerCase() === char.toLowerCase())
  if (!glyph) throw new Error(`no glyph for ${char}`)
  // Each letter is drawn at its own proportions, or the harness would test a
  // world where every letter is the same width — which is exactly the mistake
  // the recogniser used to make.
  const wide = size * (glyph.aspect ?? 0.7)

  return glyph.strokes.map((stroke, i) => {
    const points: Point[] = []
    for (let k = 0; k < stroke.length; k++) {
      // Resample between template points so jitter shows up along the path,
      // not only at its corners.
      const steps = k === 0 ? 1 : 3
      for (let s = k === 0 ? 0 : 1; s <= steps; s++) {
        const [px, py] = k === 0 ? stroke[0] : lerp(stroke[k - 1], stroke[k], s / steps)
        const jx = (rnd() - 0.5) * pen.jitter * size
        const jy = (rnd() - 0.5) * pen.jitter * size
        points.push({
          x: x + px * wide + jx - py * Math.tan(pen.skew) * size * 0.5,
          y: y + py * size + jy,
        })
      }
    }
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    return {
      name: `${tag}s${i}`,
      points,
      bounds: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      },
    }
  })
}

function lerp(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Lays out a word letter by letter with a believable gap between letters. */
function writeWord(text: string, x0: number, capHeight: number, pen: Pen): StrokeInput[] {
  const strokes: StrokeInput[] = []
  let x = x0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    // Small letters sit lower and shorter, as they do on a real line.
    const small = ch >= 'a' && ch <= 'z' && !'bdfhklt'.includes(ch)
    const size = small ? capHeight * 0.62 : capHeight
    const top = 100 + (small ? capHeight * 0.38 : 0)
    const drawn = penStrokes(ch, x, top, size, pen, `${i}`)
    strokes.push(...drawn)
    const width = Math.max(...drawn.map((s) => s.bounds.x + s.bounds.w)) - x
    x += width + capHeight * 0.3
  }
  return strokes
}

function stripCase(s: string): string {
  return s.toLowerCase()
}

// ------------------------------------------------------- single letters

for (const trial of [
  { name: 'clean         ', pen: { jitter: 0, skew: 0 } },
  { name: 'light wobble  ', pen: { jitter: 0.03, skew: 0 } },
  { name: 'wobble + slant', pen: { jitter: 0.05, skew: 0.12 } },
]) {
  let hits = 0
  let offered = 0
  let total = 0
  const misses: string[] = []
  for (const glyph of GLYPHS) {
    for (let n = 0; n < 3; n++) {
      const strokes = penStrokes(glyph.char, 100, 100, 60, trial.pen, 't')
      const metrics = lineMetrics([{ x: 100, y: 100, w: 40, h: 60 }])
      const word = recognizeWord(strokes, metrics)
      total++
      const want = stripCase(glyph.char)
      const first = word.chars[0]
      const choices = first ? [first.char, ...first.alternatives].map(stripCase) : []
      if (stripCase(word.text) === want) hits++
      else if (n === 0) misses.push(`${glyph.char}->${word.text}`)
      // What matters downstream is whether the right answer reached the model
      // at all: it can pick between [O|0] using the word, and cannot recover
      // from a letter that was never offered.
      if (word.chars.length === 1 && choices.includes(want)) offered++
    }
  }
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`
  console.log(`letters, ${trial.name}: top choice ${pct(hits)}, offered to the model ${pct(offered)}`)
  if (misses.length) console.log('   not top choice: ' + misses.join(' '))
}

// -------------------------------------------------------------- words

console.log('')
const pen: Pen = { jitter: 0.04, skew: 0.08 }
for (const text of ['EARTH', 'What', 'is', 'H2O', 'SUN', 'Water', 'cycle', 'MATH', 'plant', '1234']) {
  const strokes = writeWord(text, 100, 60, pen)
  const got = recognizeLine([strokes])[0]
  const flag = stripCase(got.text) === stripCase(text) ? 'ok  ' : 'MISS'
  console.log(
    `  ${flag} wrote "${text}" read "${got.text}" spelled "${spellWord(got)}" conf ${got.confidence.toFixed(2)}`,
  )
}
