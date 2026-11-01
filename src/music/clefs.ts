import { MAX_POS, MIN_POS, MIDDLE_POS } from './theory'

// Clefs. Notes are stored at sounding pitch; a clef only changes which staff
// position a pitch is drawn on. Staff position 0 is the bottom line (see
// theory.ts); `bottomStep` is the diatonic step (C4 = 0) of that line. The
// "8vb" clefs are written an octave above how they sound (guitar, double
// bass) and carry a small 8 under the clef.

export type ClefId = 'treble' | 'treble8vb' | 'bass' | 'bass8vb' | 'alto'

export interface ClefDef {
  id: ClefId
  name: string
  glyph: string
  /** Staff position the clef glyph is anchored on (G line, F line, C line). */
  glyphPos: number
  bottomStep: number
  /** Key-signature positions relative to the treble clef's. */
  keyShift: number
}

export const CLEFS: ClefDef[] = [
  { id: 'treble', name: 'Treble', glyph: '', glyphPos: 2, bottomStep: 2, keyShift: 0 },
  { id: 'bass', name: 'Bass', glyph: '', glyphPos: 6, bottomStep: -10, keyShift: -2 },
  { id: 'alto', name: 'Alto (viola)', glyph: '', glyphPos: 4, bottomStep: -4, keyShift: -1 },
  { id: 'treble8vb', name: 'Treble 8vb (guitar)', glyph: '', glyphPos: 2, bottomStep: -5, keyShift: 0 },
  { id: 'bass8vb', name: 'Bass 8vb (double bass)', glyph: '', glyphPos: 6, bottomStep: -17, keyShift: -2 },
]

export function getClef(id: string | undefined): ClefDef {
  return CLEFS.find((c) => c.id === id) ?? CLEFS[0]
}

export const clefPosToStep = (clef: ClefDef, pos: number) => pos + clef.bottomStep
export const clefStepToPos = (clef: ClefDef, step: number) => step - clef.bottomStep

/** Lowest and highest steps you can tap on this clef's staff. */
export function clefRange(clef: ClefDef): { lo: number; hi: number } {
  return { lo: MIN_POS + clef.bottomStep, hi: MAX_POS + clef.bottomStep }
}

/** Whether a chord's stem points up: the note farthest from the middle line decides. */
export function stemUpFor(clef: ClefDef, steps: number[]): boolean {
  const poss = steps.map((s) => clefStepToPos(clef, s))
  return MIDDLE_POS - Math.min(...poss) >= Math.max(...poss) - MIDDLE_POS
}
