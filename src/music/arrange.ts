import { voiceChord, type ChordSpec, type Pitch } from './chordBuilder'
import { clefRange, getClef } from './clefs'
import { TPQ, describeTicks } from './duration'
import { progressionSpans } from './progression'
import type { Note, Part, Song } from './song'
import { measureTicks, uid } from './song'
import { keyAlter, letterOf, mod } from './theory'

// Supporting parts generated from the chord progression: block chords,
// comping, arpeggios, bass lines and scale runs. They are written as
// ordinary notes, so they can be edited freely afterwards; generating again
// rewrites the chosen bars.

export type PatternId = 'block' | 'pulse' | 'arpUp' | 'arpUpDown' | 'alberti' | 'bassRoot' | 'bassRootFifth' | 'walking' | 'run'

export interface PatternDef {
  id: PatternId
  name: string
  hint: string
  /** Note lengths it can use (ticks); empty for held patterns. */
  rhythms: number[]
  /** Sits low in the staff's range. */
  low?: boolean
}

const Q = TPQ
export const PATTERNS: PatternDef[] = [
  { id: 'block', name: 'Block chords', hint: 'Each chord held for as long as it lasts', rhythms: [] },
  { id: 'pulse', name: 'Comping', hint: 'The chord repeated in rhythm', rhythms: [2 * Q, Q, Q / 2] },
  { id: 'arpUp', name: 'Arpeggio', hint: 'Chord tones rising', rhythms: [Q / 2, Q / 4, Q / 3] },
  { id: 'arpUpDown', name: 'Arpeggio up & down', hint: 'Chord tones rising and falling', rhythms: [Q / 2, Q / 4, Q / 3] },
  { id: 'alberti', name: 'Alberti bass', hint: 'Low, high, middle, high', rhythms: [Q / 2, Q / 4], low: true },
  { id: 'bassRoot', name: 'Bass: roots', hint: 'The bass note of each chord, held', rhythms: [], low: true },
  { id: 'bassRootFifth', name: 'Bass: root & fifth', hint: 'Root and fifth alternating', rhythms: [2 * Q, Q], low: true },
  { id: 'walking', name: 'Walking bass', hint: 'Chord tones on the beat, stepping into the next chord', rhythms: [Q], low: true },
  { id: 'run', name: 'Scale runs', hint: 'Scale steps from each chord to the next', rhythms: [Q / 2, Q / 4] },
]

export const getPattern = (id: PatternId) => PATTERNS.find((p) => p.id === id) ?? PATTERNS[0]

export interface GenerateOptions {
  pattern: PatternId
  /** Note length for rhythmic patterns (ticks). */
  rhythm?: number
  fromMeasure: number
  /** Inclusive. */
  toMeasure: number
}

/** Lengths the score can write, longest first. */
const WRITABLE = [4 * Q, 3 * Q, 2 * Q, (3 * Q) / 2, Q, (3 * Q) / 4, Q / 2, (3 * Q) / 8, Q / 4]

/** Split a held stretch into writable lengths (to be tied together). */
function heldPieces(len: number): number[] {
  const out: number[] = []
  let left = len
  while (left > 0) {
    const v = WRITABLE.find((w) => w <= left)
    if (!v) break
    out.push(v)
    left -= v
  }
  return out
}

interface Slot {
  measure: number
  tick: number
  dur: number
  /** Tie to the next slot (held patterns). */
  tie?: boolean
}

/** A pitch moved by octaves into a range. */
function fit(p: Pitch, lo: number, hi: number): Pitch {
  let step = p.step
  while (step < lo) step += 7
  while (step > hi) step -= 7
  return { step, alter: p.alter }
}

/** Write notes for one chord span's slots. */
type Voicer = (slots: Slot[], spec: ChordSpec, next: ChordSpec | undefined) => Pitch[][]

/**
 * Rewrite bars [from, to] of a part with a pattern following the song's
 * progression. Bars without a chord are left empty.
 */
export function generatePart(song: Song, part: Part, opts: GenerateOptions): Part {
  const def = getPattern(opts.pattern)
  const len = measureTicks(part)
  const from = opts.fromMeasure * len
  const to = (opts.toMeasure + 1) * len
  const range = clefRange(getClef(part.clef))
  // Where chords sit: a third up from the bottom for bass parts, the middle otherwise.
  const target = def.low ? range.lo + 2 : Math.round((range.lo + range.hi) / 2) - 3
  const rhythm = def.rhythms.length ? (def.rhythms.includes(opts.rhythm ?? -1) ? opts.rhythm! : def.rhythms[0]) : 0
  const keyOf = (step: number) => keyAlter(letterOf(step), part.fifths)

  const voicing = (spec: ChordSpec) => voiceChord(spec, target, range)
  const rootPos = (spec: ChordSpec) => voiceChord({ ...spec, inversion: 0 }, target, range)
  const lo = range.lo
  const hi = range.hi

  const voicers: Record<PatternId, Voicer> = {
    block: (slots, spec) => slots.map(() => voicing(spec)),
    pulse: (slots, spec) => slots.map(() => voicing(spec)),
    arpUp: (slots, spec) => {
      const v = voicing(spec)
      const tones = [...v, { step: v[0].step + 7, alter: v[0].alter }]
      return slots.map((_, i) => [fit(tones[i % tones.length], lo, hi)])
    },
    arpUpDown: (slots, spec) => {
      const v = voicing(spec)
      const up = [...v, { step: v[0].step + 7, alter: v[0].alter }]
      const cycle = [...up, ...up.slice(1, -1).reverse()]
      return slots.map((_, i) => [fit(cycle[i % cycle.length], lo, hi)])
    },
    alberti: (slots, spec) => {
      const v = voicing(spec)
      const [low, mid, high] = [v[0], v[1], v[Math.min(2, v.length - 1)]]
      const cycle = [low, high, mid, high]
      return slots.map((_, i) => [cycle[i % 4]])
    },
    bassRoot: (slots, spec) => slots.map(() => [voicing(spec)[0]]),
    bassRootFifth: (slots, spec) => {
      const v = rootPos(spec)
      const root = voicing(spec)[0]
      const fifth = fit(v.find((p) => p.step - v[0].step === 4) ?? v[v.length - 1], lo, hi)
      return slots.map((_, i) => [i % 2 === 0 ? root : fifth])
    },
    walking: (slots, spec, next) => {
      const v = rootPos(spec)
      const tones = [voicing(spec)[0], v[1], v[2] ?? v[1], v[1]]
      return slots.map((_, i) => {
        if (i === slots.length - 1 && next && slots.length > 1) {
          // Step into the next chord's bass note from a step below.
          const target = fit(voiceChord(next, tones[0].step, range)[0], lo, hi)
          const step = target.step - 1 >= lo ? target.step - 1 : target.step + 1
          return [{ step, alter: keyOf(step) }]
        }
        return [fit(tones[i % tones.length], lo, hi)]
      })
    },
    run: (slots, spec, next) => {
      const v = voicing(spec)
      const chordAlter = new Map(v.map((p) => [mod(p.step, 7), p.alter]))
      const alterFor = (step: number) => chordAlter.get(mod(step, 7)) ?? keyOf(step)
      const start = rootPos(spec)[0].step
      let end = start
      if (next) {
        const nr = rootPos(next)[0].step
        end = [nr - 7, nr, nr + 7].sort((a, b) => Math.abs(a - start) - Math.abs(b - start))[0]
      }
      const out: Pitch[][] = []
      let cur = start
      let dir = end >= start ? 1 : -1
      for (let i = 0; i < slots.length; i++) {
        out.push([{ step: cur, alter: alterFor(cur) }])
        const remaining = slots.length - i
        const dist = end - cur
        // Head for the next chord, wandering on in the same direction while there is time.
        if (Math.abs(dist) >= remaining - 1 && dist !== 0) dir = Math.sign(dist)
        if (cur + dir > hi || cur + dir < lo) dir = -dir
        cur += dir
      }
      return out
    },
  }

  const kept = part.notes.filter((n) => n.measure < opts.fromMeasure || n.measure > opts.toMeasure)
  const added: Note[] = []
  const spans = progressionSpans(song)
  spans.forEach((span, si) => {
    const s0 = Math.max(span.start, from)
    const s1 = Math.min(span.end, to)
    if (s1 <= s0) return
    // Slots of this span, never crossing a barline.
    const slots: Slot[] = []
    for (let m = Math.floor(s0 / len); m * len < s1; m++) {
      const a = Math.max(s0, m * len) - m * len
      const b = Math.min(s1, (m + 1) * len) - m * len
      if (!rhythm) {
        let t = a
        for (const d of heldPieces(b - a)) {
          slots.push({ measure: m, tick: t, dur: d, tie: true })
          t += d
        }
      } else {
        for (let t = a; t + rhythm <= b; t += rhythm) slots.push({ measure: m, tick: t, dur: rhythm })
      }
    }
    if (!slots.length) return
    slots[slots.length - 1].tie = false
    const pitches = voicers[def.id](slots, span.entry.spec, spans[si + 1]?.entry.spec)
    let prevIds: Map<number, string> | null = null
    slots.forEach((slot, i) => {
      const seen = new Set<number>()
      const ids = new Map<number, string>()
      for (const p of pitches[i]) {
        if (seen.has(p.step)) continue
        seen.add(p.step)
        const note: Note = { id: uid(), measure: slot.measure, tick: slot.tick, dur: slot.dur, step: p.step, alter: p.alter }
        ids.set(p.step, note.id)
        added.push(note)
      }
      // Held patterns tie each pitch on to the same pitch in the next piece.
      if (prevIds) {
        for (const [step, prevId] of prevIds) {
          const id = ids.get(step)
          const prev = added.find((n) => n.id === prevId)
          if (id && prev) prev.tieTo = id
        }
      }
      prevIds = slot.tie ? ids : null
    })
  })
  // Every length written must be one the score can show.
  const writable = added.filter((n) => describeTicks(n.dur))
  return { ...part, notes: [...kept, ...writable], updatedAt: Date.now() }
}
