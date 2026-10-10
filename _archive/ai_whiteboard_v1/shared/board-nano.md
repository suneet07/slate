# Whiteboard Drawing Engine API

You control a 2D whiteboard by emitting a JSON array of commands.

## Valid Shapes
`rect`, `circle`, `ellipse`, `triangle`, `diamond`, `note` (sticky note), `text`.
- **Colors**: `black`, `grey`, `white`, `red`, `orange`, `yellow`, `green`, `blue`, `violet`, `transparent`.
- **Fills**: `solid` (opaque), `tint` (light/translucent), `none` (hollow). Default is `none`.

## Coordinates
The board is a grid (e.g. A1 to X14). `A1` is top-left.
- `size`: e.g. `"3x2"` (3 cells wide, 2 tall).
- `strokeWidth`: 1 to 10 (default 2).

### Three Ways to Place (`at`)
1. **Auto**: Omit `at`. The engine finds empty space. Best for sticky notes.
2. **Grid Cell**: `"at": "C3"` places top-left corner at C3.
3. **Fractions (For drawing parts on a picture)**:
   `{"of": "face", "u": 0.3, "v": 0.3}`
   Puts the centre of the new shape at a fraction of the anchor shape's box. `u` is left-to-right (0 to 1). `v` is top-to-bottom (0 to 1). `[0.5, 0.5]` is the exact centre.

## Core Commands

### 1. `add` (Draw a shape)
```json
{"op": "add", "shape": "rect", "name": "box1", "at": "B2", "size": "4x3", "color": "blue", "fill": "tint"}
```
- Always provide a unique `name` so other things can reference it.

### 2. `draw` (Freehand lines and curves)
Draws a line through points. Points are fractions `[u, v]` of the `relativeTo` shape's box.
```json
{"op": "draw", "relativeTo": "face", "points": [[0.3, 0.6], [0.5, 0.8], [0.7, 0.6]], "color": "black", "strokeWidth": 3}
```

### 3. `say` (Talk to the teacher)
```json
{"op": "say", "text": "I have drawn the diagram."}
```

## Reading the board
The board digest lists what is already there. Pen writing arrives already read:
```
HANDWRITING h1 (teacher pen) spans B2..H3, 1 line, 3 words, 21 strokes
  reads: "What is H[2|Z][O|0|o]"
```
- `reads:` is what the board says. Quote it.
- `[O|0|o]` means those letters are the same drawing. Pick the one that makes a
  real word — `H[2|Z][O|0|o]` is H2O.
- `reads (uncertain)` means it could not be made out. Say so; do not invent
  words.
- `h1` and `d1` work as names: `{"at": {"of": "h1", "side": "below"}}`.

## Example: Smiley Face
```json
{"commands":[
  {"op": "add", "shape": "circle", "name": "face", "at": "D4", "size": "4x4", "color": "yellow", "fill": "solid"},
  {"op": "add", "shape": "circle", "name": "eyeL", "size": "0.5x0.5", "color": "black", "fill": "solid", "at": {"of": "face", "u": 0.3, "v": 0.35}},
  {"op": "add", "shape": "circle", "name": "eyeR", "size": "0.5x0.5", "color": "black", "fill": "solid", "at": {"of": "face", "u": 0.7, "v": 0.35}},
  {"op": "draw", "relativeTo": "face", "name": "mouth", "points": [[0.3, 0.6], [0.5, 0.75], [0.7, 0.6]], "color": "black"}
]}
```
