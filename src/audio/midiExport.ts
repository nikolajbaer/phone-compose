import { Midi } from '@tonejs/midi'
import { getInstrument } from '../music/instruments'
import type { Song } from '../music/song'
import { TPQ } from '../music/duration'
import { absoluteTick, noteMidi } from '../music/song'

/** Build a standard MIDI file (type 1, one track) for a song. */
export function songToMidi(song: Song): Uint8Array {
  const midi = new Midi()
  midi.name = song.title
  midi.header.setTempo(song.tempo)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [song.beatsPerMeasure, 4] })
  midi.header.update()
  const ppq = midi.header.ppq
  const track = midi.addTrack()
  track.name = song.title
  track.instrument.number = getInstrument(song.instrument).program
  const scale = ppq / TPQ
  for (const note of [...song.notes].sort((a, b) => absoluteTick(song, a) - absoluteTick(song, b))) {
    track.addNote({
      midi: noteMidi(note),
      ticks: Math.round(absoluteTick(song, note) * scale),
      durationTicks: Math.round(note.dur * scale),
      velocity: 0.8,
    })
  }
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
