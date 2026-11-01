import { Midi } from '@tonejs/midi'
import { getInstrument } from '../music/instruments'
import type { Song } from '../music/song'
import { TPQ } from '../music/duration'
import { partOf, soundingNotes } from '../music/song'

/**
 * Build a standard MIDI file for a song: one MIDI track per track, each on its
 * own channel with its instrument. Tied notes are one note; slides become a
 * note per pitch (MIDI pitch bend only reaches a couple of semitones).
 */
export function songToMidi(song: Song): Uint8Array {
  const midi = new Midi()
  midi.name = song.title
  midi.header.setTempo(song.tempo)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [song.beatsPerMeasure, 4] })
  midi.header.update()
  const scale = midi.header.ppq / TPQ
  song.tracks.forEach((t, i) => {
    const track = midi.addTrack()
    const inst = getInstrument(t.instrument)
    track.name = inst.name
    track.channel = i >= 9 ? i + 1 : i // channel 10 (index 9) is drums
    track.instrument.number = inst.program
    for (const note of soundingNotes(partOf(song, i))) {
      const pieces = [{ midi: note.midi, from: 0 }, ...note.bends.map((b) => ({ midi: b.midi, from: b.end }))]
      pieces.forEach((p, k) => {
        const to = pieces[k + 1]?.from ?? note.dur
        track.addNote({
          midi: p.midi,
          ticks: Math.round((note.start + p.from) * scale),
          durationTicks: Math.round((to - p.from) * scale),
          velocity: 0.8,
        })
      })
    }
  })
  return midi.toArray()
}

export function downloadMidi(song: Song) {
  const bytes = songToMidi(song)
  const blob = new Blob([bytes as BlobPart], { type: 'audio/midi' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${song.title.replace(/[^\w\- ]+/g, '').trim() || 'song'}.mid`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
