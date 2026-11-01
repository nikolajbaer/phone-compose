import * as Tone from 'tone'
import type { InstrumentId, Song } from '../music/song'
import { noteMidi } from '../music/song'

// Plays a Song through Tone.js. Notes are scheduled on the Transport at
// "measure:beat:0" positions, so tempo and looping are handled by Tone.

type AnySynth = Tone.PolySynth<Tone.Synth> | Tone.PolySynth<Tone.FMSynth> | Tone.PolySynth<Tone.AMSynth>

function makeSynth(id: InstrumentId): AnySynth {
  switch (id) {
    case 'bell':
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 14,
        envelope: { attack: 0.002, decay: 0.6, sustain: 0.1, release: 0.8 },
        modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.4 },
      })
    case 'organ':
      return new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 2,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.15 },
      })
    default:
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: id },
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.2 },
      })
  }
}

const VOLUME: Record<InstrumentId, number> = { square: -18, sawtooth: -18, triangle: -8, bell: -10, organ: -12 }

class Player {
  private synth: AnySynth | null = null
  private instrument: InstrumentId | null = null
  private song: Song | null = null
  playing = false

  /** Must be called from a user gesture before any sound on iOS / Chrome. */
  async unlock() {
    if (Tone.getContext().state !== 'running') await Tone.start()
  }

  private getSynth(id: InstrumentId): AnySynth {
    if (!this.synth || this.instrument !== id) {
      this.synth?.dispose()
      this.synth = makeSynth(id).toDestination()
      this.synth.volume.value = VOLUME[id]
      this.instrument = id
    }
    return this.synth
  }

  /** Play one note now, e.g. as feedback while placing it. */
  preview(instrument: InstrumentId, midi: number) {
    if (Tone.getContext().state !== 'running') return
    this.getSynth(instrument).triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), 0.25)
  }

  /** (Re)schedule a song. Safe to call while playing: the transport keeps its position. */
  load(song: Song) {
    this.song = song
    const transport = Tone.getTransport()
    transport.cancel(0)
    transport.bpm.value = song.tempo
    transport.timeSignature = song.beatsPerMeasure
    transport.loop = true
    transport.loopStart = 0
    transport.loopEnd = `${song.measures}:0:0`
    const synth = this.getSynth(song.instrument)
    const beatSeconds = 60 / song.tempo
    for (const note of song.notes) {
      const freq = Tone.Frequency(noteMidi(note), 'midi').toFrequency()
      transport.schedule((time) => synth.triggerAttackRelease(freq, beatSeconds * 0.9, time), `${note.measure}:${note.beat}:0`)
    }
  }

  async play(song: Song, fromBeat = 0) {
    await this.unlock()
    this.load(song)
    const transport = Tone.getTransport()
    transport.ticks = fromBeat * transport.PPQ
    transport.start('+0.05')
    this.playing = true
  }

  stop() {
    Tone.getTransport().stop()
    this.synth?.releaseAll()
    this.playing = false
  }

  /** Current position in beats from the start of the song, or null when stopped. */
  positionBeats(): number | null {
    if (!this.playing || !this.song) return null
    const transport = Tone.getTransport()
    return transport.ticks / transport.PPQ
  }
}

export const player = new Player()
