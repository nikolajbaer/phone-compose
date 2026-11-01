import type { ClefId } from './clefs'
import { TPQ, restsFor, type RestPiece } from './duration'
import { getInstrument } from './instruments'
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
  /** Tied to the same pitch at the next position (which may be in the next measure). */
  tie?: boolean
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
  clef: ClefId
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
  clef?: ClefId
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
    clef: opts.clef ?? getInstrument(opts.instrument).clef,
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
  return { ...song, clef: song.clef ?? getInstrument(song.instrument).clef, notes }
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
export function placeNote(song: Song, measure: number, tick: number, dur: number, step: number, alterOverride?: number): EditResult {
  const alter = alterOverride ?? keyAlter(letterOf(step), song.fifths)
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

export function updateSong(song: Song, patch: Partial<Pick<Song, 'title' | 'tempo' | 'clef'>>): Song {
  return touch(song, patch)
}

/** Switch instrument, and to the clef that instrument is written in. */
export function setInstrument(song: Song, instrument: InstrumentId): Song {
  return touch(song, { instrument, clef: getInstrument(instrument).clef })
}

// --- accidentals ---------------------------------------------------------------

/** Give a note (and the notes tied on from it) an explicit sharp, flat or natural. */
export function setAccidental(song: Song, noteId: string, alter: number): Song {
  const ids = new Set<string>()
  for (let n = song.notes.find((x) => x.id === noteId); n && !ids.has(n.id); n = tieTarget(song, n)) ids.add(n.id)
  return touch(song, { notes: song.notes.map((n) => (ids.has(n.id) ? { ...n, alter } : n)) })
}

/**
 * The notes of a measure that need an accidental printed: those that differ
 * from the key signature or from an earlier accidental on the same line or
 * space in the measure. A note tied over from the previous measure shows none.
 */
export function accidentalsInMeasure(song: Song, measure: number): Set<string> {
  const show = new Set<string>()
  const state = new Map<number, number>()
  const continued = tiedInto(song)
  for (const c of chordsInMeasure(song, measure)) {
    for (const n of c.notes) {
      const current = state.get(n.step) ?? keyAlter(letterOf(n.step), song.fifths)
      if (n.alter !== current && !(c.tick === 0 && continued.has(n.id))) show.add(n.id)
      state.set(n.step, n.alter)
    }
  }
  return show
}

// --- ties ----------------------------------------------------------------------

/** Where a note ends: the measure and tick right after it. */
function endPosition(song: Song, n: Note): { measure: number; tick: number } {
  const end = n.tick + n.dur
  return end >= measureTicks(song) ? { measure: n.measure + 1, tick: 0 } : { measure: n.measure, tick: end }
}

/** The note a tie from `n` lands on: same pitch, starting where `n` ends. */
export function tieTarget(song: Song, n: Note): Note | undefined {
  if (!n.tie) return undefined
  const at = endPosition(song, n)
  return song.notes.find((x) => x.measure === at.measure && x.tick === at.tick && x.step === n.step && x.alter === n.alter)
}

/** Ids of notes that a tie arrives at. */
export function tiedInto(song: Song): Set<string> {
  const out = new Set<string>()
  for (const n of song.notes) {
    const t = tieTarget(song, n)
    if (t) out.add(t.id)
  }
  return out
}

/**
 * Tie a note to the next position, or untie it. If nothing of that pitch
 * starts there yet it is written: added to the chord there, or as a new note
 * of `dur` if there is a rest. Returns the id of the note tied to.
 */
export function toggleTie(song: Song, noteId: string, dur: number): EditResult & { nextId?: string } {
  const n = song.notes.find((x) => x.id === noteId)
  if (!n) return { song }
  if (n.tie) return { song: touch(song, { notes: song.notes.map((x) => (x.id === noteId ? { ...x, tie: false } : x)) }) }
  const at = endPosition(song, n)
  if (at.measure >= song.measures) return { song, error: 'Add a measure to tie into.' }
  let next = song.notes
  let target = next.find((x) => x.measure === at.measure && x.tick === at.tick && x.step === n.step)
  if (!target) {
    const r = placeNote(song, at.measure, at.tick, dur, n.step, n.alter)
    if (r.error) return r
    next = r.song.notes
    target = next.find((x) => x.measure === at.measure && x.tick === at.tick && x.step === n.step)!
  }
  const targetId = target.id
  return {
    song: touch(song, {
      notes: next.map((x) => (x.id === noteId ? { ...x, tie: true } : x.id === targetId ? { ...x, alter: n.alter } : x)),
    }),
    nextId: targetId,
  }
}

/** What actually sounds: tied notes merged into one, in song ticks. */
export function soundingNotes(song: Song): { midi: number; start: number; dur: number }[] {
  const continued = tiedInto(song)
  const out: { midi: number; start: number; dur: number }[] = []
  for (const n of song.notes) {
    if (continued.has(n.id)) continue
    let dur = n.dur
    const seen = new Set([n.id])
    for (let t = tieTarget(song, n); t && !seen.has(t.id); t = tieTarget(song, t)) {
      seen.add(t.id)
      dur += t.dur
    }
    out.push({ midi: noteMidi(n), start: absoluteTick(song, n), dur })
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi)
}

export const noteMidi = (n: Note) => toMidi(n.step, n.alter)

/** Start of a note in ticks from the beginning of the song. */
export const absoluteTick = (song: Song, n: Note) => n.measure * measureTicks(song) + n.tick
