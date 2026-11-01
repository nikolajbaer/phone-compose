import { keyAlter, letterOf, toMidi } from './theory'

export interface Note {
  id: string
  /** Measure index, from 0. */
  measure: number
  /** Beat within the measure, from 0. Every note is a quarter note for now. */
  beat: number
  /** Diatonic step, C4 = 0 (see theory.ts). */
  step: number
  /** -1 flat, 0 natural, +1 sharp. */
  alter: number
}

export type InstrumentId = 'square' | 'triangle' | 'sawtooth' | 'bell' | 'organ'

export const INSTRUMENTS: { id: InstrumentId; name: string }[] = [
  { id: 'square', name: 'Chip square' },
  { id: 'triangle', name: 'Soft triangle' },
  { id: 'sawtooth', name: 'Saw lead' },
  { id: 'bell', name: 'FM bell' },
  { id: 'organ', name: 'Organ' },
]

export interface Song {
  id: string
  title: string
  tempo: number
  beatsPerMeasure: number
  /** Key signature: sharps (+) or flats (-). */
  fifths: number
  measures: number
  instrument: InstrumentId
  notes: Note[]
  createdAt: number
  updatedAt: number
}

export interface NewSongOptions {
  title: string
  tempo: number
  beatsPerMeasure: number
  fifths: number
  instrument: InstrumentId
  measures?: number
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export function createSong(opts: NewSongOptions): Song {
  const now = Date.now()
  return {
    id: uid(),
    title: opts.title.trim() || 'Untitled song',
    tempo: opts.tempo,
    beatsPerMeasure: opts.beatsPerMeasure,
    fifths: opts.fifths,
    measures: opts.measures ?? 4,
    instrument: opts.instrument,
    notes: [],
    createdAt: now,
    updatedAt: now,
  }
}

const touch = (song: Song, patch: Partial<Song>): Song => ({ ...song, ...patch, updatedAt: Date.now() })

/** Add a quarter note at a beat, spelled by the key signature. Ignores exact duplicates. */
export function addNote(song: Song, measure: number, beat: number, step: number): Song {
  if (song.notes.some((n) => n.measure === measure && n.beat === beat && n.step === step)) return song
  const note: Note = { id: uid(), measure, beat, step, alter: keyAlter(letterOf(step), song.fifths) }
  return touch(song, { notes: [...song.notes, note] })
}

export function removeNote(song: Song, id: string): Song {
  return touch(song, { notes: song.notes.filter((n) => n.id !== id) })
}

/** Move a note to another step (re-spelled by the key); drops it if that spot is taken. */
export function moveNote(song: Song, id: string, step: number): Song {
  const note = song.notes.find((n) => n.id === id)
  if (!note) return song
  const taken = song.notes.some((n) => n.id !== id && n.measure === note.measure && n.beat === note.beat && n.step === step)
  if (taken) return removeNote(song, id)
  return touch(song, {
    notes: song.notes.map((n) => (n.id === id ? { ...n, step, alter: keyAlter(letterOf(step), song.fifths) } : n)),
  })
}

export function setMeasures(song: Song, measures: number): Song {
  const m = Math.max(1, Math.min(256, measures))
  return touch(song, { measures: m, notes: song.notes.filter((n) => n.measure < m) })
}

export function setBeatsPerMeasure(song: Song, beats: number): Song {
  return touch(song, { beatsPerMeasure: beats, notes: song.notes.filter((n) => n.beat < beats) })
}

/** Change key and re-spell every note to the new key signature. */
export function setKey(song: Song, fifths: number): Song {
  return touch(song, { fifths, notes: song.notes.map((n) => ({ ...n, alter: keyAlter(letterOf(n.step), fifths) })) })
}

export function updateSong(song: Song, patch: Partial<Pick<Song, 'title' | 'tempo' | 'instrument'>>): Song {
  return touch(song, patch)
}

export function notesAt(song: Song, measure: number, beat: number): Note[] {
  return song.notes.filter((n) => n.measure === measure && n.beat === beat)
}

export const noteMidi = (n: Note) => toMidi(n.step, n.alter)

/** Absolute beat index of a note from the start of the song. */
export const absoluteBeat = (song: Song, n: Note) => n.measure * song.beatsPerMeasure + n.beat
