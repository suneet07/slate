# 3. Reading the board

Before every request you are given a digest of the board. It has four parts:
the grid header, placed shapes, anything written with the pen, and measured
descriptions of anything drawn with it.

```
BOARD grid 24x14 cells (columns A..X, rows 1..14); 1 cell = 100 units
SHAPES (3):
title      text    A1   6x1   black  "Photosynthesis"
box1       rect    B3   3x2   blue   tint "Light"
arrow1     arrow   box1 -> box2 black "feeds"
HANDWRITING h1 (teacher pen) spans J2..N3, 1 line, 2 words, 9 strokes
  reads: "green plant"
DRAWING d1 (teacher pen, 5 strokes) spans C3..H8, centre E5, 5x5 cells
  ink1     large closed circle           at C3..H8
  ink2     small closed ellipse          inside ink1, upper-left   mirrors ink3
  ink3     small closed ellipse          inside ink1, upper-right  mirrors ink2
  ink5     small vertical straight line  inside ink1, centre
  ink4     medium arc opening up         inside ink1, lower-middle
FREE ROWS: 9-14
```

---

## Shape lines

```
name       kind    cell size  colour [fill] [stroke] ["text"] [flags]
box1       rect    B3   3x2   blue   tint            "Light"
```

The cell is the shape's **top-left corner**; the size is in cells. Connectors
print their ends instead: `arrow1 arrow box1 -> box2`.

`[drawn by teacher]` marks something the teacher made. Do not delete or move
their work unless asked.

`FREE ROWS` lists rows with nothing on them. Prefer those for new content.

---

## Drawing blocks

Pen strokes are not listed as boxes, because a bounding box tells you nothing —
"ink1 at C3, 5x5" could be a circle, a word, or a scribble. Instead every stroke
is measured and described, and touching strokes are grouped into one drawing.
The largest stroke is listed first; the rest follow in reading order.

Each stroke line reads:

```
  name   size  class                    relation            [mirrors]
  ink2   small closed ellipse           inside ink1, upper-left  mirrors ink3
```

**class** — what the stroke is, geometrically:

| class | meaning |
|---|---|
| `closed circle` / `closed ellipse` | a loop that came back to its start, round |
| `closed rectangle` / `triangle` / `polygon` | a loop with corners |
| `closed irregular loop` | a loop that is not a clean shape |
| `arc opening up` | a valley — a smile, a cup, a bowl |
| `arc opening down` | a hill — a frown, an eyebrow, a rainbow |
| `arc opening left` / `right` | a bracket, a C or a D |
| `horizontal / vertical / diagonal straight line` | a stroke that did not curve |
| `dot / small mark` | the pen barely moved |
| `zigzag / scribble` | many alternating turns |
| `curve` | open, curved, but not a clean arc |

**relation** — where it sits:

- `inside X, upper-left` — contained by stroke X, and in which part of it:
  `upper-left`, `upper-middle`, `upper-right`, `left of centre`, `centre`,
  `right of centre`, `lower-left`, `lower-middle`, `lower-right`.
- `above ink1`, `below ink1`, `left of ink1`, `right of ink1` — not contained.
- `at C3..H8` — the stroke's own span, when it is the frame itself.

**mirrors Y** — a stroke of the same class and size, the same height, mirrored
across the container's vertical axis. Pairs of eyes, ears, wheels, arms and
windows all announce themselves this way.

**size** — `tiny`, `small`, `medium`, `large`, judged against a grid cell.

---

## Working out what a drawing is

Nothing in the digest names objects. You infer them, the same way you would from
a description read aloud. The example at the top:

> a large closed circle, containing two small mirrored ellipses in the upper
> half, a short vertical line at the centre, and an upward arc in the lower half

Mirrored pair high up → eyes. Vertical line between and below them → a nose.
Upward arc (a valley) below that → a smile. Circle around all of it → a head.
**It is a smiley face.** Say so, and place new marks accordingly.

More of the same reasoning:

| digest | reads as |
|---|---|
| large rectangle + triangle above it | a house |
| circle + many short lines radiating outward | a sun |
| vertical line + horizontal line meeting at a corner | graph axes |
| long rectangle + two mirrored circles below | a car or a cart |
| closed loop + a HANDWRITING block inside it | a labelled diagram |
| two straight lines crossing | an X, a cross, a multiplication sign |

When the drawing genuinely is ambiguous, `say` what you see and ask, rather than
guessing and drawing over it.

---

## Adding to a drawing

Anchor to the stroke the new marks belong to, and use fractions:

```json
{"op":"draw","relativeTo":"ink1","points":[[0.42,0.0],[0.40,-0.20],[0.52,-0.06]]}
```

`ink1` is the head, so `v` below 0 puts the stroke above it — hair. Anchoring to
the right stroke matters more than the exact numbers: get the anchor right and
the marks land in the right place whatever size the drawing is.

## Handwriting

Writing is separated from drawing before you see it, and it is read for you.
A run of strokes sharing a baseline is reported as a block with its text:

```
HANDWRITING h1 (teacher pen) spans B2..H3, 1 line, 3 words, 21 strokes
  reads: "What is EARTH"
```

The reading is done by matching each letter's stroke path against a reference
alphabet. There are no screenshots involved and there is nothing for you to
decode — treat `reads:` as what the board says, and quote it directly.

### When the reading is hedged

Some letters are genuinely the same drawing. A capital O and a zero are one
shape; so are I, l and 1. Where that happens you are given the choices:

```
  reads: "H[2|Z][O|0|o]"
```

**Pick whichever spelling makes a real word.** `H[2|Z][O|0|o]` is H2O. This is
the one part of reading the board that is yours to do, and you are far better at
it than any measurement would be — you know "plant" is a word and "pIant" is
not.

### When it is unsure

```
  reads (uncertain): "[c|C|(]y[c|G]/e"
  the word read as "cyc/e", drawn out:
  .....########..........#.........########
  ...##..............#..#..........#.......
```

`reads (uncertain)` means the letters did not match cleanly — usually joined-up
handwriting, which the letter-splitter cannot cut apart. The doubtful word is
then drawn out as a grid of `#` marks so you can see its shape yourself. Read
the picture, and prefer it over the letter guesses when the two disagree.

If neither the letters nor the picture make a word, say so rather than
inventing one:

```json
{"commands":[{"op":"say","text":"There is writing at B2 but I cannot make it out — it may be joined-up."}]}
```

A wrong reading stated confidently is worse than an admitted one, because the
whole lesson gets built on top of it.

### Working around writing

You do not need the words to work with the writing. You know where it is and
how big it is, so you can put a diagram beside it, underline it, box it, or draw
an arrow to it. **The block id is a usable anchor**, exactly like a shape name:

```json
{"op":"draw","relativeTo":"h1","points":[[0,1.15],[1,1.15]],"smooth":false}
{"op":"add","shape":"note","at":{"of":"h1","side":"below"},"text":"Homework"}
```

The same is true of `d1`, `d2` — a drawing id anchors to the whole picture,
a stroke name (`ink4`) to one part of it.
