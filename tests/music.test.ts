import { Midi } from '@tonejs/midi'
import { getSoundfontNames } from 'smplr'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/audio/midiExport'
import { chordName } from '../src/music/chords'
import { diatonicChords, specName, voiceChord } from '../src/music/chordBuilder'
import { TPQ, choiceTicks, describeTicks, restsFor } from '../src/music/duration'
import { INSTRUMENTS, getInstrument } from '../src/music/instruments'
import {
  createSong,
  measureEvents,
  moveNote,
  noteMidi,
  normalizeSong,
  accidentalsInMeasure,
  placeChord,
  setAccidental,
  setInstrument,
  soundingNotes,
  toggleTie,
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
import { clefPosToStep, clefRange, getClef } from '../src/music/clefs'

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

describe('chord picker', () => {
  const names = (ps: { step: number; alter: number }[]) => ps.map((p) => pitchName(p.step, p.alter))
  const G7 = { letter: 4, alter: 0, quality: '7', inversion: 0 }

  it('spells chords properly and voices them close from the bass', () => {
    expect(names(voiceChord(G7, 4))).toEqual(['G4', 'B4', 'D5', 'F5'])
    expect(names(voiceChord({ letter: 1, alter: 0, quality: 'maj', inversion: 0 }, 1))).toEqual(['D4', 'F♯4', 'A4'])
    expect(names(voiceChord({ letter: 6, alter: -1, quality: 'maj7', inversion: 0 }, 6))).toEqual(['B♭4', 'D5', 'F5', 'A5'])
    expect(names(voiceChord({ letter: 0, alter: 1, quality: 'dim7', inversion: 0 }, 0))).toEqual(['C♯4', 'E4', 'G4', 'B♭4'])
  })

  it('puts the chosen chord tone in the bass for inversions', () => {
    expect(names(voiceChord({ ...G7, inversion: 1 }, 6))).toEqual(['B4', 'D5', 'F5', 'G5'])
    expect(names(voiceChord({ ...G7, inversion: 3 }, 3))).toEqual(['F4', 'G4', 'B4', 'D5'])
    expect(specName({ ...G7, inversion: 1 })).toBe('G7/B')
    expect(specName({ letter: 0, alter: 0, quality: 'maj', inversion: 2 })).toBe('C/G')
    // The name the staff prints for the written notes agrees with the picker.
    expect(chordName(voiceChord({ ...G7, inversion: 1 }, 6))).toBe('G7/B')
  })

  it('keeps chords on the staff', () => {
    for (const bass of [-10, -3, 0, 7, 14, 20]) {
      const steps = voiceChord({ letter: 4, alter: 0, quality: '9', inversion: 0 }, bass).map((p) => p.step)
      expect(Math.min(...steps)).toBeGreaterThanOrEqual(posToStep(-5))
    }
    const high = voiceChord({ letter: 0, alter: 0, quality: 'maj', inversion: 0 }, 14).map((p) => p.step)
    expect(Math.max(...high)).toBeLessThanOrEqual(posToStep(12))
  })

  it('lists the chords of a key', () => {
    expect(diatonicChords(0).map(specName)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'])
    expect(diatonicChords(-2).map(specName)).toEqual(['B♭', 'Cm', 'Dm', 'E♭', 'F', 'Gm', 'Adim'])
    expect(diatonicChords(2).map((c) => c.numeral)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'])
  })

  it('writes a chord, or replaces one keeping its length', () => {
    let s = placeChord(newSong(), 0, 0, 2 * Q, voiceChord(G7, 4)).song
    expect(s.notes).toHaveLength(4)
    expect(s.notes.every((n) => n.dur === 2 * Q)).toBe(true)
    s = placeChord(s, 0, 0, Q, voiceChord({ letter: 0, alter: 0, quality: 'maj', inversion: 0 }, 0)).song
    expect(s.notes.map((n) => [n.step, n.dur])).toEqual([
      [0, 2 * Q],
      [2, 2 * Q],
      [4, 2 * Q],
    ])
    expect(placeChord(s, 0, 3 * Q, 2 * Q, voiceChord(G7, 4)).error).toBeTruthy()
  })
})

describe('ties', () => {
  it('ties to the next note, writing it if needed, across the barline', () => {
    let s = add(newSong(), 0, 3 * Q, Q, 4) // G4 on beat 4
    const first = s.notes[0].id
    const r = toggleTie(s, first, 2 * Q)
    s = r.song
    expect(r.nextId).toBeTruthy()
    const next = s.notes.find((n) => n.id === r.nextId)!
    expect([next.measure, next.tick, next.dur, next.step]).toEqual([1, 0, 2 * Q, 4])
    expect(soundingNotes(s)).toEqual([{ midi: 67, start: 3 * Q, dur: 3 * Q }])
    // Untie: two separate notes again.
    s = toggleTie(s, first, Q).song
    expect(soundingNotes(s).map((n) => n.dur)).toEqual([Q, 2 * Q])
  })

  it('joins an existing note of the same pitch and chains', () => {
    let s = add(add(add(newSong(), 0, 0, Q, 0), 0, Q, Q, 0), 0, 2 * Q, Q, 0)
    const [a, b] = s.notes
    s = toggleTie(toggleTie(s, a.id, Q).song, b.id, Q).song
    expect(s.notes).toHaveLength(3)
    expect(soundingNotes(s)).toEqual([{ midi: 60, start: 0, dur: 3 * Q }])
  })

  it('refuses to tie past the last measure', () => {
    const s = add(setMeasures(newSong(), 1), 0, 3 * Q, Q, 0)
    expect(toggleTie(s, s.notes[0].id, Q).error).toBeTruthy()
  })
})

describe('accidentals', () => {
  it('writes notes with an explicit accidental and changes it on a note', () => {
    let s = placeNote(newSong(), 0, 0, Q, 3, 1).song // F#4 in C
    expect(noteMidi(s.notes[0])).toBe(66)
    s = setAccidental(s, s.notes[0].id, -1) // Fb4
    expect(noteMidi(s.notes[0])).toBe(64)
  })

  it('prints accidentals the way notation does within a measure', () => {
    let s = placeNote(newSong(), 0, 0, Q, 3, 1).song // F#
    s = placeNote(s, 0, Q, Q, 3, 1).song // F# again: carried, no sign
    s = placeNote(s, 0, 2 * Q, Q, 3, 0).song // F natural: needs a natural
    s = placeNote(s, 1, 0, Q, 3, 0).song // new measure, F: nothing
    const [a, b, c] = s.notes
    expect([...accidentalsInMeasure(s, 0)]).toEqual([a.id, c.id])
    expect(accidentalsInMeasure(s, 1).size).toBe(0)
    expect(b).toBeTruthy()
  })

  it('does not repeat the accidental on a note tied over the barline', () => {
    let s = placeNote(newSong(), 0, 3 * Q, Q, 3, 1).song
    s = toggleTie(s, s.notes[0].id, Q).song
    expect(accidentalsInMeasure(s, 1).size).toBe(0)
    expect(noteMidi(s.notes[1])).toBe(66)
  })
})

describe('clefs', () => {
  it('maps staff positions to pitches for each clef', () => {
    const name = (clef: string, pos: number) => pitchName(clefPosToStep(getClef(clef), pos), 0)
    expect(name('treble', 0)).toBe('E4')
    expect(name('bass', 0)).toBe('G2')
    expect(name('bass', 8)).toBe('A3')
    expect(name('alto', 4)).toBe('C4') // middle line
    expect(name('treble8vb', 0)).toBe('E3')
    expect(name('bass8vb', 0)).toBe('G1')
  })

  it('picks the clef of the instrument', () => {
    const s = newSong()
    expect(s.clef).toBe('treble')
    expect(setInstrument(s, 'viola').clef).toBe('alto')
    expect(setInstrument(s, 'cello').clef).toBe('bass')
    expect(setInstrument(s, 'nylon_guitar').clef).toBe('treble8vb')
    expect(setInstrument(s, 'acoustic_bass').clef).toBe('bass8vb')
    expect(setInstrument(s, 'flute').clef).toBe('treble')
  })

  it('voices chords inside the clef range', () => {
    const range = clefRange(getClef('bass'))
    const steps = voiceChord({ letter: 0, alter: 0, quality: 'maj7', inversion: 0 }, 0, range).map((p) => p.step)
    expect(Math.max(...steps)).toBeLessThanOrEqual(range.hi)
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(range.lo)
  })

  it('upgrades songs saved without a clef from their instrument', () => {
    const old = { ...newSong(), instrument: 'cello', clef: undefined } as unknown as Song
    expect(normalizeSong(old).clef).toBe('bass')
  })
})
