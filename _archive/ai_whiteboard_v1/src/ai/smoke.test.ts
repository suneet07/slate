/**
 * Headless smoke test for the AI command layer — no DOM, no canvas.
 * Run with:  npx tsx src/ai/smoke.test.ts
 *
 * This is the layer a model talks to, so it is the layer worth checking:
 * every assertion below mirrors a phrasing a small model actually produces.
 */

import { execute, resolveTargets, type Command } from './commands'
import { digestBoard } from './serialize'
import { analyseBoardInk, analyseInk } from './inkAnalysis'
import { GLYPHS } from './glyphs'
import { CONFIDENT } from './handwriting'
import { BoardStore } from '../engine/store'

/** Points along an ellipse — stands in for a hand-drawn closed shape. */
function ring(cx: number, cy: number, rx: number, ry: number, steps = 48) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = (i / steps) * Math.PI * 2
    return { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry }
  })
}

/** Shoelace area, for checking that a closed stroke bulges out into a curve. */
function polyArea(pts: { x: number; y: number }[]): number {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/** Points along part of an ellipse — stands in for a hand-drawn arc. */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps = 24) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / steps
    return { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry }
  })
}

let failures = 0

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}`, detail ?? '')
  }
}

function fresh(): BoardStore {
  return new BoardStore({ cols: 24, rows: 14, cellSize: 100 })
}

// --------------------------------------------------------------- placement

console.log('placement')
{
  const store = fresh()
  const report = execute(store, [
    { op: 'add', shape: 'rect', name: 'box1', at: 'C3', size: '3x2', text: 'Light' },
  ])
  const box = store.get('box1')
  check('cell ref C3 maps to (200,200)', box?.x === 200 && box?.y === 200, box)
  check('size 3x2 maps to 300x200', box?.w === 300 && box?.h === 200, box)
  check('report is clean', report.ok, report.errors)
}
{
  const store = fresh()
  execute(store, [
    { op: 'add', shape: 'rect', name: 'a', at: 'A1', size: '2x2' },
    { op: 'add', shape: 'rect', name: 'b', at: 'right of a', size: '2x2' },
  ])
  const a = store.get('a')!
  const b = store.get('b')!
  check('"right of a" lands clear of a', b.x >= a.x + a.w, { a, b })
  check('"right of a" keeps the same top edge', b.y === a.y, { a, b })
}
{
  // Fractional placement: eyes on a face, without knowing where the face is.
  const store = fresh()
  execute(store, [
    { op: 'add', shape: 'ellipse', name: 'face', at: 'C2', size: '5x5' },
    { op: 'add', shape: 'ellipse', name: 'eyeL', size: '0.6x0.6', at: { of: 'face', u: 0.33, v: 0.36 } },
    { op: 'add', shape: 'ellipse', name: 'eyeR', size: '0.6x0.6', at: { of: 'face', u: 0.67, v: 0.36 } },
  ])
  const face = store.bounds('face')!
  const l = store.bounds('eyeL')!
  const r = store.bounds('eyeR')!
  check('u,v centres the shape at that fraction',
    Math.abs(l.x + l.w / 2 - (face.x + 0.33 * face.w)) < 0.01, { l, face })
  check('eyes land in the upper half', l.y + l.h / 2 < face.y + face.h / 2)
  check('mirrored u values give mirrored eyes',
    Math.abs((l.x + l.w / 2 - (face.x + face.w / 2)) + (r.x + r.w / 2 - (face.x + face.w / 2))) < 0.01)

  // And the analysis reads them back as a pair — the round trip that matters.
  const drawing = execute(store, [
    { op: 'draw', relativeTo: 'face', name: 'mouth', points: [[0.27, 0.6], [0.5, 0.78], [0.73, 0.6]] },
  ])
  check('mouth stroke is accepted', drawing.ok, drawing.errors)
}
{
  const store = fresh()
  execute(store, [
    { op: 'add', shape: 'rect', name: 'a', at: 'A1', size: '3x2' },
    { op: 'add', shape: 'note', name: 'n' }, // no position at all
  ])
  const a = store.get('a')!
  const n = store.get('n')!
  const overlaps =
    n.x < a.x + a.w && n.x + n.w > a.x && n.y < a.y + a.h && n.y + n.h > a.y
  check('auto-placement avoids existing shapes', !overlaps, { a, n })
}

// ------------------------------------------------------------------ naming

console.log('naming')
{
  const store = fresh()
  const report = execute(store, [
    { op: 'add', shape: 'rect', name: 'box1' },
    { op: 'add', shape: 'rect', name: 'box1' }, // collision
    { op: 'add', shape: 'ellipse' }, // no name at all
  ])
  check('duplicate name is renamed, not dropped', store.names().length === 3, store.names())
  check('auto name follows the shape kind', store.names().some((n) => n.startsWith('circle')), store.names())
  check('created names are reported back', report.created.length === 3, report.created)
}

// ---------------------------------------------------------------- connectors

console.log('connectors')
{
  const store = fresh()
  execute(store, [
    { op: 'add', shape: 'rect', name: 'a', at: 'A1', size: '2x2' },
    { op: 'add', shape: 'rect', name: 'b', at: 'F1', size: '2x2' },
    { op: 'connect', from: 'a', to: 'b', text: 'feeds' },
  ])
  check('connect creates one arrow', store.all().filter((s) => s.kind === 'arrow').length === 1)

  const before = store.bounds('arrow1')!
  execute(store, [{ op: 'move', target: 'b', at: 'F8' }])
  const after = store.bounds('arrow1')!
  check('arrow follows the shape it is bound to', after.y !== before.y, { before, after })

  execute(store, [{ op: 'delete', target: 'b' }])
  check('deleting a shape removes its dangling arrow', !store.has('arrow1'), store.names())
}
{
  const store = fresh()
  execute(store, [{ op: 'add', shape: 'rect', name: 'a' }])
  const report = execute(store, [{ op: 'connect', from: 'a', to: 'ghost' }])
  check('missing endpoint is an error, not a crash', !report.ok)
  check('error names the offender', report.errors[0].includes('ghost'), report.errors)
}

// -------------------------------------------------------------------- layout

console.log('layout')
{
  const store = fresh()
  execute(store, [
    { op: 'add', shape: 'rect', name: 'a', at: 'A1', size: '2x1' },
    { op: 'add', shape: 'rect', name: 'b', at: 'D3', size: '2x1' },
    { op: 'add', shape: 'rect', name: 'c', at: 'G6', size: '2x1' },
    { op: 'align', target: ['a', 'b', 'c'], edge: 'left' },
  ])
  const xs = ['a', 'b', 'c'].map((n) => store.get(n)!.x)
  check('align left gives one shared x', new Set(xs).size === 1, xs)
}
{
  const store = fresh()
  execute(store, [
    { op: 'add', shape: 'note', name: 'n1', at: 'A1', size: '2x2' },
    { op: 'add', shape: 'note', name: 'n2', at: 'H5', size: '2x2' },
    { op: 'add', shape: 'note', name: 'n3', at: 'M9', size: '2x2' },
    { op: 'stack', target: 'kind:note', dir: 'down', gap: 50, at: 'B2' },
  ])
  const ys = ['n1', 'n2', 'n3'].map((n) => store.get(n)!.y)
  check('stack starts at the given cell', ys[0] === 100, ys)
  check('stack spacing honours gap', ys[1] - ys[0] === 250 && ys[2] - ys[1] === 250, ys)
  check('stack shares one column', new Set(['n1', 'n2', 'n3'].map((n) => store.get(n)!.x)).size === 1)
}
{
  const store = fresh()
  execute(store, [
    { op: 'add', shape: 'rect', name: 'r1', at: 'A1', size: '2x1' },
    { op: 'add', shape: 'rect', name: 'r2', at: 'A3', size: '2x1' },
    { op: 'add', shape: 'rect', name: 'r3', at: 'A5', size: '2x1' },
    { op: 'add', shape: 'rect', name: 'r4', at: 'A7', size: '2x1' },
    { op: 'grid', target: ['r1', 'r2', 'r3', 'r4'], cols: 2, gap: 0, at: 'A1' },
  ])
  const pos = ['r1', 'r2', 'r3', 'r4'].map((n) => [store.get(n)!.x, store.get(n)!.y].join(','))
  check('grid lays out 2x2', pos.join(' | ') === '0,0 | 200,0 | 0,100 | 200,100', pos)
}

// ----------------------------------------------------------------- targeting

console.log('targeting')
{
  const store = fresh()
  execute(store, [
    { op: 'add', shape: 'note', name: 'n1', color: 'red' },
    { op: 'add', shape: 'note', name: 'n2', color: 'blue' },
    { op: 'add', shape: 'rect', name: 'r1', color: 'red' },
  ])
  check('kind: selector', resolveTargets(store, 'kind:note').length === 2)
  check('color: selector', resolveTargets(store, 'color:red').length === 2)
  check('all selector', resolveTargets(store, 'all').length === 3)
  check('comma string selector', resolveTargets(store, 'n1, r1').length === 2)

  execute(store, [{ op: 'set', target: 'kind:note', color: 'green' }])
  check('set applies across a selector', store.get('n1')!.color === 'green' && store.get('n2')!.color === 'green')
}

// ---------------------------------------------------------------- validation

console.log('validation')
{
  const store = fresh()
  const report = execute(store, [
    { op: 'add', shape: 'circle', name: 'c1' }, // alias
    { op: 'add', shape: 'blob' } as unknown as Command, // nonsense kind
    { op: 'add', shape: 'rect', name: 'brownbox', color: 'brown' } as unknown as Command,
    { op: 'add', shape: 'rect', name: 'oddbox', color: 'chartreuse' } as unknown as Command,
    { op: 'add', shape: 'rect', size: 'big' } as unknown as Command, // bad size
    { op: 'set', target: 'nope', color: 'red' }, // missing shape
    { op: 'sprinkle' } as unknown as Command, // unknown op
  ])
  check('alias circle -> ellipse', store.get('c1')?.kind === 'ellipse')
  check('bad input does not throw', report.results.length === 7)
  check('four hard failures reported', report.errors.length === 4, report.errors)
  check('errors are actionable', report.errors.every((e) => e.length > 20), report.errors)
  check('off-palette colour maps to a real one', store.get('brownbox')?.color === 'orange')
  check('coercion is reported', report.warnings.some((w) => w.includes('brown')), report.warnings)
  check('unknown colour falls back, shape survives', store.has('oddbox'), store.names())
  check('good command still applied', store.names().includes('c1'))
}

// ----------------------------------------------------- recovering from slips

console.log('recovering from slips')
{
  // Every case here is something a model actually sent. None of them should
  // cost the teacher the shape they asked for.
  const store = fresh()
  const report = execute(store, [
    { op: 'add', shape: 'ellipse', name: 'disc', fill: 'yellow' } as unknown as Command,
    { op: 'add', shape: 'rect', name: 'a' },
    { op: 'add', shape: 'rect', name: 'b' },
    { op: 'add', shape: 'arrow', from: 'a', to: 'b' } as unknown as Command,
    { op: 'add', shape: 'ellipse', name: 'squiggle', points: ['C3', 'D4', 'E3'] } as unknown as Command,
  ])
  const disc = store.get('disc')
  check('fill:"yellow" becomes a yellow solid', disc?.color === 'yellow' && disc?.fill === 'solid', disc)
  check('add arrow is re-routed to connect', store.all().some((s) => s.kind === 'arrow'), store.names())
  check('add with points is re-routed to draw', store.get('squiggle')?.kind === 'ink')
  check('no slip became a hard failure', report.ok, report.errors)
  check('each re-route is reported', report.warnings.length >= 3, report.warnings)

  // An arrow with no ends genuinely cannot be guessed — that one still fails,
  // but the message has to point somewhere useful.
  const stuck = execute(store, [{ op: 'add', shape: 'arrow' } as unknown as Command])
  check('arrow with no ends still fails', !stuck.ok)
  check('failure names both alternatives', /connect/.test(stuck.errors[0]) && /draw/.test(stuck.errors[0]), stuck.errors)
}

// ------------------------------------------------------------------- history

console.log('history')
{
  const store = fresh()
  execute(store, [{ op: 'add', shape: 'rect', name: 'a' }])
  execute(store, [{ op: 'add', shape: 'rect', name: 'b' }])
  store.undo()
  check('undo drops the last batch only', store.has('a') && !store.has('b'), store.names())
  store.redo()
  check('redo restores it', store.has('b'), store.names())
}

// ------------------------------------------------------------------- digest

console.log('digest')
{
  const store = fresh()
  execute(store, [
    { op: 'add', shape: 'text', name: 'title', at: 'A1', size: '6x1', text: 'Photosynthesis' },
    { op: 'add', shape: 'rect', name: 'box1', at: 'B3', size: '3x2', color: 'blue', text: 'Light' },
    { op: 'connect', from: 'title', to: 'box1' },
  ])
  const digest = digestBoard(store)
  console.log(digest.split('\n').map((l) => `    ${l}`).join('\n'))
  check('digest names every shape', ['title', 'box1', 'arrow1'].every((n) => digest.includes(n)))
  check('digest uses cell refs', digest.includes('A1') && digest.includes('B3'))
  check('digest lists free rows', digest.includes('FREE ROWS'))
  check('digest stays small', digest.length < 600, digest.length)
}

// -------------------------------------------------------------- ink reading

console.log('ink reading')
{
  // Draw a smiley the way a teacher would, in world units, and check the
  // digest describes it well enough for a model to work out what it is.
  const store = fresh()
  const circle = ring(400, 400, 250, 250)
  const leftEye = ring(320, 320, 18, 22)
  const rightEye = ring(480, 320, 18, 22)
  const smile = arc(400, 430, 130, 90, Math.PI * 0.15, Math.PI * 0.85)
  const nose = [
    { x: 400, y: 380 },
    { x: 400, y: 430 },
  ]
  execute(store, [
    { op: 'draw', name: 'ink1', points: circle, smooth: false },
    { op: 'draw', name: 'ink2', points: leftEye, smooth: false },
    { op: 'draw', name: 'ink3', points: rightEye, smooth: false },
    { op: 'draw', name: 'ink4', points: smile, smooth: false },
    { op: 'draw', name: 'ink5', points: nose, smooth: false },
  ], { author: 'human' })

  const drawings = analyseInk(store.all(), store.cellSize)
  check('touching strokes form one drawing', drawings.length === 1, drawings.length)

  const by = new Map(drawings[0].strokes.map((s) => [s.name, s]))
  const rel = drawings[0].relations
  check('face outline reads as a closed circle', by.get('ink1')?.class === 'circle', by.get('ink1')?.class)
  check('smile reads as an arc opening up', by.get('ink4')?.class === 'arc' && by.get('ink4')?.opens === 'up', by.get('ink4'))
  check('nose reads as a vertical line', by.get('ink5')?.class === 'line' && by.get('ink5')?.direction === 'vertical', by.get('ink5'))
  check('eyes are inside the face', rel.get('ink2')?.inside === 'ink1' && rel.get('ink3')?.inside === 'ink1')
  check('left eye is upper-left', rel.get('ink2')?.region === 'upper-left', rel.get('ink2'))
  check('right eye is upper-right', rel.get('ink3')?.region === 'upper-right', rel.get('ink3'))
  check('eyes are detected as a mirrored pair', rel.get('ink2')?.mirrors === 'ink3', rel.get('ink2'))
  check('smile sits in the lower half', rel.get('ink4')?.region?.startsWith('lower'), rel.get('ink4'))

  const digest = digestBoard(store)
  console.log(digest.split('\n').map((l) => `    ${l}`).join('\n'))
  check('digest describes rather than boxes the ink', !digest.includes('not yet recognized'))
  check('digest stays compact', digest.length < 900, digest.length)
}

// ------------------------------------------------------------- handwriting

console.log('handwriting')
{
  // A line of small strokes on a shared baseline is writing, not a picture.
  const store = fresh()
  const cmds: Command[] = []
  let x = 150
  for (const letters of [4, 2, 5]) {
    for (let l = 0; l < letters; l++) {
      const pts: { x: number; y: number }[] = []
      for (let k = 0; k < 6; k++) pts.push({ x: x + k * 4, y: 200 + 55 * (k / 5) })
      cmds.push({ op: 'draw', points: pts, smooth: false })
      x += 35
    }
    x += 60 // word gap
  }
  execute(store, cmds, { author: 'human' })

  const { drawings, handwriting } = analyseBoardInk(store.all(), store.cellSize)
  check('a baseline run is detected as handwriting', handwriting.length === 1, handwriting.length)
  check('writing is not also reported as a drawing', drawings.length === 0, drawings.length)
  check('all strokes belong to the block', handwriting[0]?.strokeCount === 11, handwriting[0]?.strokeCount)
  check('one line', handwriting[0]?.lines.length === 1)
  check('gaps split it into words', handwriting[0]?.lines[0].words.length === 3,
    handwriting[0]?.lines[0].words.map((w) => w.length))

  const digest = digestBoard(store)
  console.log(digest.split('\n').map((l) => `    ${l}`).join('\n'))
  check('digest calls it handwriting', digest.includes('HANDWRITING'))
  check('digest reports a reading', /reads(?: \(uncertain\))?: "/.test(digest), digest)
  check('digest no longer lists every stroke as a curve', !digest.includes('curve opening'))
  // These "letters" are plain diagonal strokes, so the matcher should be
  // honest about them rather than confidently inventing a word.
  check('nonsense scrawl is admitted to be uncertain', digest.includes('reads (uncertain)'), digest)

  // Anything the digest names must be usable as an anchor — the model will
  // reach for "h1", and it has every right to.
  const anchored = execute(store, [
    { op: 'draw', relativeTo: 'h1', points: [[0, 1.2], [1, 1.2]], smooth: false, name: 'rule' },
    { op: 'add', shape: 'note', name: 'hw', at: { of: 'h1', side: 'below' }, text: 'Homework' },
  ])
  check('a handwriting id works as a draw anchor', anchored.ok, anchored.errors)
  const block = handwriting[0].bounds
  const rule = store.bounds('rule')!
  check('the underline spans the writing', Math.abs(rule.w - block.w) < block.w * 0.2, { rule, block })
  check('the underline sits below the writing', rule.y > block.y + block.h * 0.9, { rule, block })
  check('the note lands under the writing', store.bounds('hw')!.y > block.y + block.h)

  // And as a target: selectors expand the id to its strokes.
  check('a handwriting id expands to its strokes', resolveTargets(store, 'h1').length === 11,
    resolveTargets(store, 'h1').length)
  execute(store, [{ op: 'set', target: 'h1', color: 'green' }])
  check('setting the block restyles every stroke',
    handwriting[0].lines[0].strokes.every((s) => store.get(s.name)?.color === 'green'))

}

// ------------------------------------------------------ reading real words

console.log('reading words')
{
  // Writing is what the board is for, so the digest has to actually say what
  // was written. These strokes are the glyph outlines themselves, drawn at a
  // believable size — a clean hand, which is the case that must never fail.
  const store = fresh()
  const cmds: Command[] = []
  let x = 150
  const CAP = 70
  for (const ch of 'CAT') {
    const glyph = GLYPHS.find((g) => g.char === ch)!
    const wide = CAP * (glyph.aspect ?? 0.7)
    for (const stroke of glyph.strokes) {
      cmds.push({
        op: 'draw',
        smooth: false,
        points: stroke.map(([gx, gy]) => ({ x: x + gx * wide, y: 200 + gy * CAP })),
      })
    }
    x += wide + CAP * 0.3
  }
  execute(store, cmds, { author: 'human' })

  const { handwriting } = analyseBoardInk(store.all(), store.cellSize)
  check('the word is one block', handwriting.length === 1, handwriting.length)
  const reading = handwriting[0]?.lines[0]?.reading ?? []
  check('one word', reading.length === 1, reading.length)
  check('three letters', reading[0]?.chars.length === 3, reading[0]?.chars.map((c) => c.char))
  check('it reads CAT', reading[0]?.text === 'CAT', reading[0]?.text)
  check('and confidently', reading[0]?.confidence >= CONFIDENT, reading[0]?.confidence)

  const digest = digestBoard(store)
  // A C and a c are the same drawing, and on a line of even height there is
  // nothing to judge case by, so the digest offers both — "[C|c|(]AT".
  check('the digest quotes the word', /reads: "\[?C.*AT"/.test(digest), digest)
  check('a confident reading is not drawn out', !digest.includes('drawn out'), digest)
}

// ------------------------------------------------- writing at board scale

console.log('big writing')
{
  // Traced off a real board: "HI" written with a stylus, letters nearly three
  // cells tall. This is the case the first version got wrong in every way — it
  // called the letters a drawing and described them as "a tree or umbrella" and
  // "a boat or bowl", because writing was assumed to be small and to run in
  // long lines. Teachers write big and short.
  const store = fresh()
  const traced = [
    [[302, 222], [308, 300], [314, 400], [322, 508]], // H, left stem
    [[400, 215], [408, 290], [420, 400], [430, 505]], // H, right stem
    [[288, 353], [330, 350], [380, 347], [425, 345]], // H, crossbar, overshooting left
    [[525, 228], [580, 227], [640, 228], [683, 227]], // I, top serif
    [[610, 232], [608, 320], [606, 430], [605, 505]], // I, stem
    [[538, 498], [590, 503], [640, 500], [675, 502]], // I, bottom serif
  ]
  execute(
    store,
    traced.map((pts) => ({
      op: 'draw' as const,
      smooth: false,
      points: pts.map(([x, y]) => ({ x, y })),
    })),
    { author: 'human' },
  )

  const { drawings, handwriting } = analyseBoardInk(store.all(), store.cellSize)
  check('letters three cells tall still count as writing', handwriting.length === 1, handwriting.length)
  check('and are not also described as a picture', drawings.length === 0, drawings.length)

  const reading = handwriting[0]?.lines[0]?.reading ?? []
  check('one word', reading.length === 1, reading.map((w) => w.text))
  check('two letters', reading[0]?.chars.length === 2, reading[0]?.chars.length)
  check('it reads HI', reading[0]?.text === 'HI', reading[0]?.text)
  // The crossbar of the H runs past both stems. Normalising on the bounding box
  // made an H score worse than an 8; normalising on where the ink actually sits
  // is what fixes it, so this is worth pinning down.
  check('the H is not beaten by a digit', reading[0]?.chars[0].char === 'H', reading[0]?.chars[0])
  check('confidently', reading[0]?.confidence >= CONFIDENT, reading[0]?.confidence)
}

// ------------------------------------------ pictures are not read as words

console.log('pictures stay pictures')
{
  // Letting writing be any size means shapes can now be mistaken for letters:
  // two boxes side by side match "OO" perfectly well, and only knowing that OO
  // is not a word tells you otherwise. These are the cases that caught it.
  const box = (x: number, y: number, w: number, h: number) =>
    [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
  const circle = (cx: number, cy: number, r: number) =>
    Array.from({ length: 25 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2
      return [cx + Math.cos(t) * r, cy + Math.sin(t) * r]
    })

  const drawnAs = (polys: number[][][]) => {
    const store = fresh()
    execute(
      store,
      polys.map((p) => ({
        op: 'draw' as const,
        smooth: false,
        points: p.map(([x, y]) => ({ x, y })),
      })),
      { author: 'human' },
    )
    return analyseBoardInk(store.all(), store.cellSize)
  }

  const boxes = drawnAs([box(200, 200, 180, 200), box(460, 200, 180, 200)])
  check('two boxes are not the word OO', boxes.handwriting.length === 0,
    boxes.handwriting[0]?.lines[0]?.reading.map((w) => w.text))

  // A sun is a big circle with little rays. Letters on a line are all roughly
  // one height, so the mismatch is what gives it away.
  const sun = drawnAs([
    circle(400, 300, 90),
    [[400, 180], [400, 140]], [[400, 420], [400, 460]],
    [[280, 300], [240, 300]], [[520, 300], [560, 300]],
  ])
  check('a sun is not a word', sun.handwriting.length === 0,
    sun.handwriting[0]?.lines[0]?.reading.map((w) => w.text))
  check('and it stays in one piece', sun.drawings.length === 1 && sun.drawings[0].strokes.length === 5,
    sun.drawings.map((d) => d.strokes.length))

  const house = drawnAs([box(250, 300, 220, 200), [[250, 300], [360, 180], [470, 300]]])
  check('a house is a drawing', house.handwriting.length === 0 && house.drawings.length === 1)
}

// ----------------------------------------------------------- draw and say

console.log('draw and say')
{
  const store = fresh()
  execute(store, [{ op: 'add', shape: 'rect', name: 'face', at: 'C3', size: '4x4' }])
  const report = execute(store, [
    { op: 'say', text: 'Adding hair.' },
    { op: 'draw', relativeTo: 'face', points: [[0.3, 0.05], [0.25, -0.2], [0.4, 0]], name: 'hair1' },
  ])
  check('say is carried back to the panel', report.messages[0] === 'Adding hair.', report.messages)
  const hair = store.get('hair1')
  check('relative fractions land on the shape', hair?.kind === 'ink')
  const box = store.bounds('hair1')!
  const face = store.bounds('face')!
  check('negative v draws above the shape', box.y < face.y, { box, face })
  check('stroke stays within the shape horizontally', box.x >= face.x && box.x <= face.x + face.w, box)
  check('smoothing expands the path', (store.get('hair1') as { points: unknown[] }).points.length > 10)

  // A closed 4-point stroke should come out round, not as a diamond: the
  // smoothing has to wrap across the seam.
  execute(store, [{
    op: 'draw',
    relativeTo: 'face',
    name: 'eye',
    points: [[0.5, 0.3], [0.56, 0.36], [0.5, 0.42], [0.44, 0.36]],
    closed: true,
  }])
  const eye = store.get('eye') as { points: { x: number; y: number }[] }
  const first = eye.points[0]
  const last = eye.points[eye.points.length - 1]
  check('closed stroke returns to its start', Math.hypot(last.x - first.x, last.y - first.y) < 1)
  check('closed stroke is smoothed all the way round', eye.points.length > 30, eye.points.length)
  const eyeBox = store.bounds('eye')!
  const inscribed = eyeBox.w * eyeBox.h * 0.5 // area of the diamond through the same 4 points
  check('smoothing rounds the corners out', polyArea(eye.points) > inscribed * 1.15, {
    area: polyArea(eye.points),
    inscribed,
  })

  const bad = execute(store, [{ op: 'draw', points: [[0.3, 0.1], [0.5, 0.2]] }])
  check('fractions without relativeTo are rejected', !bad.ok)
  check('rejection explains relativeTo', bad.errors[0].includes('relativeTo'), bad.errors)
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
