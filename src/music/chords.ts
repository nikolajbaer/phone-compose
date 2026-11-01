import { LETTERS, letterOf, mod, toMidi } from './theory'

// Names the chord formed by a set of notes, e.g. "C", "Am7", "G7/B".
// Matches the pitch classes against common chord shapes on every possible
// root, preferring the bass note as root and simpler chords.

interface Shape {
  suffix: string
  intervals: number[]
}

// Order matters: earlier shapes win ties (e.g. C6 vs Am7/C).
const SHAPES: Shape[] = [
  { suffix: '', intervals: [0, 4, 7] },
  { suffix: 'm', intervals: [0, 3, 7] },
  { suffix: '7', intervals: [0, 4, 7, 10] },
  { suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { suffix: 'm7', intervals: [0, 3, 7, 10] },
  { suffix: 'dim', intervals: [0, 3, 6] },
  { suffix: 'aug', intervals: [0, 4, 8] },
  { suffix: 'sus4', intervals: [0, 5, 7] },
  { suffix: 'sus2', intervals: [0, 2, 7] },
  { suffix: 'm7♭5', intervals: [0, 3, 6, 10] },
  { suffix: 'dim7', intervals: [0, 3, 6, 9] },
  { suffix: '6', intervals: [0, 4, 7, 9] },
  { suffix: 'm6', intervals: [0, 3, 7, 9] },
  { suffix: 'm(maj7)', intervals: [0, 3, 7, 11] },
  { suffix: '7sus4', intervals: [0, 5, 7, 10] },
  { suffix: 'add9', intervals: [0, 2, 4, 7] },
  { suffix: 'm(add9)', intervals: [0, 2, 3, 7] },
  { suffix: '9', intervals: [0, 2, 4, 7, 10] },
  { suffix: 'maj9', intervals: [0, 2, 4, 7, 11] },
  { suffix: 'm9', intervals: [0, 2, 3, 7, 10] },
  // Sevenths with the fifth left out, common in voicings.
  { suffix: '7', intervals: [0, 4, 10] },
  { suffix: 'maj7', intervals: [0, 4, 11] },
  { suffix: 'm7', intervals: [0, 3, 10] },
]

export interface ChordNote {
  step: number
  alter: number
}

const spell = (n: ChordNote) => LETTERS[letterOf(n.step)] + (n.alter > 0 ? '♯' : n.alter < 0 ? '♭' : '')

/** The chord name for these notes, or null if fewer than three pitch classes or no match. */
export function chordName(notes: ChordNote[]): string | null {
  if (notes.length < 3) return null
  const withMidi = notes.map((n) => ({ ...n, midi: toMidi(n.step, n.alter) })).sort((a, b) => a.midi - b.midi)
  const pcs = [...new Set(withMidi.map((n) => mod(n.midi, 12)))]
  if (pcs.length < 3) return null
  const bass = withMidi[0]
  const bassPc = mod(bass.midi, 12)

  let best: { root: number; shape: Shape; score: number } | null = null
  SHAPES.forEach((shape, order) => {
    if (shape.intervals.length !== pcs.length) return
    for (const root of pcs) {
      const rel = pcs.map((pc) => mod(pc - root, 12)).sort((a, b) => a - b)
      if (rel.every((v, i) => v === shape.intervals[i])) {
        const score = (root === bassPc ? 0 : 100) + order
        if (!best || score < best.score) best = { root, shape, score }
      }
    }
  })
  if (!best) return null
  const { root, shape } = best as { root: number; shape: Shape }
  const rootNote = withMidi.find((n) => mod(n.midi, 12) === root)!
  const name = spell(rootNote) + shape.suffix
  return root === bassPc ? name : `${name}/${spell(bass)}`
}
