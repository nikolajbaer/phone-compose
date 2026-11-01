import { Midi } from '@tonejs/midi'
import type { Song } from '../music/song'
import { absoluteBeat, noteMidi } from '../music/song'

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
  for (const note of [...song.notes].sort((a, b) => absoluteBeat(song, a) - absoluteBeat(song, b))) {
    track.addNote({ midi: noteMidi(note), ticks: absoluteBeat(song, note) * ppq, durationTicks: ppq, velocity: 0.8 })
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
