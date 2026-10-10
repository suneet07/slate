import type { ColorName } from './types'

export interface Swatch {
  stroke: string
  solid: string
  tint: string
  text: string
}

/** One named palette shared by the UI and the renderer. Models say "blue". */
export const PALETTE: Record<ColorName, Swatch> = {
  black: { stroke: '#1d1d1d', solid: '#1d1d1d', tint: '#e8e8e8', text: '#1d1d1d' },
  grey: { stroke: '#8b8b8b', solid: '#9c9c9c', tint: '#eeeeee', text: '#5f5f5f' },
  red: { stroke: '#e03131', solid: '#e03131', tint: '#ffe3e3', text: '#c92a2a' },
  orange: { stroke: '#f76707', solid: '#f76707', tint: '#ffe8cc', text: '#d9480f' },
  yellow: { stroke: '#f0b429', solid: '#f0b429', tint: '#fff3bf', text: '#a1791a' },
  green: { stroke: '#2f9e44', solid: '#2f9e44', tint: '#d3f9d8', text: '#2b8a3e' },
  blue: { stroke: '#1971c2', solid: '#1971c2', tint: '#d0ebff', text: '#1864ab' },
  violet: { stroke: '#7048e8', solid: '#7048e8', tint: '#e5dbff', text: '#5f3dc4' },
  pink: { stroke: '#d6336c', solid: '#d6336c', tint: '#ffdeeb', text: '#a61e4d' },
  white: { stroke: '#c9c9c9', solid: '#ffffff', tint: '#ffffff', text: '#1d1d1d' },
}

export const COLOR_NAMES = Object.keys(PALETTE) as ColorName[]

export const FONT_SIZE = { s: 14, m: 20, l: 28, xl: 40 } as const

export const DASH_PATTERN = {
  solid: [] as number[],
  dashed: [10, 7],
  dotted: [2, 6],
}
