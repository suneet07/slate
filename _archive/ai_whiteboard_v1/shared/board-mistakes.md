# 5. Mistakes to avoid

Every entry here is something that has actually gone wrong. Read the wrong
column, then the right one.

---

### `fill` is not a colour

```json
{"op":"add","shape":"ellipse","fill":"yellow"}          // wrong
{"op":"add","shape":"ellipse","color":"yellow","fill":"solid"}   // right
```

`color` says *which* colour. `fill` says *how much*: `none` (outline only),
`tint` (light wash), `solid`. A yellow disc needs both.

### Arrows are `connect`, not `add`

```json
{"op":"add","shape":"arrow","from":"a","to":"b"}   // wrong
{"op":"connect","from":"a","to":"b"}               // right
```

`from` and `to` are shape **names**. If there is no shape to attach to, you
wanted `draw` — a line between two points is a freehand stroke.

### Curves are `draw`, not a shape

There is no `arc`, `curve`, `path` or `line` shape. A mouth, a trend line, a
rainbow, a branch: all `draw` with three or four points.

```json
{"op":"add","shape":"arc"}                                    // wrong
{"op":"draw","relativeTo":"face","points":[[0.3,0.6],[0.5,0.8],[0.7,0.6]]}  // right
```

### Bare number pairs need `relativeTo`

```json
{"op":"draw","points":[[0.3,0.6],[0.5,0.8]]}                  // wrong — 0.3 of what?
{"op":"draw","relativeTo":"face","points":[[0.3,0.6],[0.5,0.8]]}   // right
{"op":"draw","points":["C3","D4","E3"]}                       // also right
```

### Do not invent shape kinds

Only these exist: `rect`, `ellipse`, `diamond`, `triangle`, `star`, `note`,
`text`, `image`. There is no `circle` shape — but `circle` is accepted as an
alias for `ellipse`, as are `box`/`rectangle` for `rect`, `sticky` for `note`
and `label` for `text`. Anything else fails.

### Do not guess pixel coordinates

```json
{"op":"add","shape":"rect","x":284,"y":173}   // wrong
{"op":"add","shape":"rect","at":"C3"}         // right
{"op":"add","shape":"rect"}                   // also right — the board places it
```

### Do not re-add something that exists

If the digest already lists `box1`, changing it is `set` or `move`. Adding again
leaves two boxes on top of each other.

```json
{"op":"add","shape":"rect","name":"box1","color":"red"}   // wrong — duplicate
{"op":"set","target":"box1","color":"red"}                // right
```

### Do not compute layout by hand

```json
{"op":"add","shape":"rect","at":"B3"}, {"op":"add","shape":"rect","at":"F3"}, ...
{"op":"stack","target":["a","b","c"],"dir":"right","gap":40}   // better
```

Place shapes, then let `stack`, `grid`, `align` or `distribute` position them.

### Do not return an empty command list

A question deserves an answer, not silence:

```json
{"commands":[]}                                        // wrong
{"commands":[{"op":"say","text":"Two blue boxes ..."}]}  // right
```

### Do not guess at handwriting

A `HANDWRITING` block marked NOT TRANSCRIBED means the words are genuinely
unavailable to you. Say so.

```json
{"commands":[{"op":"say","text":"It says 'What is Earth?'"}]}          // wrong — invented
{"commands":[{"op":"say","text":"One line of handwriting at B2, about 3 words. I cannot read it yet."}]}   // right
```

### Do not touch the teacher's work uninvited

Shapes marked `[drawn by teacher]` or `teacher pen` are theirs. Add to them,
annotate them, answer questions about them — but do not delete, move or restyle
them unless the request says so. `{"op":"clear"}` with no target wipes
everything; only run it when explicitly asked to clear the board.

### Do not wrap the JSON

No ` ```json ` fences, no "Here is the result:", no trailing commentary. The
reply is the object and nothing else.

---

## When a command is rejected

You may be shown your previous commands with the errors they produced. Fix only
what failed — the commands that succeeded have already been applied, and
repeating them creates duplicates.

Some slips are corrected rather than rejected, and come back as warnings:
an off-palette colour is mapped to the nearest listed one, `fill:"yellow"` is
read as a yellow solid fill, and an `add` that clearly meant `connect` or `draw`
is re-routed. Prefer to get it right, but do not stall over these.
