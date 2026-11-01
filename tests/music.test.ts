import { Midi } from '@tonejs/midi'
import { describe, expect, it } from 'vitest'
import { songToMidi } from '../src/audio/midiExport'
import { addNote, createSong, moveNote, noteMidi, removeNote, setBeatsPerMeasure, setKey, setMeasures } from '../src/music/song'
import { keyAlter, pitchName, posToStep, toMidi } from '../src/music/theory'

const newSong = (fifths = 0) => createSong({ title: 'T', tempo: 120, beatsPerMeasure: 4, fifths, instrument: 'square' })

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

describe('song editing', () => {
  it('adds notes spelled by the key and ignores duplicates', () => {
    let s = addNote(newSong(1), 0, 0, 3) // F in G major
    expect(noteMidi(s.notes[0])).toBe(66)
    s = addNote(s, 0, 0, 3)
    expect(s.notes).toHaveLength(1)
    s = addNote(s, 0, 0, 5) // a chord
    expect(s.notes).toHaveLength(2)
  })

  it('removes and moves notes', () => {
    let s = addNote(addNote(newSong(), 0, 1, 0), 0, 1, 4)
    const [c, g] = s.notes
    s = moveNote(s, c.id, 2)
    expect(s.notes.find((n) => n.id === c.id)?.step).toBe(2)
    // moving onto an occupied spot merges the two
    s = moveNote(s, c.id, 4)
    expect(s.notes).toHaveLength(1)
    s = removeNote(s, g.id)
    expect(s.notes).toHaveLength(0)
  })

  it('drops notes outside the song when it shrinks', () => {
    let s = addNote(addNote(newSong(), 3, 3, 0), 0, 0, 0)
    s = setMeasures(s, 2)
    expect(s.notes).toHaveLength(1)
    s = setBeatsPerMeasure(addNote(s, 1, 3, 0), 3)
    expect(s.notes).toHaveLength(1)
  })

  it('re-spells notes when the key changes', () => {
    const s = setKey(addNote(newSong(), 0, 0, 6), -1) // B -> Bb in F major
    expect(noteMidi(s.notes[0])).toBe(70)
  })
})

describe('MIDI export', () => {
  it('writes notes, tempo and meter', () => {
    let s = addNote(newSong(), 0, 0, 0)
    s = addNote(s, 1, 2, 4)
    const midi = new Midi(songToMidi({ ...s, tempo: 90 }))
    expect(Math.round(midi.header.tempos[0].bpm)).toBe(90)
    expect(midi.header.timeSignatures[0].timeSignature).toEqual([4, 4])
    const notes = midi.tracks[0].notes
    expect(notes.map((n) => n.midi)).toEqual([60, 67])
    expect(notes[1].ticks).toBe(6 * midi.header.ppq)
    expect(notes[1].durationTicks).toBe(midi.header.ppq)
  })
})
