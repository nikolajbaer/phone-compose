import { Midi } from '@tonejs/midi'
import { getSoundfontNames } from 'smplr'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/audio/midiExport'
import { chordName } from '../src/music/chords'
import { TPQ, choiceTicks, describeTicks, restsFor } from '../src/music/duration'
import { INSTRUMENTS, getInstrument } from '../src/music/instruments'
import {
  createSong,
  measureEvents,
  moveNote,
  noteMidi,
  normalizeSong,
  placeNote,
  removeNote,
  setBeatsPerMeasure,
  setChordDuration,
  setKey,
  setMeasures,
  type Song,
} from '../src/music/song'
import { keyAlter, pitchName, posToStep, toMidi } from '../src/music/theory'
import { layoutSong } from '../src/components/staffLayout'

const newSong = (fifths = 0) => createSong({ title: 'T', tempo: 120, beatsPerMeasure: 4, fifths, instrument: 'square' })
const Q = TPQ
const E = TPQ / 2
const S = TPQ / 4
const add = (s: Song, m: number, tick: number, dur: number, step: number) => {
  const r = placeNote(s, m, tick, dur, step)
  if (r.error) throw new Error(r.error)
  return r.song
}

describe('theory', () => {
  it('maps diatonic steps to MIDI', () => {
    expect(toMidi(0, 0)).toBe(60) // C4
    expect(toMidi(5, 0)).toBe(69) // A4
    expect(toMidi(7, 0)).toBe(72) // C5
    expect(toMidi(-1, 0)).toBe(59) // B3
    expect(toMidi(3, 1)).toBe(66) // F#4
  })

  it('puts E4 on the bottom line of the treble staff', () => {
    expect(pitchName(posToStep(0), 0)).toBe('E4')
    expect(pitchName(posToStep(8), 0)).toBe('F5')
  })

  it('knows key signatures', () => {
    expect(keyAlter(3, 1)).toBe(1) // F# in G
    expect(keyAlter(0, 1)).toBe(0)
    expect(keyAlter(6, -2)).toBe(-1) // Bb in Bb major
    expect(keyAlter(2, -2)).toBe(-1) // Eb
    expect(keyAlter(5, -2)).toBe(0)
  })
})

describe('durations', () => {
  it('computes dotted and triplet lengths', () => {
    expect(choiceTicks({ base: 'quarter', dotted: true, triplet: false })).toBe(72)
    expect(choiceTicks({ base: 'eighth', dotted: false, triplet: true })).toBe(16)
    expect(choiceTicks({ base: 'sixteenth', dotted: true, triplet: false })).toBe(18)
    expect(describeTicks(36)).toEqual({ base: 'eighth', dotted: true, triplet: false })
    expect(describeTicks(32)).toEqual({ base: 'quarter', dotted: false, triplet: true })
  })

  it('fills gaps with rests that never cross a beat', () => {
    expect(restsFor(0, 2 * Q).map((r) => r.dur)).toEqual([Q, Q])
    expect(restsFor(S, Q).map((r) => [r.dur, r.shape])).toEqual([
      [S, 'sixteenth'],
      [E, 'eighth'],
    ])
    // After one eighth-triplet, the rest of the beat is two triplet rests.
    expect(restsFor(16, Q).map((r) => [r.dur, r.triplet])).toEqual([
      [16, true],
      [16, true],
    ])
    // Same on a later beat (aligned to the beat, not the measure).
    expect(restsFor(3 * Q + 16, 4 * Q).map((r) => r.dur)).toEqual([16, 16])
    // After a dotted sixteenth: a 32nd then an eighth.
    expect(restsFor(18, Q).map((r) => r.dur)).toEqual([6, E])
  })
})

describe('song editing', () => {
  it('writes notes of any length and lays rests around them', () => {
    let s = add(newSong(), 0, 0, E, 0)
    s = add(s, 0, E, S, 1)
    const ev = measureEvents(s, 0)
    expect(ev.map((e) => [e.kind, e.tick, e.dur])).toEqual([
      ['chord', 0, E],
      ['chord', E, S],
      ['rest', E + S, S],
      ['rest', Q, Q],
      ['rest', 2 * Q, Q],
      ['rest', 3 * Q, Q],
    ])
  })

  it('adds pitches to an existing chord with the chord’s length', () => {
    let s = add(newSong(1), 0, 0, Q, 3) // F in G major -> F#
    expect(noteMidi(s.notes[0])).toBe(66)
    s = add(s, 0, 0, E, 5)
    expect(s.notes.map((n) => n.dur)).toEqual([Q, Q])
    expect(add(s, 0, 0, Q, 5).notes).toHaveLength(2) // duplicate ignored
  })

  it('overwrites what a longer note covers and refuses notes past the barline', () => {
    let s = add(add(newSong(), 0, Q, Q, 2), 0, 2 * Q, Q, 4)
    s = add(s, 0, 0, 3 * Q, 0) // dotted half from beat 1 covers both
    expect(s.notes.map((n) => [n.tick, n.dur])).toEqual([[0, 3 * Q]])
    expect(placeNote(s, 0, 3 * Q, 2 * Q, 0).error).toBeTruthy()
    expect(placeNote(s, 0, Q, Q, 0).error).toBeTruthy() // the dotted half is still sounding
  })

  it('changes a chord’s length', () => {
    let s = add(add(add(newSong(), 0, 0, Q, 0), 0, 0, Q, 2), 0, Q, Q, 4)
    const id = s.notes[0].id
    s = setChordDuration(s, id, 2 * Q).song // both chord notes, overwriting beat 2
    expect(s.notes.map((n) => n.dur)).toEqual([2 * Q, 2 * Q])
    s = setChordDuration(s, id, 16).song
    expect(measureEvents(s, 0).slice(0, 3).map((e) => [e.kind, e.dur])).toEqual([
      ['chord', 16],
      ['rest', 16],
      ['rest', 16],
    ])
    expect(setChordDuration(s, id, 5 * Q).error).toBeTruthy()
  })

  it('removes and moves notes', () => {
    let s = add(add(newSong(), 0, Q, Q, 0), 0, Q, Q, 4)
    const [c, g] = s.notes
    s = moveNote(s, c.id, 2)
    expect(s.notes.find((n) => n.id === c.id)?.step).toBe(2)
    s = moveNote(s, c.id, 4) // onto an occupied spot: the two merge
    expect(s.notes).toHaveLength(1)
    s = removeNote(s, g.id)
    expect(s.notes).toHaveLength(0)
  })

  it('drops notes outside the song when it shrinks', () => {
    let s = add(add(newSong(), 3, 3 * Q, Q, 0), 0, 0, Q, 0)
    s = setMeasures(s, 2)
    expect(s.notes).toHaveLength(1)
    s = setBeatsPerMeasure(add(s, 1, 2 * Q, 2 * Q, 0), 3)
    expect(s.notes).toHaveLength(1)
  })

  it('re-spells notes when the key changes', () => {
    const s = setKey(add(newSong(), 0, 0, Q, 6), -1) // B -> Bb in F major
    expect(noteMidi(s.notes[0])).toBe(70)
  })

  it('upgrades songs saved with beat-based notes', () => {
    const old = { ...newSong(), notes: [{ id: 'a', measure: 1, beat: 2, step: 0, alter: 0 }] } as unknown as Song
    expect(normalizeSong(old).notes[0]).toEqual({ id: 'a', measure: 1, tick: 2 * Q, dur: Q, step: 0, alter: 0 })
  })
})

describe('layout', () => {
  it('beams eighths within a beat and groups triplets', () => {
    let s = add(add(newSong(), 0, 0, E, 0), 0, E, E, 2)
    s = add(add(add(s, 0, Q, 16, 0), 0, Q + 16, 16, 1), 0, Q + 32, 16, 2)
    const m = layoutSong(s).measures[0]
    expect(m.beams.map((b) => b.slots.length)).toEqual([2, 3])
    expect(m.tuplets.map((t) => t.slots.length)).toEqual([3])
  })
})

describe('chord names', () => {
  const n = (step: number, alter = 0) => ({ step, alter })
  it('names triads, sevenths and inversions', () => {
    expect(chordName([n(0), n(2), n(4)])).toBe('C')
    expect(chordName([n(5), n(7), n(9)])).toBe('Am') // A C E
    expect(chordName([n(4), n(6), n(8), n(10)])).toBe('G7') // G B D F
    expect(chordName([n(2), n(4), n(7)])).toBe('C/E')
    expect(chordName([n(1), n(3, 1), n(5)])).toBe('D') // D F# A
    expect(chordName([n(6, -1), n(8), n(10)])).toBe('B♭') // Bb D F
    expect(chordName([n(0), n(2)])).toBeNull()
    expect(chordName([n(0), n(1), n(2)])).toBeNull() // C D E: no chord
  })
})

describe('MIDI export', () => {
  it('writes notes, lengths, tempo and meter', () => {
    let s = add(newSong(), 0, 0, E, 0)
    s = add(s, 1, Q + E, 3 * Q - E - Q, 4)
    const midi = new Midi(songToMidi({ ...s, tempo: 90 }))
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(90)
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([4, 4])
    const notes = midi.tracks[0].notes
    const ppq = midi.header.ppq
    expect(notes.map((x) => x.midi)).toEqual([60, 67])
    expect(notes[0].durationTicks).toBe(ppq / 2)
    expect(notes[1].ticks).toBe(5.5 * ppq)
  })
})

describe('instruments', () => {
  it('uses soundfont names that exist in midi-js-soundfonts', () => {
    const names = new Set(getSoundfontNames())
    for (const i of INSTRUMENTS) if (i.source.kind === 'soundfont') expect(names, i.id).toContain(i.source.name)
  })

  it('has unique ids and falls back to the piano for unknown ids', () => {
    expect(new Set(INSTRUMENTS.map((i) => i.id)).size).toBe(INSTRUMENTS.length)
    expect(getInstrument('nope').id).toBe('piano')
  })

  it('writes the General MIDI program to exported files', () => {
    const s = { ...add(newSong(), 0, 0, Q, 0), instrument: 'violin' }
    expect(new Midi(songToMidi(s)).tracks[0].instrument.number).toBe(40)
  })
})
