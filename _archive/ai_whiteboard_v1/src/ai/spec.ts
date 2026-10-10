import commands from '../../shared/board-commands.md?raw'
import coordinates from '../../shared/board-coordinates.md?raw'
import reading from '../../shared/board-reading.md?raw'
import drawing from '../../shared/board-drawing.md?raw'
import mistakes from '../../shared/board-mistakes.md?raw'

export interface SpecDoc {
  id: string
  title: string
  body: string
}

/**
 * The model's instructions, in the order the backend concatenates them. One set
 * of files serves both the system prompt and the app's help panel, so what the
 * teacher reads is exactly what the model was told — no hidden second prompt.
 */
export const SPEC_DOCS: SpecDoc[] = [
  { id: 'commands', title: 'Commands', body: commands },
  { id: 'coordinates', title: 'Coordinates', body: coordinates },
  { id: 'reading', title: 'Reading the board', body: reading },
  { id: 'drawing', title: 'Drawing cookbook', body: drawing },
  { id: 'mistakes', title: 'Mistakes', body: mistakes },
]

export const COMMAND_SPEC: string = SPEC_DOCS.map((d) => d.body).join('\n\n---\n\n')
