import * as Tone from 'tone'
import { CacheStorage, Soundfont, SplendidGrandPiano } from 'smplr'
import { getInstrument, type InstrumentDef } from '../music/instruments'
import type { Song } from '../music/song'
import { absoluteTick, noteMidi } from '../music/song'
import { TPQ } from '../music/duration'
import { MAX_POS, MIN_POS, posToStep, toMidi } from '../music/theory'

// Plays a Song. Timing comes from the Tone.js Transport: notes are scheduled
// at "measure:beat:0" positions, so tempo, looping and the playhead are
// handled by Tone. The sound comes from a Voice: a sampled instrument from
// smplr (downloaded the first time it is used) or a Tone.js synth. Both run on
// Tone's AudioContext so scheduled times line up.

export interface LoadStatus {
  state: 'loading' | 'ready' | 'error'
  loaded: number
  total: number
}

interface Voice {
  play(midi: number, time: number, duration: number): void
  stopAll(): void
}

type AnySynth = Tone.PolySynth<Tone.Synth> | Tone.PolySynth<Tone.FMSynth> | Tone.PolySynth<Tone.AMSynth>

function makeSynth(kind: string): AnySynth {
  switch (kind) {
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
        oscillator: { type: kind as 'square' | 'triangle' | 'sawtooth' },
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.2 },
      })
  }
}

const SYNTH_VOLUME: Record<string, number> = { square: -18, sawtooth: -18, triangle: -8, bell: -10, organ: -12 }

/** The piano only downloads its mezzo-forte layer and plays everything at that velocity. */
const PIANO_VELOCITY = 92

/** MIDI notes the treble staff can hold, with room for accidentals. */
const STAFF_RANGE = Array.from({ length: toMidi(posToStep(MAX_POS), 1) - toMidi(posToStep(MIN_POS), -1) + 1 }, (_, i) => toMidi(posToStep(MIN_POS), -1) + i)

class Player {
  private voices = new Map<string, Voice>()
  private status = new Map<string, LoadStatus>()
  private listeners = new Set<() => void>()
  private song: Song | null = null
  private storage = typeof window !== 'undefined' && window.isSecureContext && 'caches' in window ? CacheStorage() : undefined
  playing = false

  /** Must be called from a user gesture before any sound on iOS / Chrome. */
  async unlock() {
    if (Tone.getContext().state !== 'running') await Tone.start()
  }

  // --- load status, for the UI (works with useSyncExternalStore) ------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getStatus = (id: string): LoadStatus | undefined => this.status.get(id)

  private setStatus(id: string, s: LoadStatus) {
    this.status.set(id, s)
    this.listeners.forEach((fn) => fn())
  }

  // --- voices ----------------------------------------------------------------

  /** Get (creating and starting to download, if needed) the voice for an instrument. */
  voice(id: string): Voice {
    const def = getInstrument(id)
    let v = this.voices.get(def.id)
    if (!v) {
      v = this.makeVoice(def)
      this.voices.set(def.id, v)
    }
    return v
  }

  private makeVoice(def: InstrumentDef): Voice {
    const src = def.source
    if (src.kind === 'synth') {
      const synth = makeSynth(src.synth).toDestination()
      synth.volume.value = SYNTH_VOLUME[src.synth] ?? -12
      this.setStatus(def.id, { state: 'ready', loaded: 1, total: 1 })
      return {
        play: (midi, time, duration) => synth.triggerAttackRelease(Tone.Frequency(midi, 'midi').toFrequency(), duration, time),
        stopAll: () => synth.releaseAll(),
      }
    }

    const context = Tone.getContext().rawContext as unknown as AudioContext
    const onLoadProgress = ({ loaded, total }: { loaded: number; total: number }) =>
      this.setStatus(def.id, { state: total > 0 && loaded >= total ? 'ready' : 'loading', loaded, total })
    this.setStatus(def.id, { state: 'loading', loaded: 0, total: 0 })

    const inst =
      src.kind === 'piano'
        ? SplendidGrandPiano(context, {
            storage: this.storage,
            velocity: PIANO_VELOCITY,
            decayTime: 0.4,
            // Only the notes the staff can hold, at one velocity: a fraction of the full piano.
            notesToLoad: { notes: STAFF_RANGE, velocityRange: [PIANO_VELOCITY, PIANO_VELOCITY] },
            onLoadProgress,
          })
        : Soundfont(context, { instrument: src.name, kit: 'FluidR3_GM', storage: this.storage, onLoadProgress })

    inst.ready.then(
      () => this.setStatus(def.id, { ...(this.status.get(def.id) ?? { loaded: 1, total: 1 }), state: 'ready' }),
      (err: unknown) => {
        console.warn(`Could not load ${def.name}`, err)
        this.setStatus(def.id, { state: 'error', loaded: 0, total: 0 })
        // Let a later attempt try again.
        this.voices.delete(def.id)
      },
    )
    return {
      play: (midi, time, duration) => inst.start({ note: midi, time, duration }),
      stopAll: () => inst.stop(),
    }
  }

  /** Start downloading an instrument's samples ahead of time. */
  preload(id: string) {
    this.voice(id)
  }

  /** Play one note now, e.g. as feedback while placing it. */
  preview(instrument: string, midi: number) {
    this.previewChord(instrument, [midi], 0.3)
  }

  /** Play several notes together now. */
  previewChord(instrument: string, midis: number[], seconds = 0.8) {
    if (Tone.getContext().state !== 'running') return
    const v = this.voice(instrument)
    for (const m of midis) v.play(m, Tone.now(), seconds)
  }

  // --- the song --------------------------------------------------------------

  /** (Re)schedule a song. Safe to call while playing: the transport keeps its position. */
  load(song: Song) {
    if (this.song && this.song.instrument !== song.instrument) this.voice(this.song.instrument).stopAll()
    this.song = song
    const transport = Tone.getTransport()
    transport.cancel(0)
    transport.bpm.value = song.tempo
    transport.timeSignature = song.beatsPerMeasure
    transport.loop = true
    transport.loopStart = 0
    transport.loopEnd = `${song.measures}:0:0`
    const voice = this.voice(song.instrument)
    const beatSeconds = 60 / song.tempo
    const ticksPerTick = transport.PPQ / TPQ
    for (const note of song.notes) {
      const midi = noteMidi(note)
      const seconds = (note.dur / TPQ) * beatSeconds * 0.95
      transport.schedule((time) => voice.play(midi, time, seconds), `${Math.round(absoluteTick(song, note) * ticksPerTick)}i`)
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
    if (this.song) this.voice(this.song.instrument).stopAll()
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
