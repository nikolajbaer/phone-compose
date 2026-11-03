import { chordName } from '../music/chords'
import { TPQ, describeTicks } from '../music/duration'
import type { MeasureEvent, Part } from '../music/song'
import { accidentalsInMeasure, measureEvents, measureTicks } from '../music/song'
import { getClef, stemUpFor, type ClefDef } from '../music/clefs'

// Horizontal layout of the score. Each event (chord or rest) gets a slot whose
// width grows with its length, so short notes stay wide enough to tap.
// Eighths and shorter inside one beat are beamed together.

export const SPACE = 24 // staff space in px; Bravura is sized 4 spaces to the em
export const STEP = SPACE / 2
export const MEASURE_PAD_L = 14
export const MEASURE_PAD_R = 6
const ACC_ROOM = 0.9 * SPACE

export interface Slot {
  ev: MeasureEvent
  /** Left edge of the tappable slot. */
  x: number
  w: number
  /** Left edge of the notehead (or rest glyph). */
  headX: number
  /** Index of the beam group this chord belongs to, if beamed. */
  beam?: number
}

export interface BeamGroup {
  slots: Slot[]
  up: boolean
}

export interface TupletGroup {
  slots: Slot[]
}

export interface MeasureLayout {
  index: number
  x: number
  width: number
  slots: Slot[]
  beams: BeamGroup[]
  tuplets: TupletGroup[]
  /** Ids of notes that print an accidental. */
  accidentals: Set<string>
}

export interface SongLayout {
  measures: MeasureLayout[]
  width: number
  clef: ClefDef
}

export function slotWidth(ev: MeasureEvent, hasAcc: boolean): number {
  let w = 44 + 34 * Math.sqrt(ev.dur / TPQ)
  const d = describeTicks(ev.dur)
  if (d?.dotted) w += 0.6 * SPACE
  if (hasAcc) w += ACC_ROOM
  return Math.round(w)
}

const beamCount = (dur: number) => {
  const base = describeTicks(dur)?.base
  return base === 'eighth' ? 1 : base === 'sixteenth' ? 2 : 0
}
export { beamCount }

export function layoutSong(song: Part): SongLayout {
  return layoutStaves([song])[0]
}

/**
 * Lay out several staves that share measures (a grand staff) so barlines and
 * notes sounding together line up. Every onset on any staff starts a column;
 * each column is as wide as the widest share any staff's event needs of it,
 * and an event's slot spans the columns it lasts through. With one staff the
 * columns are just its events.
 */
export function layoutStaves(parts: Part[]): SongLayout[] {
  const clefs = parts.map((p) => getClef(p.clef))
  const out: MeasureLayout[][] = parts.map(() => [])
  const measures = parts[0].measures
  let x = 0
  for (let m = 0; m < measures; m++) {
    const events = parts.map((p) => measureEvents(p, m))
    const accidentals = parts.map((p) => accidentalsInMeasure(p, m))
    const len = measureTicks(parts[0])
    const onsets = [...new Set(events.flatMap((evs) => evs.map((e) => e.tick)))].sort((a, b) => a - b)
    const edges = [...onsets, len]
    const colW = onsets.map((t, i) => {
      const colDur = edges[i + 1] - t
      let w = 0
      events.forEach((evs, k) => {
        const e = evs.find((ev) => ev.tick <= t && ev.tick + ev.dur > t)
        if (!e) return
        const hasAcc = e.kind === 'chord' && e.notes.some((n) => accidentals[k].has(n.id))
        w = Math.max(w, (slotWidth(e, hasAcc) * colDur) / e.dur)
      })
      return w
    })
    const colX: number[] = []
    let cx = x + MEASURE_PAD_L
    for (const w of colW) {
      colX.push(cx)
      cx += w
    }
    colX.push(cx)
    const width = Math.round(cx + MEASURE_PAD_R - x)
    const xAt = (tick: number) => colX[edges.indexOf(tick)] ?? cx

    parts.forEach((_, k) => {
      const slots: Slot[] = events[k].map((ev) => {
        const hasAcc = ev.kind === 'chord' && ev.notes.some((n) => accidentals[k].has(n.id))
        const sx = xAt(ev.tick)
        return { ev, x: sx, w: xAt(ev.tick + ev.dur) - sx, headX: sx + 8 + (hasAcc ? ACC_ROOM : 0) }
      })
      out[k].push({ index: m, x, width, slots, beams: beamGroups(slots, clefs[k]), tuplets: tupletGroups(slots), accidentals: accidentals[k] })
    })
    x += width
  }
  return out.map((ms, k) => ({ measures: ms, width: x, clef: clefs[k] }))
}

/** Beams: runs of beamable chords within one beat. */
function beamGroups(slots: Slot[], clef: ClefDef): BeamGroup[] {
  const beams: BeamGroup[] = []
  let run: Slot[] = []
  const flush = () => {
    if (run.length >= 2) {
      const steps = run.flatMap((s) => (s.ev.kind === 'chord' ? s.ev.notes.map((n) => n.step) : []))
      const g = beams.length
      run.forEach((s) => (s.beam = g))
      beams.push({ slots: run, up: stemUpFor(clef, steps) })
    }
    run = []
  }
  for (const s of slots) {
    const beat = Math.floor(s.ev.tick / TPQ)
    const prevBeat = run.length ? Math.floor(run[0].ev.tick / TPQ) : beat
    if (s.ev.kind !== 'chord' || beamCount(s.ev.dur) === 0 || beat !== prevBeat) flush()
    if (s.ev.kind === 'chord' && beamCount(s.ev.dur) > 0) run.push(s)
  }
  flush()
  return beams
}

/** Tuplets: runs of triplet-valued events. */
function tupletGroups(slots: Slot[]): TupletGroup[] {
  const tuplets: TupletGroup[] = []
  let tg: Slot[] = []
  const endTuplet = () => {
    if (tg.length) tuplets.push({ slots: tg })
    tg = []
  }
  for (const s of slots) {
    const trip = s.ev.kind === 'rest' ? s.ev.triplet : describeTicks(s.ev.dur)?.triplet
    if (!trip) {
      endTuplet()
      continue
    }
    // A triplet group lasts as long as three of its first note: close it when full.
    const sum = tg.reduce((a, t) => a + t.ev.dur, 0)
    if (tg.length && sum >= 3 * tg[0].ev.dur) endTuplet()
    tg.push(s)
  }
  endTuplet()
  return tuplets
}

/** The slot under an x coordinate. */
export function hitSlot(layout: SongLayout, px: number): { measure: MeasureLayout; slot: Slot } | null {
  const measure = layout.measures.find((m) => px >= m.x && px < m.x + m.width) ?? layout.measures[layout.measures.length - 1]
  if (!measure) return null
  const slot =
    measure.slots.find((s) => px >= s.x && px < s.x + s.w) ??
    (px < measure.slots[0].x ? measure.slots[0] : measure.slots[measure.slots.length - 1])
  return { measure, slot }
}

/** x of a play position, in ticks from the start of the song. */
export function tickToX(song: Part, layout: SongLayout, tick: number): number {
  const len = measureTicks(song)
  const m = Math.min(layout.measures.length - 1, Math.floor(tick / len))
  const measure = layout.measures[m]
  const local = tick - m * len
  for (const s of measure.slots) {
    if (local >= s.ev.tick && local < s.ev.tick + s.ev.dur) return s.headX + ((local - s.ev.tick) / s.ev.dur) * s.w
  }
  return measure.x + measure.width
}

/** Chord symbols to print above the staff. */
export function chordLabels(layout: SongLayout): { x: number; text: string; key: string }[] {
  const out: { x: number; text: string; key: string }[] = []
  for (const m of layout.measures) {
    for (const s of m.slots) {
      if (s.ev.kind !== 'chord') continue
      const text = chordName(s.ev.notes)
      if (text) out.push({ x: s.headX, text, key: `${m.index}:${s.ev.tick}` })
    }
  }
  return out
}

/** x of a bar and tick (where a note there would start). */
export function xOfTick(layout: SongLayout, measure: number, tick: number): number {
  const m = layout.measures[measure]
  if (!m) return layout.width
  const s = m.slots.find((sl) => tick >= sl.ev.tick && tick < sl.ev.tick + sl.ev.dur)
  return s ? s.x + ((tick - s.ev.tick) / s.ev.dur) * s.w : m.x + MEASURE_PAD_L
}

/** The bar and beat (in ticks, rounded down to the beat) under an x coordinate. */
export function beatAtX(layout: SongLayout, px: number): { measure: number; tick: number } | null {
  const hit = hitSlot(layout, px)
  if (!hit) return null
  const { slot } = hit
  const t = slot.ev.tick + Math.max(0, Math.min(0.999, (px - slot.x) / slot.w)) * slot.ev.dur
  return { measure: hit.measure.index, tick: Math.floor(t / TPQ) * TPQ }
}
