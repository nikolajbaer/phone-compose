import { LETTERS, MAX_POS, MIN_POS, keyAlter, mod, posToStep, toMidi } from './theory'

// Builds the notes of a chord from a root, a quality and an inversion, spelled
// properly (G7 is G B D F, never G B D E♯), in close position with the bass
// note near a chosen pitch and the whole chord kept on the staff.

/** A chord tone: how many letters above the root, and how many semitones. */
type Tone = [steps: number, semitones: number]

export interface ChordQuality {
  id: string
  /** Shown in chord symbols, e.g. "m7". */
  suffix: string
  /** Shown on the picker button. */
  label: string
  tones: Tone[]
}

const R: Tone = [0, 0]
const M3: Tone = [2, 4]
const m3: Tone = [2, 3]
const P5: Tone = [4, 7]
const d5: Tone = [4, 6]
const A5: Tone = [4, 8]

export const QUALITIES: ChordQuality[] = [
  { id: 'maj', suffix: '', label: 'Major', tones: [R, M3, P5] },
  { id: 'min', suffix: 'm', label: 'Minor', tones: [R, m3, P5] },
  { id: '7', suffix: '7', label: '7', tones: [R, M3, P5, [6, 10]] },
  { id: 'maj7', suffix: 'maj7', label: 'maj7', tones: [R, M3, P5, [6, 11]] },
  { id: 'm7', suffix: 'm7', label: 'm7', tones: [R, m3, P5, [6, 10]] },
  { id: 'dim', suffix: 'dim', label: 'dim', tones: [R, m3, d5] },
  { id: 'aug', suffix: 'aug', label: 'aug', tones: [R, M3, A5] },
  { id: 'sus2', suffix: 'sus2', label: 'sus2', tones: [R, [1, 2], P5] },
  { id: 'sus4', suffix: 'sus4', label: 'sus4', tones: [R, [3, 5], P5] },
  { id: '6', suffix: '6', label: '6', tones: [R, M3, P5, [5, 9]] },
  { id: 'm6', suffix: 'm6', label: 'm6', tones: [R, m3, P5, [5, 9]] },
  { id: 'm7b5', suffix: 'm7♭5', label: 'm7♭5', tones: [R, m3, d5, [6, 10]] },
  { id: 'dim7', suffix: 'dim7', label: 'dim7', tones: [R, m3, d5, [6, 9]] },
  { id: 'add9', suffix: 'add9', label: 'add9', tones: [R, M3, P5, [8, 14]] },
  { id: '9', suffix: '9', label: '9', tones: [R, M3, P5, [6, 10], [8, 14]] },
]

export const getQuality = (id: string) => QUALITIES.find((q) => q.id === id) ?? QUALITIES[0]

export interface ChordSpec {
  /** Root letter, 0 = C ... 6 = B. */
  letter: number
  /** Root alteration: -1 flat, 0 natural, +1 sharp. */
  alter: number
  quality: string
  /** 0 root position, 1 first inversion (3rd in the bass), 2 second, 3 third. */
  inversion: number
}

export interface Pitch {
  step: number
  alter: number
}

/** Tones that can be in the bass: the chord's first four (not the 9th). */
export function inversionCount(quality: string): number {
  return Math.min(4, getQuality(quality).tones.filter(([s]) => s < 7).length)
}

/** Spell a tone above a root on a given step. */
function spellTone(rootStep: number, rootAlter: number, [steps, semis]: Tone): Pitch {
  const step = rootStep + steps
  const rootMidi = toMidi(rootStep, rootAlter)
  return { step, alter: rootMidi + semis - toMidi(step, 0) }
}

/**
 * The chord's notes, low to high. The bass is put in the octave nearest to
 * `bassStep`; then the chord is moved by octaves if needed to stay between
 * G3 and C6.
 */
export function voiceChord(spec: ChordSpec, bassStep: number): Pitch[] {
  const q = getQuality(spec.quality)
  const inv = Math.min(spec.inversion, inversionCount(spec.quality) - 1)
  const core = q.tones.filter(([s]) => s < 7)
  const extra = q.tones.filter(([s]) => s >= 7)
  // Rotate so the chosen tone is in the bass; tones that wrap go up an octave.
  const order: Tone[] = [...core.slice(inv), ...core.slice(0, inv).map(([s, t]): Tone => [s + 7, t + 12])]
  const bassTone = order[0]
  // Root step such that the bass lands nearest bassStep.
  const bassLetter = mod(spec.letter + bassTone[0], 7)
  const bassStepNear = bassStep + ((mod(bassLetter - mod(bassStep, 7) + 3, 7) - 3))
  let rootStep = bassStepNear - bassTone[0]
  const build = (rs: number) =>
    [...order, ...extra.map(([s, t]): Tone => [s + (inv > 0 ? 7 : 0), t + (inv > 0 ? 12 : 0)])].map((tone) =>
      spellTone(rs, spec.alter, tone),
    )
  let notes = build(rootStep)
  const lo = posToStep(MIN_POS)
  const hi = posToStep(MAX_POS)
  while (Math.min(...notes.map((n) => n.step)) < lo) notes = build((rootStep += 7))
  while (Math.max(...notes.map((n) => n.step)) > hi && Math.min(...notes.map((n) => n.step)) - 7 >= lo) {
    notes = build((rootStep -= 7))
  }
  return notes.sort((a, b) => a.step - b.step)
}

/** The chord symbol for a spec, e.g. "G7/B". */
export function specName(spec: ChordSpec): string {
  const q = getQuality(spec.quality)
  const acc = (a: number) => (a > 0 ? '♯' : a < 0 ? '♭' : '')
  const name = LETTERS[spec.letter] + acc(spec.alter) + q.suffix
  const inv = Math.min(spec.inversion, inversionCount(spec.quality) - 1)
  if (!inv) return name
  const core = q.tones.filter(([s]) => s < 7)
  const bass = spellTone(spec.letter, spec.alter, core[inv])
  return `${name}/${LETTERS[mod(bass.step, 7)]}${acc(bass.alter)}`
}

// --- chords of the key -------------------------------------------------------

const MAJOR_DEGREES: { numeral: string; quality: string }[] = [
  { numeral: 'I', quality: 'maj' },
  { numeral: 'ii', quality: 'min' },
  { numeral: 'iii', quality: 'min' },
  { numeral: 'IV', quality: 'maj' },
  { numeral: 'V', quality: 'maj' },
  { numeral: 'vi', quality: 'min' },
  { numeral: 'vii°', quality: 'dim' },
]

/** The seven triads of a major key (by its number of sharps/flats). */
export function diatonicChords(fifths: number): (ChordSpec & { numeral: string })[] {
  const tonic = mod(4 * fifths, 7) // each fifth is four letters up
  return MAJOR_DEGREES.map((d, i) => {
    const letter = mod(tonic + i, 7)
    return { numeral: d.numeral, letter, alter: keyAlter(letter, fifths), quality: d.quality, inversion: 0 }
  })
}
