import { TPQ, restsFor, type RestPiece } from './duration'
import { keyAlter, letterOf, toMidi } from './theory'

// A song is one voice on a treble staff. Notes that start at the same tick of
// a measure form a chord and share a duration; gaps between chords are rests.

export interface Note {
  id: string
  /** Measure index, from 0. */
  measure: number
  /** Start within the measure, in ticks (TPQ per quarter note). */
  tick: number
  /** Length in ticks. */
  dur: number
  /** Diatonic step, C4 = 0 (see theory.ts). */
  step: number
  /** -1 flat, 0 natural, +1 sharp. */
  alter: number
}

/** An id from INSTRUMENTS (instruments.ts). */
export type InstrumentId = string

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

/** Upgrade songs saved before durations existed (notes had a `beat`, all quarters). */
export function normalizeSong(song: Song): Song {
  const notes = song.notes.map((n) => {
    const old = n as Note & { beat?: number }
    if (typeof old.tick === 'number' && typeof old.dur === 'number') return n
    const { beat, ...rest } = old
    return { ...rest, tick: (beat ?? 0) * TPQ, dur: TPQ }
  })
  return { ...song, notes }
}

export const measureTicks = (song: Song) => song.beatsPerMeasure * TPQ

const touch = (song: Song, patch: Partial<Song>): Song => ({ ...song, ...patch, updatedAt: Date.now() })

export interface Chord {
  tick: number
  dur: number
  notes: Note[]
}

export type MeasureEvent = ({ kind: 'chord' } & Chord) | ({ kind: 'rest' } & RestPiece)

export function chordsInMeasure(song: Song, measure: number): Chord[] {
  const byTick = new Map<number, Note[]>()
  for (const n of song.notes) {
    if (n.measure !== measure) continue
    byTick.set(n.tick, [...(byTick.get(n.tick) ?? []), n])
  }
  return [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, notes]) => ({ tick, dur: notes[0].dur, notes: notes.sort((a, b) => a.step - b.step) }))
}

/** Chords and the rests between them, in time order, filling the measure. */
export function measureEvents(song: Song, measure: number): MeasureEvent[] {
  const out: MeasureEvent[] = []
  let p = 0
  for (const c of chordsInMeasure(song, measure)) {
    if (c.tick > p) out.push(...restsFor(p, c.tick).map((r) => ({ kind: 'rest' as const, ...r })))
    out.push({ kind: 'chord', ...c })
    p = Math.max(p, c.tick + c.dur)
  }
  const end = measureTicks(song)
  if (p < end) out.push(...restsFor(p, end).map((r) => ({ kind: 'rest' as const, ...r })))
  return out
}

export type EditResult = { song: Song; error?: undefined } | { song: Song; error: string }

/** Clear room for a chord at [tick, tick+dur): later chords starting inside it are overwritten. */
function clearSpan(notes: Note[], measure: number, tick: number, dur: number, keepTick: boolean) {
  return notes.filter((n) => n.measure !== measure || n.tick < tick || n.tick >= tick + dur || (keepTick && n.tick === tick))
}

/**
 * Put a note at a tick. If a chord already starts there the pitch joins it
 * (keeping the chord's length); otherwise a new chord of `dur` is written,
 * overwriting anything it covers, like note input in MuseScore.
 */
export function placeNote(song: Song, measure: number, tick: number, dur: number, step: number): EditResult {
  const alter = keyAlter(letterOf(step), song.fifths)
  const chord = song.notes.filter((n) => n.measure === measure && n.tick === tick)
  if (chord.length) {
    if (chord.some((n) => n.step === step)) return { song }
    const note: Note = { id: uid(), measure, tick, dur: chord[0].dur, step, alter }
    return { song: touch(song, { notes: [...song.notes, note] }) }
  }
  if (song.notes.some((n) => n.measure === measure && n.tick < tick && n.tick + n.dur > tick)) {
    return { song, error: 'Another note is still sounding there.' }
  }
  if (tick + dur > measureTicks(song)) return { song, error: 'That note is too long to fit in the rest of the measure.' }
  const note: Note = { id: uid(), measure, tick, dur, step, alter }
  return { song: touch(song, { notes: [...clearSpan(song.notes, measure, tick, dur, false), note] }) }
}

/**
 * Write a whole chord (pitches with their own spelling) at a tick. If a chord
 * already starts there its pitches are replaced and its length kept;
 * otherwise a new chord of `dur` is written, like placeNote.
 */
export function placeChord(
  song: Song,
  measure: number,
  tick: number,
  dur: number,
  pitches: { step: number; alter: number }[],
): EditResult {
  const existing = song.notes.find((n) => n.measure === measure && n.tick === tick)
  if (!existing) {
    if (song.notes.some((n) => n.measure === measure && n.tick < tick && n.tick + n.dur > tick)) {
      return { song, error: 'Another note is still sounding there.' }
    }
    if (tick + dur > measureTicks(song)) return { song, error: 'That chord is too long to fit in the rest of the measure.' }
  }
  const len = existing ? existing.dur : dur
  const others = existing
    ? song.notes.filter((n) => !(n.measure === measure && n.tick === tick))
    : clearSpan(song.notes, measure, tick, len, false)
  const seen = new Set<number>()
  const chord: Note[] = pitches
    .filter((p) => !seen.has(p.step) && seen.add(p.step))
    .map((p) => ({ id: uid(), measure, tick, dur: len, step: p.step, alter: p.alter }))
  return { song: touch(song, { notes: [...others, ...chord] }) }
}

/** Change the length of the chord a note belongs to. */
export function setChordDuration(song: Song, noteId: string, dur: number): EditResult {
  const note = song.notes.find((n) => n.id === noteId)
  if (!note) return { song }
  if (note.dur === dur) return { song }
  if (note.tick + dur > measureTicks(song)) return { song, error: 'That length doesn’t fit in the rest of the measure.' }
  const notes = clearSpan(song.notes, note.measure, note.tick, dur, true).map((n) =>
    n.measure === note.measure && n.tick === note.tick ? { ...n, dur } : n,
  )
  return { song: touch(song, { notes }) }
}

export function removeNote(song: Song, id: string): Song {
  return touch(song, { notes: song.notes.filter((n) => n.id !== id) })
}

/** Move a note to another step (re-spelled by the key); drops it if that spot is taken. */
export function moveNote(song: Song, id: string, step: number): Song {
  const note = song.notes.find((n) => n.id === id)
  if (!note) return song
  const taken = song.notes.some((n) => n.id !== id && n.measure === note.measure && n.tick === note.tick && n.step === step)
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
  const len = beats * TPQ
  return touch(song, { beatsPerMeasure: beats, notes: song.notes.filter((n) => n.tick + n.dur <= len) })
}

/** Change key and re-spell every note to the new key signature. */
export function setKey(song: Song, fifths: number): Song {
  return touch(song, { fifths, notes: song.notes.map((n) => ({ ...n, alter: keyAlter(letterOf(n.step), fifths) })) })
}

export function updateSong(song: Song, patch: Partial<Pick<Song, 'title' | 'tempo' | 'instrument'>>): Song {
  return touch(song, patch)
}

export const noteMidi = (n: Note) => toMidi(n.step, n.alter)

/** Start of a note in ticks from the beginning of the song. */
export const absoluteTick = (song: Song, n: Note) => n.measure * measureTicks(song) + n.tick
