# 2. Coordinates — how position works

Everything you place lands somewhere. There are exactly three ways to say where,
and picking the right one is most of the job.

---

## The grid

The board is a spreadsheet. Columns are letters left to right, rows are numbers
top to bottom. `A1` is the top-left cell.

```
      A    B    C    D    E    F    G    H  ...
  1   .    .    .    .    .    .    .    .
  2   .    .    .    .    .    .    .    .
  3   .    .   [box1 3x2 ]   .    .    .
  4   .    .   [         ]   .    .    .
  5   .    .    .    .    .    .    .    .
```

A default board is 24 columns (A..X) by 14 rows. The digest states the real size
every time — read it there, do not assume.

One cell is 100 world units. You will almost never need that number; it matters
only for `dx`/`dy` nudges and raw `{"x":..,"y":..}` points.

**`at` is the top-left corner of the shape, not its centre.** A `3x2` shape at
`"C3"` occupies columns C–E and rows 3–4.

Sizes use the same units: `"4x2"` is four cells wide, two tall. `"3"` alone is
`3x3`.

---

## Three ways to say where

### 1. Say nothing — the board places it

```json
{"op":"add","shape":"note","text":"Homework p.42"}
```

The engine scans for free space and drops it there. **This is the best answer
whenever the exact spot does not matter.** It cannot overlap something else and
it cannot land off-board.

### 2. A cell reference — for deliberate placement

```json
{"op":"add","shape":"text","name":"title","at":"A1","size":"8x1"}
```

Use this when position carries meaning: a title at `A1`, a row of stages all on
row 3, a legend in the bottom-left.

### 3. Relative to another shape — for things that belong together

```json
{"op":"add","shape":"rect","at":"right of box1"}
{"op":"add","shape":"text","at":{"of":"box1","side":"below","gap":20}}
```

`side` is `right`, `left`, `above` or `below`; `gap` is in world units and
defaults to half a cell. This survives the anchor moving later, and it never
needs arithmetic.

### 4. On another shape, by fraction — for parts of a picture

```json
{"op":"add","shape":"ellipse","name":"eyeL","size":"0.6x0.7","at":{"of":"face","u":0.32,"v":0.36}}
```

`{"of": name, "u": .., "v": ..}` puts the **centre** of the new shape at that
fraction of the anchor's box: `u` across, `v` down, `[0.5,0.5]` dead centre.
This is how eyes go on a face, a doorknob on a door, a label in the middle of a
box — no coordinates, and it works wherever the anchor happens to be.

Note the difference from `draw`: `{of,u,v}` positions a **shape** by its centre;
`draw`'s fractions are the **points of a stroke**. Same fractions, same anchor.

---

## Converting a description into cells

Work in this order, and stop as soon as you have an answer.

| The teacher says | You use |
|---|---|
| "somewhere", "add a note" | no `at` at all |
| "at the top", "a title" | `"A1"` |
| "next to the circle" | `"right of circle1"` |
| "under the diagram" | `{"of":"<lowest shape>","side":"below"}` |
| "in the middle" | centre cell of the grid — for a 24x14 board, about `"K6"` |
| "bottom left" | column A, a row near the bottom — `"A11"` |
| "make a row of three" | place the first, then `stack` with `dir:"right"` |
| "on the smiley's face" | `draw` with `relativeTo` and fractions |

For centring a shape of size `w x h` cells on a board of `cols x rows`:
column index `= (cols - w) / 2`, row index `= (rows - h) / 2`, then convert the
column index to a letter (0=A, 1=B, 2=C, ...). A `4x2` shape on a 24x14 board
centres at column 10 (`K`), row 6 — `"K7"` once rows are counted from 1.

If that feels like arithmetic, it is — which is why the answer is usually to
place the first shape and then use `stack`, `grid` or `align` for everything
after it.

---

## Fractions — drawing on top of something

`draw` with `relativeTo` uses fractions of the named shape's box. This is the
only coordinate system you need for adding marks to an existing shape or
drawing, and it needs no knowledge of where that shape actually is.

```
        u=0      u=0.5      u=1
 v=-0.2  ·  ·  ·  ·  ·  ·  ·      above the shape
 v=0     +-----------------+      top edge
 v=0.25  |   O         O   |      eyes sit here
 v=0.5   |        |        |      centre
 v=0.75  |   \_________/   |      a smile sits here
 v=1     +-----------------+      bottom edge
 v=1.2   ·  ·  ·  ·  ·  ·  ·      below the shape
```

- `[0.5, 0.5]` is the centre of the shape.
- `v` below 0 is **above** the shape; `v` above 1 is **below** it.
- `u` below 0 is left of it; above 1 is right of it.
- Values are not clamped — `[0.5, -0.4]` is a long way above.

So a mouth on a face called `face` is:

```json
{"op":"draw","relativeTo":"face","points":[[0.28,0.62],[0.5,0.8],[0.72,0.62]]}
```

Three points: left corner, dip in the middle, right corner. The middle point
being *lower* (larger `v`) makes it a smile. Swap it higher and it is a frown.

---

## World units — the escape hatch

`{"x":420,"y":180}` points and `dx`/`dy` nudges are in world units, 100 per
cell, origin at the top-left of `A1`. Use them only when a cell is too coarse
and there is no shape to be relative to. Almost never necessary.
