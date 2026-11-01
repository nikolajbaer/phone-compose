// Pitch and staff math. A pitch is stored the way notation thinks about it:
// a diatonic step (C4 = 0, D4 = 1, ... B4 = 6, C5 = 7) plus an alteration
// (-1 flat, 0 natural, +1 sharp). MIDI numbers are derived from that.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11]

/** Order in which sharps / flats appear in a key signature (as letter indices). */
export const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6] // F C G D A E B
export const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3] // B E A D G C F

export interface KeyDef {
  name: string
  /** Number of sharps (positive) or flats (negative). */
  fifths: number
}

export const KEYS: KeyDef[] = [
  { name: 'C major', fifths: 0 },
  { name: 'G major', fifths: 1 },
  { name: 'D major', fifths: 2 },
  { name: 'A major', fifths: 3 },
  { name: 'E major', fifths: 4 },
  { name: 'F major', fifths: -1 },
  { name: 'B♭ major', fifths: -2 },
  { name: 'E♭ major', fifths: -3 },
  { name: 'A♭ major', fifths: -4 },
]

export const mod = (n: number, m: number) => ((n % m) + m) % m

export function letterOf(step: number): number {
  return mod(step, 7)
}

export function octaveOf(step: number): number {
  return 4 + Math.floor(step / 7)
}

/** The alteration the key signature gives a letter. */
export function keyAlter(letter: number, fifths: number): number {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(letter) ? 1 : 0
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(letter) ? -1 : 0
  return 0
}

export function toMidi(step: number, alter: number): number {
  return 60 + 12 * Math.floor(step / 7) + LETTER_SEMITONES[letterOf(step)] + alter
}

export function pitchName(step: number, alter: number): string {
  const acc = alter > 0 ? '♯' : alter < 0 ? '♭' : ''
  return `${LETTERS[letterOf(step)]}${acc}${octaveOf(step)}`
}

// --- Treble staff -----------------------------------------------------------
// Staff position: 0 is the bottom line (E4), 1 the first space (F4) ... 8 the
// top line (F5). Even positions are lines, odd are spaces.

export const TREBLE_BOTTOM_STEP = 2 // E4
export const MIN_POS = -5 // G3, two ledger lines below
export const MAX_POS = 12 // C6, two ledger lines above
export const MIDDLE_POS = 4 // B4, middle line

export const posToStep = (pos: number) => pos + TREBLE_BOTTOM_STEP
export const stepToPos = (step: number) => step - TREBLE_BOTTOM_STEP

export const clampPos = (pos: number) => Math.max(MIN_POS, Math.min(MAX_POS, pos))
