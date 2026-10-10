import { GridCell } from './types';

const GRID_WIDTH = 240;  // X spacing per column
const GRID_HEIGHT = 160; // Y spacing per row

/**
 * Converts pixel coordinates to a coarse spatial grid position string (e.g. "A1", "B3")
 */
export function coordsToGridPos(x: number, y: number): string {
  const col = Math.max(1, Math.floor(x / GRID_WIDTH) + 1);
  const rowIndex = Math.max(0, Math.floor(y / GRID_HEIGHT));
  
  // Convert row 0 -> A, 1 -> B, ..., 25 -> Z, 26 -> AA
  const rowStr = getRowLetter(rowIndex);
  return `${rowStr}${col}`;
}

/**
 * Converts a grid position string (e.g. "B2") back to canvas pixel coordinates
 */
export function gridPosToCoords(gridPos: string): { x: number; y: number } {
  const match = gridPos.match(/^([A-Z]+)(\d+)$/);
  if (!match) {
    return { x: 100, y: 100 };
  }
  
  const rowStr = match[1];
  const colNum = parseInt(match[2], 10);
  
  const rowIndex = getRowIndex(rowStr);
  const x = (colNum - 1) * GRID_WIDTH + 40;
  const y = rowIndex * GRID_HEIGHT + 40;
  
  return { x, y };
}

function getRowLetter(index: number): string {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

function getRowIndex(rowStr: string): number {
  let index = 0;
  for (let i = 0; i < rowStr.length; i++) {
    index = index * 26 + (rowStr.charCodeAt(i) - 64);
  }
  return index - 1;
}
