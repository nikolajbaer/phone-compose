import { clefRange, getClef, type ClefId } from './clefs'
import type { Note, Part, Song } from './song'
import { editAllParts, setMeasures, uid } from './song'
import { keyAlter, letterOf } from './theory'

// Phrases: a range of bars taken from one staff, which can be named and
// saved with the song, repeated, or put into another track. Transposing can
// fit it to the target instrument's range or make a diatonic harmony line.

export interface Phrase {
  id: string
  name: string
  /** Length in bars. */
  length: number
  /** Notes with bar numbers counted from the phrase start. */
  notes: Note[]
  /** The clef it was taken from. */
  clef: ClefId
}

export type Transpose = 'fit' | 'none' | 'octaveUp' | 'octaveDown' | 'thirdBelow' | 'sixthBelow' | 'thirdAbove'

export const TRANSPOSE_OPTIONS: { id: Transpose; name: string }[] = [
  { id: 'fit', name: 'Fit to instrument' },
  { id: 'none', name: 'Same pitches' },
  { id: 'thirdBelow', name: 'Harmony: 3rd below' },
  { id: 'thirdAbove', name: 'Harmony: 3rd above' },
  { id: 'sixthBelow', name: 'Harmony: 6th below' },
  { id: 'octaveUp', name: 'Octave up' },
  { id: 'octaveDown', name: 'Octave down' },
]

/** Take bars [from, to] (inclusive) of a staff as a phrase. */
export function extractPhrase(part: Part, from: number, to: number, name = ''): Phrase {
  const notes = part.notes
    .filter((n) => n.measure >= from && n.measure <= to)
    .map(({ staff: _s, ...n }) => ({ ...n, measure: n.measure - from }))
  // Keep only ties that stay inside the phrase.
  const ids = new Set(notes.map((n) => n.id))
  return {
    id: uid(),
    name,
    length: to - from + 1,
    notes: notes.map((n) => (n.tieTo && !ids.has(n.tieTo) ? { ...n, tieTo: undefined } : n)),
    clef: part.clef,
  }
}

/** Move notes by diatonic steps, re-spelled in the key (a harmony line in the key). */
function diatonic(notes: Note[], steps: number, fifths: number): Note[] {
  return notes.map((n) => {
    const step = n.step + steps
    // Notes the key would not alter keep their own sharp or flat relative to the key.
    const offset = n.alter - keyAlter(letterOf(n.step), fifths)
    return { ...n, step, alter: keyAlter(letterOf(step), fifths) + offset }
  })
}

/** Shift by whole octaves so the notes sit as well as possible in a staff's range. */
function fitOctaves(notes: Note[], clef: ClefId): Note[] {
  if (!notes.length) return notes
  const { lo, hi } = clefRange(getClef(clef))
  const steps = notes.map((n) => n.step)
  const mid = (Math.min(...steps) + Math.max(...steps)) / 2
  const shift = Math.round(((lo + hi) / 2 - mid) / 7) * 7
  return notes.map((n) => ({ ...n, step: n.step + shift }))
}

export function transposeNotes(notes: Note[], how: Transpose, fifths: number, targetClef: ClefId): Note[] {
  switch (how) {
    case 'none':
      return notes
    case 'fit':
      return fitOctaves(notes, targetClef)
    case 'octaveUp':
      return notes.map((n) => ({ ...n, step: n.step + 7 }))
    case 'octaveDown':
      return notes.map((n) => ({ ...n, step: n.step - 7 }))
    case 'thirdBelow':
      return diatonic(notes, -2, fifths)
    case 'thirdAbove':
      return diatonic(notes, 2, fifths)
    case 'sixthBelow':
      return diatonic(notes, -5, fifths)
  }
}

/**
 * Put a phrase into a staff starting at a bar, replacing what is in those
 * bars. Notes get new ids (ties inside the phrase are kept).
 */
export function insertPhrase(part: Part, phrase: Phrase, at: number, how: Transpose = 'fit'): Part {
  const end = at + phrase.length - 1
  const moved = transposeNotes(phrase.notes, how, part.fifths, part.clef)
  const ids = new Map(moved.map((n) => [n.id, uid()]))
  const placed = moved
    .filter((n) => at + n.measure < part.measures)
    .map((n) => ({ ...n, id: ids.get(n.id)!, measure: at + n.measure, tieTo: n.tieTo ? ids.get(n.tieTo) : undefined }))
  const kept = part.notes.filter((n) => n.measure < at || n.measure > end)
  return { ...part, notes: [...kept, ...placed], updatedAt: Date.now() }
}

/** Make sure the song has at least `measures` bars (adding empty ones). */
export function ensureMeasures(song: Song, measures: number): Song {
  return measures > song.measures ? editAllParts(song, (p) => setMeasures(p, measures)) : song
}

export function savePhrase(song: Song, phrase: Phrase): Song {
  return { ...song, phrases: [...(song.phrases ?? []).filter((p) => p.id !== phrase.id), phrase], updatedAt: Date.now() }
}

export function deletePhrase(song: Song, id: string): Song {
  return { ...song, phrases: (song.phrases ?? []).filter((p) => p.id !== id), updatedAt: Date.now() }
}
