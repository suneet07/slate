/**
 * Spreadsheet-style coordinate system.
 *
 * The whole point: an LLM is far better at "put the box at C3" than at
 * "put the box at x=284, y=173". Columns are letters (A, B, ... Z, AA, AB),
 * rows are 1-based numbers. Sizes are expressed the same way: "4x2" means
 * four cells wide, two cells tall.
 */

export interface GridPos {
  col: number // 0-based
  row: number // 0-based
}

const A = 'A'.charCodeAt(0)

/** 0 -> "A", 25 -> "Z", 26 -> "AA" */
export function colToLetters(col: number): string {
  let n = col
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(A + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. Returns null on bad input. */
export function lettersToCol(letters: string): number | null {
  if (!/^[A-Za-z]+$/.test(letters)) return null
  let n = 0
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - A + 1)
  }
  return n - 1
}

/** Parses "C3", "c3", "AA12". Returns null if it isn't a cell reference. */
export function parseCell(ref: string): GridPos | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim())
  if (!m) return null
  const col = lettersToCol(m[1])
  const row = parseInt(m[2], 10) - 1
  if (col === null || row < 0) return null
  return { col, row }
}

export function formatCell(pos: GridPos): string {
  return `${colToLetters(pos.col)}${pos.row + 1}`
}

/**
 * Parses a size string: "4x2" (cells), or "4" (square). Returns cell counts.
 * Falsy / unparseable input returns null so the caller can apply a default.
 */
export function parseSize(size: string): { cols: number; rows: number } | null {
  const s = size.trim().toLowerCase()
  const m = /^(\d+(?:\.\d+)?)\s*[x*×]\s*(\d+(?:\.\d+)?)$/.exec(s)
  if (m) return { cols: parseFloat(m[1]), rows: parseFloat(m[2]) }
  const n = /^(\d+(?:\.\d+)?)$/.exec(s)
  if (n) return { cols: parseFloat(n[1]), rows: parseFloat(n[1]) }
  return null
}

export function cellToWorld(pos: GridPos, cellSize: number): { x: number; y: number } {
  return { x: pos.col * cellSize, y: pos.row * cellSize }
}

export function worldToCell(x: number, y: number, cellSize: number): GridPos {
  return { col: Math.round(x / cellSize), row: Math.round(y / cellSize) }
}

/** Nearest cell reference for a world point — used when describing the board. */
export function worldToCellRef(x: number, y: number, cellSize: number): string {
  const p = worldToCell(x, y, cellSize)
  return formatCell({ col: Math.max(0, p.col), row: Math.max(0, p.row) })
}

export function snapToGrid(v: number, cellSize: number, divisions = 2): number {
  const step = cellSize / divisions
  return Math.round(v / step) * step
}
