// Durations are integer ticks. A quarter note is 48 ticks, which divides
// evenly into eighths (24), sixteenths (12), dotted values (72, 36, 18) and
// triplets (32, 16, 8).

export const TPQ = 48

export type BaseDuration = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth'

export const BASE_TICKS: Record<BaseDuration, number> = {
  whole: 4 * TPQ,
  half: 2 * TPQ,
  quarter: TPQ,
  eighth: TPQ / 2,
  sixteenth: TPQ / 4,
}

export const BASES: BaseDuration[] = ['whole', 'half', 'quarter', 'eighth', 'sixteenth']

/** What the palette has selected: a base value, optionally dotted or triplet (not both). */
export interface DurationChoice {
  base: BaseDuration
  dotted: boolean
  triplet: boolean
}

export function choiceTicks({ base, dotted, triplet }: DurationChoice): number {
  const t = BASE_TICKS[base]
  if (dotted) return (t * 3) / 2
  if (triplet) return (t * 2) / 3
  return t
}

/** How a duration in ticks is written, for the values the palette can make. */
export function describeTicks(ticks: number): DurationChoice | null {
  for (const base of BASES) {
    const t = BASE_TICKS[base]
    if (ticks === t) return { base, dotted: false, triplet: false }
    if (ticks * 2 === t * 3) return { base, dotted: true, triplet: false }
    if (ticks * 3 === t * 2) return { base, dotted: false, triplet: true }
  }
  return null
}

export const isTriplet = (ticks: number) => describeTicks(ticks)?.triplet === true

/** Shapes of rests, smallest last; 32nd and 64th only appear to fill odd gaps. */
export type RestShape = BaseDuration | 'thirtysecond' | 'sixtyfourth'

const PLAIN_RESTS: [number, RestShape][] = [
  [TPQ, 'quarter'],
  [TPQ / 2, 'eighth'],
  [TPQ / 4, 'sixteenth'],
  [TPQ / 8, 'thirtysecond'],
  [TPQ / 16, 'sixtyfourth'],
]
const TRIPLET_RESTS: [number, RestShape][] = [
  [(TPQ * 2) / 3, 'quarter'],
  [TPQ / 3, 'eighth'],
  [TPQ / 6, 'sixteenth'],
]

export interface RestPiece {
  tick: number
  dur: number
  shape: RestShape
  triplet: boolean
}

/**
 * Split a silent stretch [from, to) of a measure into rests. Each rest is the
 * largest value that starts on its own grid and fits; rests never cross a
 * beat, so an empty beat is always a quarter rest you can tap. Leftovers
 * after triplets become triplet rests.
 */
export function restsFor(from: number, to: number): RestPiece[] {
  const out: RestPiece[] = []
  let p = from
  while (p < to) {
    const beatStart = Math.floor(p / TPQ) * TPQ
    const end = Math.min(to, beatStart + TPQ)
    // Line rests up with the beat they are in.
    const fit = (list: [number, RestShape][]) => list.find(([v]) => (p - beatStart) % v === 0 && p + v <= end)
    const plain = fit(PLAIN_RESTS)
    const trip = plain ? undefined : fit(TRIPLET_RESTS)
    if (plain) out.push({ tick: p, dur: plain[0], shape: plain[1], triplet: false })
    else if (trip) out.push({ tick: p, dur: trip[0], shape: trip[1], triplet: true })
    else {
      // Odd remainder (should not happen with palette values): one small rest.
      const dur = Math.min(end - p, TPQ / 16)
      out.push({ tick: p, dur, shape: 'sixtyfourth', triplet: false })
    }
    p += out[out.length - 1].dur
  }
  return out
}
