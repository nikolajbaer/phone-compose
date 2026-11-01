import type { ClefId } from './clefs'
import { TPQ, restsFor, type RestPiece } from './duration'
import { getInstrument } from './instruments'
import { keyAlter, letterOf, toMidi } from './theory'

// A song has tracks; each track is one voice on one staff, with its own
// instrument and clef. Editing works on a Part: the song's shared settings
// (meter, key, length) plus one track's notes. Notes that start at the same
// tick of a measure form a chord and share a duration; gaps are rests.

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
  /**
   * Id of the note this one connects to, starting right where this one ends:
   * a tie if it has the same pitch, a slide (glissando) if not.
   */
  tieTo?: string
  /** On a grand staff: 1 for the lower (bass) staff; absent for the upper one. */
  staff?: number
}

/** An id from INSTRUMENTS (instruments.ts). */
export type InstrumentId = string

export interface Track {
  id: string
  instrument: InstrumentId
  clef: ClefId
  notes: Note[]
  muted?: boolean
  /** Two staves, treble over bass, each its own voice (a piano's right and left hand). */
  grand?: boolean
}

export interface Song {
  id: string
  title: string
  tempo: number
  beatsPerMeasure: number
  /** Key signature: sharps (+) or flats (-). */
  fifths: number
  measures: number
  tracks: Track[]
  createdAt: number
  updatedAt: number
}

/** One track seen with the song's shared settings: what a staff shows and edits. */
export interface Part {
  tempo: number
  beatsPerMeasure: number
  fifths: number
  measures: number
  instrument: InstrumentId
  clef: ClefId
  notes: Note[]
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

export function newTrack(instrument: InstrumentId, clef?: ClefId): Track {
  const def = getInstrument(instrument)
  return { id: uid(), instrument, clef: clef ?? def.clef, notes: [], ...(def.grand ? { grand: true } : {}) }
}

export function createSong(opts: NewSongOptions): Song {
  const now = Date.now()
  return {
    id: uid(),
    title: opts.title.trim() || 'Untitled song',
    tempo: opts.tempo,
    beatsPerMeasure: opts.beatsPerMeasure,
    fifths: opts.fifths,
    measures: opts.measures ?? 4,
    tracks: [newTrack(opts.instrument, opts.clef)],
    createdAt: now,
    updatedAt: now,
  }
}

// --- song <-> part -------------------------------------------------------------

/** How many staves a track is written on: two for a grand staff. */
export const staffCount = (t: Track) => (t.grand ? 2 : 1)

const onStaff = (n: Note, staff: number) => (n.staff ?? 0) === staff

/** One staff of a track (staff 1 is the bass staff of a grand staff). */
export function partOf(song: Song, track: number, staff = 0): Part {
  const t = song.tracks[track] ?? song.tracks[0]
  return {
    tempo: song.tempo,
    beatsPerMeasure: song.beatsPerMeasure,
    fifths: song.fifths,
    measures: song.measures,
    instrument: t.instrument,
    clef: t.grand ? (staff ? 'bass' : 'treble') : t.clef,
    notes: t.grand ? t.notes.filter((n) => onStaff(n, staff)) : t.notes,
    updatedAt: song.updatedAt,
  }
}

/** All the staves of a track. */
export const partsOf = (song: Song, track: number): Part[] =>
  Array.from({ length: staffCount(song.tracks[track] ?? song.tracks[0]) }, (_, s) => partOf(song, track, s))

/** Write an edited part back into its track (and the shared settings into the song). */
export function withPart(song: Song, track: number, part: Part, staff = 0): Song {
  return {
    ...song,
    tempo: part.tempo,
    beatsPerMeasure: part.beatsPerMeasure,
    fifths: part.fifths,
    measures: part.measures,
    tracks: song.tracks.map((t, i) => {
      if (i !== track) return t
      if (!t.grand) return { ...t, instrument: part.instrument, clef: part.clef, notes: part.notes }
      const mine = part.notes.map(({ staff: _s, ...n }) => (staff ? { ...n, staff } : n))
      return { ...t, instrument: part.instrument, notes: [...t.notes.filter((n) => !onStaff(n, staff)), ...mine] }
    }),
    updatedAt: Date.now(),
  }
}

/** Apply a part edit to every staff of every track (for key, meter and length changes). */
export function editAllParts(song: Song, f: (p: Part) => Part): Song {
  let out = song
  song.tracks.forEach((t, i) => {
    for (let s = 0; s < staffCount(t); s++) out = withPart(out, i, f(partOf(out, i, s)), s)
  })
  return out
}

/** Change a track's instrument, taking that instrument's usual clef and staff. */
export function setTrackInstrument(song: Song, track: number, instrument: InstrumentId): Song {
  const def = getInstrument(instrument)
  return {
    ...song,
    tracks: song.tracks.map((t, i) => (i === track ? withGrand({ ...t, instrument, clef: def.clef }, !!def.grand) : t)),
    updatedAt: Date.now(),
  }
}

/** Turn a track's grand staff on (its notes start on the treble staff) or off (both staves merge). */
export function setTrackGrand(song: Song, track: number, grand: boolean): Song {
  return { ...song, tracks: song.tracks.map((t, i) => (i === track ? withGrand(t, grand) : t)), updatedAt: Date.now() }
}

function withGrand(t: Track, grand: boolean): Track {
  if (!!t.grand === grand) return t
  if (grand) return { ...t, grand: true }
  return { ...t, grand: false, clef: 'treble', notes: t.notes.map(({ staff: _s, ...n }) => n) }
}

const TRACK_ORDER: InstrumentId[] = ['strings', 'acoustic_bass', 'piano', 'flute', 'cello', 'nylon_guitar']

export function addTrack(song: Song, instrument?: InstrumentId): Song {
  const used = new Set(song.tracks.map((t) => t.instrument))
  const pick = instrument ?? TRACK_ORDER.find((i) => !used.has(i)) ?? 'piano'
  return { ...song, tracks: [...song.tracks, newTrack(pick)], updatedAt: Date.now() }
}

export function removeTrack(song: Song, track: number): Song {
  if (song.tracks.length <= 1) return song
  return { ...song, tracks: song.tracks.filter((_, i) => i !== track), updatedAt: Date.now() }
}

export function setTrackMuted(song: Song, track: number, muted: boolean): Song {
  return { ...song, tracks: song.tracks.map((t, i) => (i === track ? { ...t, muted } : t)), updatedAt: Date.now() }
}

export const songNoteCount = (song: Song) => song.tracks.reduce((a, t) => a + t.notes.length, 0)

// --- upgrading saved songs -----------------------------------------------------

type OldNote = Note & { beat?: number; tie?: boolean }
type OldSong = Partial<Song> & { notes?: OldNote[]; instrument?: string; clef?: ClefId }

function normalizeNotes(notes: OldNote[], beatsPerMeasure: number): Note[] {
  const timed = notes.map((n) => {
    if (typeof n.tick === 'number' && typeof n.dur === 'number') return n
    const { beat, ...rest } = n
    return { ...rest, tick: (beat ?? 0) * TPQ, dur: TPQ }
  })
  // Ties used to be a flag meaning "same pitch at the next position".
  const len = beatsPerMeasure * TPQ
  return timed.map(({ tie, ...n }) => {
    if (!tie || n.tieTo) return n
    const end = n.tick + n.dur
    const at = end >= len ? { measure: n.measure + 1, tick: 0 } : { measure: n.measure, tick: end }
    const t = timed.find((x) => x.measure === at.measure && x.tick === at.tick && x.step === n.step && x.alter === n.alter)
    return t ? { ...n, tieTo: t.id } : n
  })
}

/** Upgrade songs saved by earlier versions: beats to ticks, tie flags to links, one staff to tracks. */
export function normalizeSong(raw: Song): Song {
  const old = raw as unknown as OldSong & Song
  const tracks: Track[] = old.tracks ?? [
    {
      id: uid(),
      instrument: old.instrument ?? 'piano',
      clef: old.clef ?? getInstrument(old.instrument ?? 'piano').clef,
      notes: old.notes ?? [],
    },
  ]
  const { notes: _n, instrument: _i, clef: _c, ...rest } = old
  void _n
  void _i
  void _c
  return {
    ...(rest as Song),
    tracks: tracks.map((t) => ({
      ...t,
      clef: t.clef ?? getInstrument(t.instrument).clef,
      notes: normalizeNotes(t.notes as OldNote[], old.beatsPerMeasure),
    })),
  }
}

export const measureTicks = (song: Part) => song.beatsPerMeasure * TPQ

const touch = (song: Part, patch: Partial<Part>): Part => ({ ...song, ...patch, updatedAt: Date.now() })

export interface Chord {
  tick: number
  dur: number
  notes: Note[]
}

export type MeasureEvent = ({ kind: 'chord' } & Chord) | ({ kind: 'rest' } & RestPiece)

export function chordsInMeasure(song: Part, measure: number): Chord[] {
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
export function measureEvents(song: Part, measure: number): MeasureEvent[] {
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

export type EditResult = { song: Part; error?: undefined } | { song: Part; error: string }

/** Clear room for a chord at [tick, tick+dur): later chords starting inside it are overwritten. */
function clearSpan(notes: Note[], measure: number, tick: number, dur: number, keepTick: boolean) {
  return notes.filter((n) => n.measure !== measure || n.tick < tick || n.tick >= tick + dur || (keepTick && n.tick === tick))
}

/**
 * Put a note at a tick. If a chord already starts there the pitch joins it
 * (keeping the chord's length); otherwise a new chord of `dur` is written,
 * overwriting anything it covers, like note input in MuseScore.
 */
export function placeNote(song: Part, measure: number, tick: number, dur: number, step: number, alterOverride?: number): EditResult {
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
  song: Part,
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
export function setChordDuration(song: Part, noteId: string, dur: number): EditResult {
  const note = song.notes.find((n) => n.id === noteId)
  if (!note) return { song }
  if (note.dur === dur) return { song }
  if (note.tick + dur > measureTicks(song)) return { song, error: 'That length doesn’t fit in the rest of the measure.' }
  const notes = clearSpan(song.notes, note.measure, note.tick, dur, true).map((n) =>
    n.measure === note.measure && n.tick === note.tick ? { ...n, dur } : n,
  )
  return { song: touch(song, { notes }) }
}

export function removeNote(song: Part, id: string): Part {
  return touch(song, { notes: song.notes.filter((n) => n.id !== id) })
}

/** Move a note to another step (re-spelled by the key); drops it if that spot is taken. */
export function moveNote(song: Part, id: string, step: number): Part {
  const note = song.notes.find((n) => n.id === id)
  if (!note) return song
  const taken = song.notes.some((n) => n.id !== id && n.measure === note.measure && n.tick === note.tick && n.step === step)
  if (taken) return removeNote(song, id)
  return touch(song, {
    notes: song.notes.map((n) => (n.id === id ? { ...n, step, alter: keyAlter(letterOf(step), song.fifths) } : n)),
  })
}

export function setMeasures(song: Part, measures: number): Part {
  const m = Math.max(1, Math.min(256, measures))
  return touch(song, { measures: m, notes: song.notes.filter((n) => n.measure < m) })
}

export function setBeatsPerMeasure(song: Part, beats: number): Part {
  const len = beats * TPQ
  return touch(song, { beatsPerMeasure: beats, notes: song.notes.filter((n) => n.tick + n.dur <= len) })
}

/** Change key and re-spell every note to the new key signature. */
export function setKey(song: Part, fifths: number): Part {
  return touch(song, { fifths, notes: song.notes.map((n) => ({ ...n, alter: keyAlter(letterOf(n.step), fifths) })) })
}

export function updateSong(song: Part, patch: Partial<Pick<Part, 'tempo' | 'clef'>>): Part {
  return touch(song, patch)
}

/** Switch instrument, and to the clef that instrument is written in. */
export function setInstrument(song: Part, instrument: InstrumentId): Part {
  return touch(song, { instrument, clef: getInstrument(instrument).clef })
}

// --- accidentals ---------------------------------------------------------------

/** Give a note (and the notes tied on from it at the same pitch) an explicit sharp, flat or natural. */
export function setAccidental(song: Part, noteId: string, alter: number): Part {
  const ids = new Set<string>()
  let n = song.notes.find((x) => x.id === noteId)
  while (n && !ids.has(n.id)) {
    ids.add(n.id)
    const t = tieTarget(song, n)
    n = t && noteMidi(t) === noteMidi(n) ? t : undefined
  }
  return touch(song, { notes: song.notes.map((x) => (ids.has(x.id) ? { ...x, alter } : x)) })
}

/**
 * The notes of a measure that need an accidental printed: those that differ
 * from the key signature or from an earlier accidental on the same line or
 * space in the measure. A note tied over from the previous measure shows none.
 */
export function accidentalsInMeasure(song: Part, measure: number): Set<string> {
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

// --- ties and slides -----------------------------------------------------------

/** Where a note ends: the measure and tick right after it. */
function endPosition(song: Part, n: Note): { measure: number; tick: number } {
  const end = n.tick + n.dur
  return end >= measureTicks(song) ? { measure: n.measure + 1, tick: 0 } : { measure: n.measure, tick: end }
}

/** The note `n` is tied or slides to, if it still starts right where `n` ends. */
export function tieTarget(song: Part, n: Note): Note | undefined {
  if (!n.tieTo) return undefined
  const t = song.notes.find((x) => x.id === n.tieTo)
  if (!t) return undefined
  const at = endPosition(song, n)
  return t.measure === at.measure && t.tick === at.tick ? t : undefined
}

/** A connection is a tie when both notes have the same pitch, otherwise a slide. */
export function isSlide(from: Note, to: Note): boolean {
  return noteMidi(from) !== noteMidi(to)
}

/** Ids of notes that a same-pitch tie arrives at. */
export function tiedInto(song: Part): Set<string> {
  const out = new Set<string>()
  for (const n of song.notes) {
    const t = tieTarget(song, n)
    if (t && !isSlide(n, t)) out.add(t.id)
  }
  return out
}

/**
 * Connect a note to the next position, or disconnect it. If the same pitch
 * starts there it is a tie; if a chord without that pitch starts there it is
 * a slide to its nearest note; if there is a rest, the same pitch is written
 * there (at `dur`) and tied, so it can then be dragged to make a slide.
 * Returns the id of the note connected to.
 */
export function toggleTie(song: Part, noteId: string, dur: number): EditResult & { nextId?: string } {
  const n = song.notes.find((x) => x.id === noteId)
  if (!n) return { song }
  if (tieTarget(song, n)) {
    return { song: touch(song, { notes: song.notes.map((x) => (x.id === noteId ? { ...x, tieTo: undefined } : x)) }) }
  }
  const at = endPosition(song, n)
  if (at.measure >= song.measures) return { song, error: 'Add a measure to tie into.' }
  let notes = song.notes
  const there = notes.filter((x) => x.measure === at.measure && x.tick === at.tick)
  let target =
    there.find((x) => x.step === n.step) ??
    [...there].sort((a, b) => Math.abs(noteMidi(a) - noteMidi(n)) - Math.abs(noteMidi(b) - noteMidi(n)))[0]
  if (!target) {
    const r = placeNote(song, at.measure, at.tick, dur, n.step, n.alter)
    if (r.error) return r
    notes = r.song.notes
    target = notes.find((x) => x.measure === at.measure && x.tick === at.tick && x.step === n.step)!
  }
  const targetId = target.id
  return { song: touch(song, { notes: notes.map((x) => (x.id === noteId ? { ...x, tieTo: targetId } : x)) }), nextId: targetId }
}

export interface Bend {
  /** Ticks from the note's start where the glide begins and where it arrives. */
  start: number
  end: number
  midi: number
}

export interface SoundingNote {
  midi: number
  /** Ticks from the start of the song. */
  start: number
  dur: number
  /** Slides: pitch glides during the note. */
  bends: Bend[]
}

/**
 * What actually sounds: a note and everything tied or slid on from it become
 * one note; each slide glides over the second half of the note before it.
 */
export function soundingNotes(song: Part): SoundingNote[] {
  const linked = new Set<string>()
  for (const n of song.notes) {
    const t = tieTarget(song, n)
    if (t) linked.add(t.id)
  }
  const out: SoundingNote[] = []
  for (const n of song.notes) {
    if (linked.has(n.id)) continue
    let dur = n.dur
    let segment = n.dur
    let prev = n
    const bends: Bend[] = []
    const seen = new Set([n.id])
    for (let t = tieTarget(song, n); t && !seen.has(t.id); t = tieTarget(song, t)) {
      seen.add(t.id)
      if (isSlide(prev, t)) {
        bends.push({ start: dur - segment / 2, end: dur, midi: noteMidi(t) })
        segment = t.dur
      } else segment += t.dur
      dur += t.dur
      prev = t
    }
    out.push({ midi: noteMidi(n), start: absoluteTick(song, n), dur, bends })
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi)
}

export const noteMidi = (n: Note) => toMidi(n.step, n.alter)

/** Start of a note in ticks from the beginning of the song. */
export const absoluteTick = (song: Part, n: Note) => n.measure * measureTicks(song) + n.tick
