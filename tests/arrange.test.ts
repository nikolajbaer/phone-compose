import { describe, expect, it } from 'vitest'
import { generatePart, PATTERNS } from '../src/music/arrange'
import { specName } from '../src/music/chordBuilder'
import { clefRange, getClef } from '../src/music/clefs'
import { TPQ, describeTicks } from '../src/music/duration'
import { extractPhrase, insertPhrase, ensureMeasures } from '../src/music/phrases'
import { chordAt, fillProgression, presetChords, progressionSpans, setChordAt, suggestChords } from '../src/music/progression'
import { addTrack, createSong, measureEvents, partOf, placeNote, soundingNotes, withPart, type Part, type Song } from '../src/music/song'
import { mod, pitchName } from '../src/music/theory'

const Q = TPQ
const song4 = (instrument = 'square'): Song => createSong({ title: 'T', tempo: 120, beatsPerMeasure: 4, fifths: 0, instrument, measures: 4 })
const add = (p: Part, m: number, tick: number, dur: number, step: number, alter?: number) => {
  const r = placeNote(p, m, tick, dur, step, alter)
  if (r.error) throw new Error(r.error)
  return r.song
}
const withPreset = (s: Song, degrees: number[]) => fillProgression(s, presetChords(s.fifths, degrees))
const names = (notes: { step: number; alter: number }[]) => notes.map((n) => pitchName(n.step, n.alter))

describe('progression', () => {
  it('fills presets one chord per bar and finds the chord at a time', () => {
    const s = withPreset(song4(), [0, 4, 5, 3])
    expect(progressionSpans(s).map((x) => specName(x.entry.spec))).toEqual(['C', 'G', 'Am', 'F'])
    expect(specName(chordAt(s, 4 * Q + Q)!.spec)).toBe('G')
  })

  it('makes V a seventh when it leads back to I', () => {
    expect(presetChords(0, [0, 3, 4, 0]).map(specName)).toEqual(['C', 'F', 'G7', 'C'])
  })

  it('splits a bar when a chord is set on a later beat', () => {
    let s = withPreset(song4(), [0])
    s = setChordAt(s, 0, 2 * Q, presetChords(0, [3])[0])
    const spans = progressionSpans(s)
    expect(spans.slice(0, 2).map((x) => [specName(x.entry.spec), x.start, x.end])).toEqual([
      ['C', 0, 2 * Q],
      ['F', 2 * Q, 4 * Q],
    ])
  })

  it('suggests chords that fit a melody', () => {
    let m = partOf(song4(), 0)
    // Bar 1: C E G (C), bar 2: B D (G), bar 3: A C E (Am), bar 4: F A (F)
    const bars = [[0, 2, 4], [6, 8], [5, 7, 9], [3, 5]]
    bars.forEach((steps, bar) => steps.forEach((st, i) => (m = add(m, bar, i * Q, Q, st))))
    expect(suggestChords(m).map(specName)).toEqual(['C', 'G', 'Am', 'F'])
  })
})

describe('generated parts', () => {
  const base = () => withPreset(song4(), [0, 4, 5, 3])

  for (const pat of PATTERNS) {
    it(`${pat.name}: fills every bar with writable notes inside the staff`, () => {
      const s = base()
      const part = generatePart(s, partOf(s, 0), { pattern: pat.id, fromMeasure: 0, toMeasure: 3 })
      const { lo, hi } = clefRange(getClef(part.clef))
      expect(part.notes.length).toBeGreaterThan(0)
      for (const n of part.notes) {
        expect(describeTicks(n.dur), `${n.dur}`).toBeTruthy()
        expect(n.step).toBeGreaterThanOrEqual(lo)
        expect(n.step).toBeLessThanOrEqual(hi)
      }
      for (let m = 0; m < 4; m++) expect(measureEvents(part, m).some((e) => e.kind === 'chord'), `bar ${m + 1}`).toBe(true)
    })
  }

  it('arpeggiates the chord of each bar', () => {
    const s = base()
    const part = generatePart(s, partOf(s, 0), { pattern: 'arpUp', rhythm: Q / 2, fromMeasure: 1, toMeasure: 1 })
    const bar = part.notes.filter((n) => n.measure === 1).sort((a, b) => a.tick - b.tick)
    expect(bar).toHaveLength(8)
    expect(new Set(names(bar).map((n) => n.replace(/\d/, '')))).toEqual(new Set(['G', 'B', 'D']))
  })

  it('holds block chords as tied notes and plays them as one', () => {
    let s = fillProgression(song4(), presetChords(0, [0]))
    s = setChordAt(s, 0, Q, presetChords(0, [3])[0]) // C for one beat, then F for 3 beats + bars...
    s = setChordAt(s, 1, 0, presetChords(0, [4])[0])
    const part = generatePart(s, partOf(s, 0), { pattern: 'block', fromMeasure: 0, toMeasure: 1 })
    const sounding = soundingNotes(part)
    // F (beats 2-4) is one dotted half; nothing longer than the chord.
    const f = sounding.filter((n) => n.start === Q)
    expect(f.length).toBe(3)
    expect(f.every((n) => n.dur === 3 * Q)).toBe(true)
  })

  it('keeps bass parts low in a bass clef and leaves other bars alone', () => {
    let s = addTrack(base(), 'cello')
    let cello = partOf(s, 1)
    cello = add(cello, 3, 0, Q, -7)
    cello = generatePart(s, cello, { pattern: 'walking', fromMeasure: 0, toMeasure: 2 })
    s = withPart(s, 1, cello)
    const bar1 = partOf(s, 1).notes.filter((n) => n.measure === 0).sort((a, b) => a.tick - b.tick)
    expect(names(bar1)[0]).toMatch(/^C[23]$/)
    expect(bar1).toHaveLength(4)
    // Last beat of bar 1 steps into G (the next chord): F.
    expect(names(bar1)[3][0]).toBe('F')
    expect(partOf(s, 1).notes.filter((n) => n.measure === 3)).toHaveLength(1)
  })
})

describe('phrases', () => {
  const melody = () => {
    let p = partOf(song4(), 0)
    p = add(p, 0, 0, Q, 7) // C5
    p = add(p, 0, Q, Q, 8)
    p = add(p, 1, 0, 2 * Q, 9)
    return p
  }

  it('repeats bars elsewhere, replacing what was there', () => {
    let p = melody()
    p = add(p, 2, 0, Q, 0)
    const ph = extractPhrase(p, 0, 1, 'Hook')
    p = insertPhrase(p, ph, 2, 'none')
    const bars23 = p.notes.filter((n) => n.measure >= 2).sort((a, b) => a.measure - b.measure || a.tick - b.tick)
    expect(bars23.map((n) => [n.measure, n.tick, n.step])).toEqual([
      [2, 0, 7],
      [2, Q, 8],
      [3, 0, 9],
    ])
    expect(new Set(p.notes.map((n) => n.id)).size).toBe(p.notes.length)
  })

  it('harmonises a third below in the key and fits other instruments by octaves', () => {
    const ph = extractPhrase(melody(), 0, 1)
    const s = addTrack(song4(), 'cello')
    const cello = insertPhrase(partOf(s, 1), ph, 0, 'fit')
    const { lo, hi } = clefRange(getClef('bass'))
    expect(cello.notes.every((n) => n.step >= lo && n.step <= hi)).toBe(true)
    expect(cello.notes.map((n) => mod(n.step, 7))).toEqual(ph.notes.map((n) => mod(n.step, 7)))
    const third = insertPhrase(partOf(s, 0), ph, 0, 'thirdBelow')
    expect(names(third.notes.sort((a, b) => a.measure - b.measure || a.tick - b.tick))).toEqual(['A4', 'B4', 'C5'])
  })

  it('keeps ties inside the phrase', () => {
    let p = melody()
    p = { ...p, notes: p.notes.map((n, i, all) => (i === 0 ? { ...n, tieTo: all[1].id } : n)) }
    const ph = extractPhrase(p, 0, 0)
    const placed = insertPhrase(p, ph, 3, 'none').notes.filter((n) => n.measure === 3)
    const first = placed.find((n) => n.tick === 0)!
    expect(first.tieTo).toBe(placed.find((n) => n.tick === Q)!.id)
  })

  it('adds bars to the song when needed', () => {
    expect(ensureMeasures(song4(), 8).measures).toBe(8)
    expect(ensureMeasures(song4(), 2).measures).toBe(4)
  })
})
