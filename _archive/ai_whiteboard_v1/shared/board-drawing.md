# 4. Drawing cookbook

Worked answers. Copy the structure, change the numbers and labels.

Two families of thing get drawn on a whiteboard, and they use different tools:

- **Diagrams** — boxes, labels, arrows between them. Built from `add` + `connect`
  + a layout verb.
- **Pictures** — faces, houses, suns, curves. Built from `add` for the round and
  straight parts, and `draw` for everything that bends.

Never try to make a picture out of arrows, and never try to make a diagram out
of freehand strokes.

---

## A smiley face

The head and eyes are ellipses; the mouth is a `draw` arc. Round parts are
shapes placed with `{of,u,v}`; the mouth is the one part that must be a stroke,
because nothing curves like that.

```json
{"commands":[
  {"op":"say","text":"Drawing a smiley face."},
  {"op":"add","shape":"ellipse","name":"face","at":"C2","size":"5x5","color":"yellow","fill":"tint","strokeWidth":3},
  {"op":"add","shape":"ellipse","name":"eyeL","size":"0.6x0.7","color":"black","fill":"solid","at":{"of":"face","u":0.33,"v":0.36}},
  {"op":"add","shape":"ellipse","name":"eyeR","size":"0.6x0.7","color":"black","fill":"solid","at":{"of":"face","u":0.67,"v":0.36}},
  {"op":"draw","relativeTo":"face","name":"mouth","points":[[0.27,0.60],[0.5,0.78],[0.73,0.60]],"color":"black","strokeWidth":4}
]}
```

Mirror the eyes by mirroring `u` about 0.5 — `0.33` and `0.67`. Everything is
anchored to `face`, so the whole thing can be moved or resized later and the
features stay put.

The mouth's middle point is **lower** than its ends — that is what makes it a
smile. Raise the middle instead (`[[0.27,0.75],[0.5,0.58],[0.73,0.75]]`) for a
sad face.

Hair, once a face exists: several short strokes with negative `v`.

```json
{"commands":[
  {"op":"draw","relativeTo":"face","points":[[0.25,0.06],[0.20,-0.14],[0.32,-0.04]],"color":"black"},
  {"op":"draw","relativeTo":"face","points":[[0.42,0.00],[0.40,-0.20],[0.52,-0.06]],"color":"black"},
  {"op":"draw","relativeTo":"face","points":[[0.60,0.00],[0.62,-0.20],[0.72,-0.02]],"color":"black"},
  {"op":"draw","relativeTo":"face","points":[[0.78,0.06],[0.84,-0.12],[0.88,0.10]],"color":"black"}
]}
```

---

## A sun

```json
{"commands":[
  {"op":"add","shape":"ellipse","name":"sun","at":"C2","size":"3x3","color":"yellow","fill":"solid"},
  {"op":"draw","relativeTo":"sun","points":[[0.5,-0.05],[0.5,-0.35]],"smooth":false,"color":"orange"},
  {"op":"draw","relativeTo":"sun","points":[[1.05,0.5],[1.35,0.5]],"smooth":false,"color":"orange"},
  {"op":"draw","relativeTo":"sun","points":[[0.5,1.05],[0.5,1.35]],"smooth":false,"color":"orange"},
  {"op":"draw","relativeTo":"sun","points":[[-0.05,0.5],[-0.35,0.5]],"smooth":false,"color":"orange"},
  {"op":"draw","relativeTo":"sun","points":[[0.9,0.1],[1.15,-0.15]],"smooth":false,"color":"orange"},
  {"op":"draw","relativeTo":"sun","points":[[0.1,0.1],[-0.15,-0.15]],"smooth":false,"color":"orange"}
]}
```

Rays are straight strokes just outside the disc, so `smooth:false`.

---

## A house

```json
{"commands":[
  {"op":"add","shape":"rect","name":"walls","at":"D5","size":"4x3","color":"orange"},
  {"op":"add","shape":"triangle","name":"roof","at":"D3","size":"4x2","color":"red","fill":"tint"},
  {"op":"add","shape":"rect","name":"door","size":"1x1.5","color":"orange","fill":"solid","at":{"of":"walls","u":0.3,"v":0.75}},
  {"op":"add","shape":"rect","name":"window","size":"1x1","color":"blue","fill":"tint","at":{"of":"walls","u":0.7,"v":0.35}}
]}
```

The roof sits directly above the walls because its cell row is the walls' row
minus its own height. Door and window are placed by fraction of the walls, so
they stay put if the house is moved.

---

## A tick and a cross

```json
{"commands":[
  {"op":"draw","relativeTo":"box1","points":[[0.2,0.5],[0.42,0.75],[0.8,0.2]],"smooth":false,"color":"green","strokeWidth":5},
  {"op":"draw","relativeTo":"box2","points":[[0.25,0.25],[0.75,0.75]],"smooth":false,"color":"red","strokeWidth":5},
  {"op":"draw","relativeTo":"box2","points":[[0.75,0.25],[0.25,0.75]],"smooth":false,"color":"red","strokeWidth":5}
]}
```

---

## Graph axes

```json
{"commands":[
  {"op":"add","shape":"rect","name":"plot","at":"C3","size":"8x6","color":"grey"},
  {"op":"draw","relativeTo":"plot","points":[[0,0],[0,1],[1,1]],"smooth":false,"color":"black","strokeWidth":3},
  {"op":"add","shape":"text","name":"ylabel","at":{"of":"plot","side":"left"},"size":"2x1","text":"y","textSize":"m"},
  {"op":"add","shape":"text","name":"xlabel","at":{"of":"plot","side":"below"},"size":"2x1","text":"x","textSize":"m"},
  {"op":"draw","relativeTo":"plot","name":"curve","points":[[0.05,0.9],[0.4,0.6],[0.7,0.25],[0.95,0.1]],"color":"blue","strokeWidth":3}
]}
```

A trend line is one smoothed `draw` across the plot box. Fractions make it
independent of where the plot ended up.

---

## A left-to-right process

```json
{"commands":[
  {"op":"add","shape":"text","name":"title","at":"A1","size":"8x1","text":"The Water Cycle","textSize":"xl"},
  {"op":"add","shape":"rect","name":"evap","at":"B3","size":"3x2","text":"Evaporation","color":"blue","fill":"tint"},
  {"op":"add","shape":"rect","name":"cond","at":"F3","size":"3x2","text":"Condensation","color":"violet","fill":"tint"},
  {"op":"add","shape":"rect","name":"precip","at":"J3","size":"3x2","text":"Precipitation","color":"green","fill":"tint"},
  {"op":"connect","from":"evap","to":"cond"},
  {"op":"connect","from":"cond","to":"precip"},
  {"op":"connect","from":"precip","to":"evap","bend":80,"text":"repeats"}
]}
```

The last arrow's `bend` keeps the return path clear of the boxes.

---

## A top-down flowchart

```json
{"commands":[
  {"op":"add","shape":"ellipse","name":"start","size":"3x1.5","text":"Start","color":"green","fill":"tint"},
  {"op":"add","shape":"diamond","name":"check","size":"3x2","text":"Correct?","color":"orange","fill":"tint"},
  {"op":"add","shape":"rect","name":"yes","size":"3x1.5","text":"Move on","color":"blue","fill":"tint"},
  {"op":"stack","target":["start","check","yes"],"dir":"down","gap":50,"at":"C2"},
  {"op":"connect","from":"start","to":"check"},
  {"op":"connect","from":"check","to":"yes","text":"yes"}
]}
```

Place first, `stack` second, `connect` last. That order never needs arithmetic.

---

## Tidying what is already there

```json
{"commands":[
  {"op":"align","target":["evap","cond","precip"],"edge":"top"},
  {"op":"distribute","target":["evap","cond","precip"],"axis":"x","gap":60}
]}
```

## Answering rather than drawing

```json
{"commands":[{"op":"say","text":"A hand-drawn smiley face: a large circle with two eyes, a nose and a smile."}]}
```
