import * as Tone from 'tone'
import { CacheStorage, Soundfont, SplendidGrandPiano } from 'smplr'
import { getInstrument, type InstrumentDef } from '../music/instruments'
import type { Song } from '../music/song'
import { partOf, soundingNotes } from '../music/song'
import { TPQ } from '../music/duration'
import { toMidi } from '../music/theory'
import { clefRange, getClef } from '../music/clefs'

// Plays a Song: every unmuted track, each through its instrument. Timing
// comes from the Tone.js Transport, so tempo, looping and the playhead are
// handled by Tone. The sound comes from a Voice: a sampled instrument from
// smplr (downloaded the first time it is used) or a Tone.js synth. Both run on
// Tone's AudioContext so scheduled times line up.
//
// Slides bend the pitch of a sounding note. Synths do this with their detune
// parameter. smplr has no pitch bend, but it creates its audio source
// synchronously for notes due within its lookahead (which Transport callbacks
// always are), so the source is caught as it is made and its detune ramped.

export interface LoadStatus {
  state: 'loading' | 'ready' | 'error'
  loaded: number
  total: number
}

/** A pitch glide during a note: seconds from the note's start, to an absolute MIDI pitch. */
export interface Glide {
  start: number
  end: number
  midi: number
}

interface Voice {
  play(midi: number, time: number, duration: number, glides?: Glide[]): void
  stopAll(): void
}

type MonoSynth = Tone.Synth | Tone.FMSynth | Tone.AMSynth
type AnySynth = Tone.PolySynth<Tone.Synth> | Tone.PolySynth<Tone.FMSynth> | Tone.PolySynth<Tone.AMSynth>

/** Build a synth for a kind: polyphonic for normal notes, or a single voice for a slide. */
function makeSynth(kind: string, mono: true): MonoSynth
function makeSynth(kind: string, mono?: false): AnySynth
function makeSynth(kind: string, mono = false): MonoSynth | AnySynth {
  switch (kind) {
    case 'bell': {
      const o = {
        harmonicity: 3.01,
        modulationIndex: 14,
        envelope: { attack: 0.002, decay: 0.6, sustain: 0.1, release: 0.8 },
        modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.4 },
      }
      return mono ? new Tone.FMSynth(o) : new Tone.PolySynth(Tone.FMSynth, o)
    }
    case 'organ': {
      const o = {
        harmonicity: 2,
        oscillator: { type: 'sine' as const },
        envelope: { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.15 },
      }
      return mono ? new Tone.AMSynth(o) : new Tone.PolySynth(Tone.AMSynth, o)
    }
    default: {
      const o = {
        oscillator: { type: kind as 'square' | 'triangle' | 'sawtooth' },
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.5, release: 0.2 },
      }
      return mono ? new Tone.Synth(o) : new Tone.PolySynth(Tone.Synth, o)
    }
  }
}

/** Schedule detune ramps (in cents relative to `midi`) for a note's glides. */
function rampDetune(param: AudioParam | Tone.Signal<'cents'>, midi: number, time: number, glides: Glide[]) {
  let cents = 0
  param.setValueAtTime(0, time)
  for (const g of glides) {
    param.setValueAtTime(cents, time + g.start)
    cents = (g.midi - midi) * 100
    param.linearRampToValueAtTime(cents, time + Math.max(g.end, g.start + 0.01))
  }
}

const SYNTH_VOLUME: Record<string, number> = { square: -18, sawtooth: -18, triangle: -8, bell: -10, organ: -12 }

/** The piano only downloads its mezzo-forte layer and plays everything at that velocity. */
const PIANO_VELOCITY = 92

/** MIDI notes the bass and treble staves can hold, with room for accidentals (G2 to C♯6). */
const LOW = toMidi(clefRange(getClef('bass')).lo, -1)
const HIGH = toMidi(clefRange(getClef('treble')).hi, 1)
const STAFF_RANGE = Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i)

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
      const volume = SYNTH_VOLUME[src.synth] ?? -12
      const synth = makeSynth(src.synth).toDestination()
      synth.volume.value = volume
      const gliding = new Set<MonoSynth>()
      this.setStatus(def.id, { state: 'ready', loaded: 1, total: 1 })
      return {
        play: (midi, time, duration, glides) => {
          const freq = Tone.Frequency(midi, 'midi').toFrequency()
          if (!glides?.length) {
            synth.triggerAttackRelease(freq, duration, time)
            return
          }
          // A one-off voice so its pitch can bend without touching other notes.
          const one = makeSynth(src.synth, true).toDestination()
          one.volume.value = volume
          gliding.add(one)
          rampDetune(one.detune, midi, time, glides)
          one.triggerAttackRelease(freq, duration, time)
          setTimeout(() => {
            gliding.delete(one)
            one.dispose()
          }, (time - Tone.now() + duration + 2) * 1000)
        },
        stopAll: () => {
          synth.releaseAll()
          gliding.forEach((g) => g.triggerRelease())
        },
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
      play: (midi, time, duration, glides) => {
        if (!glides?.length) {
          inst.start({ note: midi, time, duration })
          return
        }
        const sources = catchSources(context, () => inst.start({ note: midi, time, duration }))
        if (sources.length) {
          for (const s of sources) {
            if (s.detune) rampDetune(s.detune, midi, time, glides)
            else rampRate(s.playbackRate, midi, time, glides)
          }
        } else {
          // Could not reach the source: play each slide target as its own note instead.
          glides.forEach((g, i) => {
            const end = glides[i + 1]?.end ?? duration
            inst.start({ note: g.midi, time: time + g.end, duration: Math.max(0.05, end - g.end) })
          })
        }
      },
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

  private instrumentsOf = (song: Song | null) => new Set(song ? song.tracks.filter((t) => !t.muted).map((t) => t.instrument) : [])

  /** (Re)schedule a song. Safe to call while playing: the transport keeps its position. */
  load(song: Song) {
    const now = this.instrumentsOf(song)
    for (const id of this.instrumentsOf(this.song)) if (!now.has(id)) this.voice(id).stopAll()
    this.song = song
    const transport = Tone.getTransport()
    transport.cancel(0)
    transport.bpm.value = song.tempo
    transport.timeSignature = song.beatsPerMeasure
    transport.loop = true
    transport.loopStart = 0
    transport.loopEnd = `${song.measures}:0:0`
    const beatSeconds = 60 / song.tempo
    const sec = (ticks: number) => (ticks / TPQ) * beatSeconds
    const ticksPerTick = transport.PPQ / TPQ
    song.tracks.forEach((track, i) => {
      if (track.muted) return
      const voice = this.voice(track.instrument)
      for (const note of soundingNotes(partOf(song, i))) {
        const seconds = sec(note.dur) * 0.95
        const glides = note.bends.map((b) => ({ start: sec(b.start), end: sec(b.end), midi: b.midi }))
        transport.schedule((time) => voice.play(note.midi, time, seconds, glides), `${Math.round(note.start * ticksPerTick)}i`)
      }
    })
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
    for (const id of this.instrumentsOf(this.song)) this.voice(id).stopAll()
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

/**
 * Like rampDetune, for sources without a detune parameter: scale the playback
 * rate the sampler already set (which shifts the sample to the right note).
 */
function rampRate(param: AudioParam, midi: number, time: number, glides: Glide[]) {
  const base = param.value
  let rate = base
  for (const g of glides) {
    param.setValueAtTime(rate, time + g.start)
    rate = base * Math.pow(2, (g.midi - midi) / 12)
    param.exponentialRampToValueAtTime(rate, time + Math.max(g.end, g.start + 0.01))
  }
}

/** Run `f` and collect the buffer sources it creates on `context`. */
function catchSources(context: AudioContext, f: () => void): AudioBufferSourceNode[] {
  const ctx = context as AudioContext & { createBufferSource: () => AudioBufferSourceNode }
  const original = ctx.createBufferSource
  const caught: AudioBufferSourceNode[] = []
  ctx.createBufferSource = function (this: AudioContext) {
    const s = original.call(this)
    caught.push(s)
    return s
  }
  try {
    f()
  } finally {
    ctx.createBufferSource = original
  }
  return caught
}
