import { diatonicChords, getQuality, specName, type ChordSpec } from './chordBuilder'
import { TPQ } from './duration'
import type { Part, Song } from './song'
import { measureTicks, uid } from './song'
import { mod, toMidi } from './theory'

// The song's chord progression: chords placed at a bar and beat, each lasting
// until the next one. Supporting parts are generated from it (arrange.ts),
// and the chord lane above the score shows and edits it.

export interface ChordEntry {
  id: string
  measure: number
  /** Ticks into the measure (on a beat). */
  tick: number
  spec: ChordSpec
}

/** A stretch of the song under one chord, in song ticks [start, end). */
export interface ChordSpan {
  entry: ChordEntry
  start: number
  end: number
}

const absTick = (song: Pick<Song, 'beatsPerMeasure'>, measure: number, tick: number) => measure * song.beatsPerMeasure * TPQ + tick

export function sortedProgression(song: Song): ChordEntry[] {
  return [...(song.progression ?? [])]
    .filter((c) => c.measure < song.measures)
    .sort((a, b) => a.measure - b.measure || a.tick - b.tick)
}

/** Each chord with the stretch it lasts for (to the next chord or the end of the song). */
export function progressionSpans(song: Song): ChordSpan[] {
  const list = sortedProgression(song)
  const songEnd = song.measures * song.beatsPerMeasure * TPQ
  return list.map((entry, i) => ({
    entry,
    start: absTick(song, entry.measure, entry.tick),
    end: list[i + 1] ? absTick(song, list[i + 1].measure, list[i + 1].tick) : songEnd,
  }))
}

/** The chord sounding at a song tick, if any. */
export function chordAt(song: Song, tick: number): ChordEntry | undefined {
  return progressionSpans(song).find((s) => s.start <= tick && tick < s.end)?.entry
}

/** Set (or with null, remove) the chord at a bar and beat. */
export function setChordAt(song: Song, measure: number, tick: number, spec: ChordSpec | null): Song {
  const rest = (song.progression ?? []).filter((c) => !(c.measure === measure && c.tick === tick))
  const progression = spec ? [...rest, { id: uid(), measure, tick, spec }] : rest
  return { ...song, progression, updatedAt: Date.now() }
}

/** Put a list of chords one per bar from `fromMeasure`, repeating it to the end of the song. */
export function fillProgression(song: Song, chords: ChordSpec[], fromMeasure = 0): Song {
  if (!chords.length) return song
  const kept = (song.progression ?? []).filter((c) => c.measure < fromMeasure)
  const added: ChordEntry[] = []
  for (let m = fromMeasure; m < song.measures; m++) added.push({ id: uid(), measure: m, tick: 0, spec: chords[(m - fromMeasure) % chords.length] })
  return { ...song, progression: [...kept, ...added], updatedAt: Date.now() }
}

export function clearProgression(song: Song): Song {
  return { ...song, progression: [], updatedAt: Date.now() }
}

// --- presets -------------------------------------------------------------------

export const PROGRESSION_PRESETS: { name: string; degrees: number[] }[] = [
  { name: 'I–V–vi–IV', degrees: [0, 4, 5, 3] },
  { name: 'I–vi–IV–V', degrees: [0, 5, 3, 4] },
  { name: 'vi–IV–I–V', degrees: [5, 3, 0, 4] },
  { name: 'I–IV–V–I', degrees: [0, 3, 4, 0] },
  { name: 'ii–V–I', degrees: [1, 4, 0] },
  { name: 'I–IV–I–V', degrees: [0, 3, 0, 4] },
]

/** The chords of a preset in a key, with V as a dominant seventh before I. */
export function presetChords(fifths: number, degrees: number[]): ChordSpec[] {
  const triads = diatonicChords(fifths)
  return degrees.map((d, i) => {
    const c = triads[d]
    const spec: ChordSpec = { letter: c.letter, alter: c.alter, quality: c.quality, inversion: 0 }
    if (d === 4 && degrees[(i + 1) % degrees.length] === 0) spec.quality = '7'
    return spec
  })
}

// --- suggesting chords for a melody ------------------------------------------------

/** Pitch classes of a chord. */
function chordPcs(spec: ChordSpec): number[] {
  const rootMidi = toMidi(spec.letter, spec.alter)
  return getQuality(spec.quality).tones.map(([, semis]) => mod(rootMidi + semis, 12))
}

/**
 * Pick a chord of the key for each bar of a melody: the triad whose notes
 * cover most of the bar's sounding time, with extra weight for notes on
 * strong beats, and a small preference for the common chords (I, IV, V, vi).
 * Bars without notes keep the chord before them.
 */
export function suggestChords(melody: Part, fromMeasure = 0, toMeasure = melody.measures - 1): ChordSpec[] {
  const triads = diatonicChords(melody.fifths)
  const preference = [0.3, 0.1, 0, 0.25, 0.25, 0.2, -0.2]
  const len = measureTicks(melody)
  const out: ChordSpec[] = []
  let prev: ChordSpec = { ...triads[0], inversion: 0 }
  for (let m = fromMeasure; m <= toMeasure; m++) {
    const notes = melody.notes.filter((n) => n.measure === m)
    if (!notes.length) {
      out.push(prev)
      continue
    }
    let best = { score: -Infinity, spec: prev }
    triads.forEach((t, i) => {
      const spec: ChordSpec = { letter: t.letter, alter: t.alter, quality: t.quality, inversion: 0 }
      const pcs = chordPcs(spec)
      let score = preference[i]
      for (const n of notes) {
        const strong = n.tick === 0 ? 2 : n.tick === len / 2 ? 1.5 : n.tick % TPQ === 0 ? 1.2 : 1
        const weight = (n.dur / TPQ) * strong
        score += pcs.includes(mod(toMidi(n.step, n.alter), 12)) ? weight : -0.6 * weight
      }
      // Staying on the same chord is fine but slightly less interesting.
      if (specName(spec) === specName(prev)) score -= 0.15
      if (score > best.score) best = { score, spec }
    })
    out.push(best.spec)
    prev = best.spec
  }
  return out
}
