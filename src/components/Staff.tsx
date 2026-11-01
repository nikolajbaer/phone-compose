import { useEffect, useMemo, useRef, useState } from 'react'
import { TPQ, describeTicks, type BaseDuration, type RestShape } from '../music/duration'
import type { Chord, Note, Part } from '../music/song'
import { MAX_POS, MIN_POS, MIDDLE_POS, clampPos, keyAlter, letterOf, pitchName } from '../music/theory'
import { clefPosToStep, clefStepToPos, getClef, stemUpFor, type ClefDef } from '../music/clefs'
import { isSlide, tieTarget } from '../music/song'
import { SPACE, STEP, beamCount, hitSlot, layoutStaves, tickToX, type Slot, type SongLayout } from './staffLayout'
import { chordName } from '../music/chords'

// The score: one staff (treble, bass, alto... per the song's clef) drawn in SVG with SMuFL glyphs from the Bravura
// font. The clef, key and time signature open the line, and the whole line
// scrolls sideways. Chord symbols are printed above the staff.
//
// Touch: press on a rest to get a ghost note of the selected length, slide up
// or down to pick the pitch, release to write it. Press on a chord to add a
// pitch to it. Tap a note to select it (the palette then changes its length,
// the bin deletes it); press on a note and slide to move it. A sideways
// swipe scrolls the score instead.

const FONT = SPACE * 4
const TOP_ROOM = 26 // space above for chord symbols
const BOTTOM_Y = (MAX_POS + 3) * STEP + TOP_ROOM // y of the bottom staff line
export const STAFF_HEIGHT = BOTTOM_Y + (-MIN_POS + 4) * STEP
const CHORD_Y = 34
const STEM_W = 0.12 * SPACE
const STEM_LEN = 3.5 * SPACE
const BEAM_T = 0.5 * SPACE
const BEAM_GAP = 0.75 * SPACE

export const GLYPH = {
  gClef: '',
  noteheadWhole: '',
  noteheadHalf: '',
  noteheadBlack: '',
  flag8thUp: '',
  flag8thDown: '',
  flag16thUp: '',
  flag16thDown: '',
  flat: '',
  natural: '',
  sharp: '',
  dot: '',
  tuplet3: '',
  timeSig: (d: number) => String.fromCodePoint(0xe080 + d),
}

const REST_GLYPH: Record<RestShape, string> = {
  whole: '',
  half: '',
  quarter: '',
  eighth: '',
  sixteenth: '',
  thirtysecond: '',
  sixtyfourth: '',
}

const y = (pos: number) => BOTTOM_Y - pos * STEP
const headWidth = (base: BaseDuration) => (base === 'whole' ? 1.688 : 1.18) * SPACE

function StaffLines({ width }: { width: number }) {
  return (
    <g className="staff-lines">
      {[0, 2, 4, 6, 8].map((p) => (
        <line key={p} x1={0} x2={width} y1={y(p)} y2={y(p)} />
      ))}
    </g>
  )
}

const KEY_SHARP_POS = [8, 5, 9, 6, 3, 7, 4]
const KEY_FLAT_POS = [4, 7, 3, 6, 2, 5, 1]

export function StaffHeader({ song, zoom = 1 }: { song: Part; zoom?: number }) {
  const clef = getClef(song.clef)
  const n = Math.abs(song.fifths)
  const keyX = 6 + 3.2 * SPACE // clefs are about 2.8 spaces wide
  const timeX = keyX + n * 0.95 * SPACE + (n ? 0.4 * SPACE : 0)
  const width = timeX + 2.1 * SPACE
  const digits = (v: number) => String(v).split('').map((d) => GLYPH.timeSig(Number(d))).join('')
  return (
    <svg className="staff-header" width={width * zoom} height={STAFF_HEIGHT * zoom} viewBox={`0 0 ${width} ${STAFF_HEIGHT}`}>
      <StaffLines width={width} />
      <text className="glyph" x={6} y={y(clef.glyphPos)} fontSize={FONT}>
        {clef.glyph}
      </text>
      {Array.from({ length: n }, (_, i) => (
        <text key={i} className="glyph" x={keyX + i * 0.95 * SPACE} y={y((song.fifths > 0 ? KEY_SHARP_POS[i] : KEY_FLAT_POS[i]) + clef.keyShift)} fontSize={FONT}>
          {song.fifths > 0 ? GLYPH.sharp : GLYPH.flat}
        </text>
      ))}
      <text className="glyph" x={timeX} y={y(6)} fontSize={FONT}>
        {digits(song.beatsPerMeasure)}
      </text>
      <text className="glyph" x={timeX} y={y(2)} fontSize={FONT}>
        {digits(4)}
      </text>
      <line className="barline" x1={width - 0.5} x2={width - 0.5} y1={y(8)} y2={y(0)} />
    </svg>
  )
}

/** Where a beamed chord's stem goes. */
interface StemSpec {
  up: boolean
  endY: number
}

/** A chord: noteheads, accidentals, dots, ledger lines, stem and flag (unless beamed). */
function ChordGlyph({
  clef,
  showAcc,
  chord,
  headX,
  stem,
  selectedId,
  hiddenId,
}: {
  clef: ClefDef
  /** Whether a note prints its accidental. */
  showAcc: (n: Note) => boolean
  chord: Pick<Chord, 'dur' | 'notes'>
  headX: number
  stem?: StemSpec
  selectedId?: string | null
  hiddenId?: string
}) {
  const shown = chord.notes.filter((n) => n.id !== hiddenId)
  if (!shown.length) return null
  const d = describeTicks(chord.dur) ?? { base: 'quarter' as const, dotted: false, triplet: false }
  const headW = headWidth(d.base)
  const head = d.base === 'whole' ? GLYPH.noteheadWhole : d.base === 'half' ? GLYPH.noteheadHalf : GLYPH.noteheadBlack
  const poss = shown.map((n) => clefStepToPos(clef, n.step))
  const lo = Math.min(...poss)
  const hi = Math.max(...poss)
  const up = stem?.up ?? stemUpFor(clef, shown.map((n) => n.step))
  const left = headX

  // Notes a second apart sit on opposite sides of the stem.
  const sorted = [...shown].sort((a, b) => (up ? a.step - b.step : b.step - a.step))
  const shift = new Map<string, number>()
  let prev: { step: number; shifted: boolean } | null = null
  for (const n of sorted) {
    const shifted: boolean = !!prev && Math.abs(n.step - prev.step) === 1 && !prev.shifted
    shift.set(n.id, shifted ? (up ? headW - STEM_W : -(headW - STEM_W)) : 0)
    prev = { step: n.step, shifted }
  }
  const anyRight = [...shift.values()].some((v) => v > 0)

  const ledgers: number[] = []
  for (let p = -2; p >= lo; p -= 2) ledgers.push(p)
  for (let p = 10; p <= hi; p += 2) ledgers.push(p)
  const ledgerExt = 0.4 * SPACE

  const flags = stem ? 0 : beamCount(chord.dur)
  const hasStem = d.base !== 'whole'
  const stemX = up ? left + headW - STEM_W / 2 : left + STEM_W / 2
  const stemY1 = up ? y(lo) - 0.15 * SPACE : y(hi) + 0.15 * SPACE
  const extra = flags === 2 ? 0.5 * SPACE : 0
  const stemY2 = stem?.endY ?? (up ? y(hi) - STEM_LEN - extra : y(lo) + STEM_LEN + extra)
  const dotX = left + headW + (anyRight ? headW : 0) + 0.3 * SPACE

  return (
    <g className="chord">
      {ledgers.map((p) => (
        <line key={p} className="ledger" x1={left - ledgerExt} x2={left + headW + ledgerExt} y1={y(p)} y2={y(p)} />
      ))}
      {shown.map((n) => {
        const pos = clefStepToPos(clef, n.step)
        const dx = shift.get(n.id) ?? 0
        const needsAcc = showAcc(n)
        const acc = n.alter > 0 ? GLYPH.sharp : n.alter < 0 ? GLYPH.flat : GLYPH.natural
        const cls = n.id === selectedId ? 'glyph note selected' : 'glyph note'
        return (
          <g key={n.id}>
            {needsAcc && (
              <text className="glyph" x={left + Math.min(0, dx) - 1.3 * SPACE} y={y(pos)} fontSize={FONT}>
                {acc}
              </text>
            )}
            <text className={cls} x={left + dx} y={y(pos)} fontSize={FONT}>
              {head}
            </text>
            {d.dotted && (
              <text className="glyph" x={dotX} y={y(pos % 2 === 0 ? pos + 1 : pos)} fontSize={FONT}>
                {GLYPH.dot}
              </text>
            )}
          </g>
        )
      })}
      {hasStem && <line className="stem" x1={stemX} x2={stemX} y1={stemY1} y2={stemY2} strokeWidth={STEM_W} />}
      {flags > 0 && (
        <text className="glyph" x={stemX - STEM_W / 2} y={stemY2} fontSize={FONT}>
          {flags === 1 ? (up ? GLYPH.flag8thUp : GLYPH.flag8thDown) : up ? GLYPH.flag16thUp : GLYPH.flag16thDown}
        </text>
      )}
    </g>
  )
}

function RestGlyph({ slot }: { slot: Slot }) {
  if (slot.ev.kind !== 'rest') return null
  const shape = slot.ev.shape
  const restY = shape === 'whole' ? y(6) : y(4)
  return (
    <text className="glyph rest" x={slot.headX} y={restY} fontSize={FONT}>
      {REST_GLYPH[shape]}
    </text>
  )
}

const stemXOf = (s: Slot, up: boolean) => s.headX + (up ? 1.18 * SPACE - STEM_W / 2 : STEM_W / 2)

/** Stem ends for each beamed chord, and the beams themselves. */
function beamGeometry(layout: SongLayout) {
  const pos = (n: Note) => clefStepToPos(layout.clef, n.step)
  const stems = new Map<Slot, StemSpec>()
  const beams: { key: string; x1: number; x2: number; y: number }[] = []
  for (const m of layout.measures) {
    m.beams.forEach((g, gi) => {
      const chords = g.slots.map((s) => s.ev as Chord & { kind: 'chord' })
      const double = chords.some((c) => beamCount(c.dur) === 2)
      const len = STEM_LEN + (double ? 0.25 * SPACE : 0)
      const endY = g.up
        ? Math.min(...chords.map((c) => y(Math.max(...c.notes.map(pos))) - len))
        : Math.max(...chords.map((c) => y(Math.min(...c.notes.map(pos))) + len))
      g.slots.forEach((s) => stems.set(s, { up: g.up, endY }))
      const beamY = (level: number) => (g.up ? endY + level * BEAM_GAP : endY - BEAM_T - level * BEAM_GAP)
      const xs = g.slots.map((s) => stemXOf(s, g.up))
      beams.push({ key: `${m.index}:${gi}:p`, x1: xs[0] - STEM_W / 2, x2: xs[xs.length - 1] + STEM_W / 2, y: beamY(0) })
      chords.forEach((c, i) => {
        if (beamCount(c.dur) < 2) return
        const next = chords[i + 1]
        const prevC = chords[i - 1]
        if (next && beamCount(next.dur) === 2) {
          beams.push({ key: `${m.index}:${gi}:s${i}`, x1: xs[i] - STEM_W / 2, x2: xs[i + 1] + STEM_W / 2, y: beamY(1) })
        } else if (!(prevC && beamCount(prevC.dur) === 2)) {
          const stub = 0.9 * SPACE
          const [a, b] = next ? [xs[i] - STEM_W / 2, xs[i] + stub] : [xs[i] - stub, xs[i] + STEM_W / 2]
          beams.push({ key: `${m.index}:${gi}:s${i}`, x1: a, x2: b, y: beamY(1) })
        }
      })
    })
  }
  return { stems, beams }
}

interface Press {
  pointerId: number
  measure: number
  slot: Slot
  pos: number
  /** Set when the press started on an existing note. */
  noteId?: string
  moved: boolean
}

interface StaffRowProps {
  song: Part
  /** This staff's layout, computed together with the other staves of the score. */
  layout: SongLayout
  /** Drawing scale (smaller for a grand staff so both staves fit). */
  zoom: number
  /** Chord symbols to print above this staff. */
  labels: { x: number; text: string; key: string }[]
  /** Print measure numbers (only on the top staff). */
  numbers: boolean
  playheadRef: (el: SVGLineElement | null) => void
  /** Length in ticks of the note the palette will write. */
  inputDur: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onPlace: (measure: number, tick: number, step: number) => void
  onMove: (id: string, step: number) => void
  onPreview: (step: number) => void
  /** Chord input: presses write this chord, voiced with its bass near the pressed pitch. */
  chordInput?: { voice: (bassStep: number) => { step: number; alter: number }[]; label: string } | null
  /** Sharp/flat/natural for notes being written, or null to follow the key. */
  inputAlter?: number | null
}

/** One staff: its header, measures and touch input. */
function StaffRow(props: StaffRowProps) {
  const { song, layout, zoom, labels, numbers, playheadRef, inputDur, selectedId, onSelect, onPlace, onMove, onPreview, chordInput, inputAlter = null } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const [press, setPress] = useState<Press | null>(null)
  const pressRef = useRef<Press | null>(null)
  pressRef.current = press

  const geometry = useMemo(() => beamGeometry(layout), [layout])
  const width = layout.width
  const clef = layout.clef
  const posToStep = (pos: number) => clefPosToStep(clef, pos)
  const stepToPos = (step: number) => clefStepToPos(clef, step)
  const accShown = (n: Note) => layout.measures[n.measure]?.accidentals.has(n.id) ?? false
  const ghostAcc = (n: Note) => n.alter !== keyAlter(letterOf(n.step), song.fifths)
  const ties = useMemo(() => tieCurves(song, layout, geometry.stems), [song, layout, geometry])

  const locate = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const hit = hitSlot(layout, (e.clientX - r.left) / zoom)
    const pos = clampPos(Math.round((BOTTOM_Y - (e.clientY - r.top) / zoom) / STEP))
    return hit ? { measure: hit.measure.index, slot: hit.slot, pos } : null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button > 0) return
    const at = locate(e)
    if (!at) return
    const { measure, slot, pos } = at
    // Grab an existing note if the press is on (or right next to) one.
    let hit: Note | undefined
    // In chord input every press writes the chord, so notes are not grabbed.
    if (slot.ev.kind === 'chord' && !chordInput) {
      const notes = slot.ev.notes
      hit = notes.find((n) => stepToPos(n.step) === pos) ?? notes.find((n) => Math.abs(stepToPos(n.step) - pos) === 1)
    }
    const start = hit ? stepToPos(hit.step) : pos
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setPress({ pointerId: e.pointerId, measure, slot, pos: start, noteId: hit?.id, moved: false })
    onPreview(posToStep(start))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pressRef.current
    if (!p || p.pointerId !== e.pointerId) return
    const at = locate(e)
    if (at && at.pos !== p.pos) {
      setPress({ ...p, pos: at.pos, moved: true })
      onPreview(posToStep(at.pos))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const p = pressRef.current
    if (!p || p.pointerId !== e.pointerId) return
    setPress(null)
    if (p.noteId) {
      if (p.moved) onMove(p.noteId, posToStep(p.pos))
      else onSelect(p.noteId === selectedId ? null : p.noteId)
    } else {
      onPlace(p.measure, p.slot.ev.tick, posToStep(p.pos))
    }
  }

  // The browser took the gesture (a sideways scroll): drop the pending edit.
  const onPointerCancel = () => setPress(null)

  const ghostStep = press ? posToStep(press.pos) : 0
  const ghostAlter = inputAlter ?? keyAlter(letterOf(ghostStep), song.fifths)
  const ghostNote: Note | null = press
    ? { id: '__ghost', measure: press.measure, tick: press.slot.ev.tick, dur: inputDur, step: ghostStep, alter: ghostAlter }
    : null
  const ghostOnRest = press?.slot.ev.kind === 'rest'

  return (
    <div className="staff-line">
          <StaffHeader song={song} zoom={zoom} />
          <svg
            ref={svgRef}
            className="staff-measures"
            width={width * zoom}
            height={STAFF_HEIGHT * zoom}
            viewBox={`0 0 ${width} ${STAFF_HEIGHT}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            {layout.measures.map((m) =>
              m.slots.map((s, i) => (
                <rect
                  key={`${m.index}:${s.ev.tick}`}
                  className={`beat-col ${(m.index + i) % 2 ? 'odd' : 'even'} ${press?.slot === s ? 'active' : ''}`}
                  x={s.x}
                  y={0}
                  width={s.w}
                  height={STAFF_HEIGHT}
                />
              )),
            )}
            {/* faint guides for the ledger-line positions above and below */}
            {[-4, -2, 10, 12].map((p) => (
              <line key={p} className="guide" x1={0} x2={width} y1={y(p)} y2={y(p)} />
            ))}
            <StaffLines width={width} />
            {layout.measures.map((m) => (
              <g key={m.index}>
                <line className="barline" x1={m.x + m.width - 0.5} x2={m.x + m.width - 0.5} y1={y(8)} y2={y(0)} />
                {numbers && (
                  <text className="measure-num" x={m.x + 4} y={12}>
                    {m.index + 1}
                  </text>
                )}
                {m.slots.map((s) =>
                  s.ev.kind === 'rest' ? (
                    !(press?.slot === s) && <RestGlyph key={s.ev.tick} slot={s} />
                  ) : (
                    !(chordInput && press?.slot === s) && (
                    <ChordGlyph
                      key={s.ev.tick}
                      clef={clef}
                      showAcc={accShown}
                      chord={s.ev}
                      headX={s.headX}
                      stem={geometry.stems.get(s)}
                      selectedId={selectedId}
                      hiddenId={press?.slot === s && press.moved ? press.noteId : undefined}
                    />
                    )
                  ),
                )}
                {m.tuplets.map((t) => {
                  const first = t.slots[0]
                  const last = t.slots[t.slots.length - 1]
                  const tops = t.slots.map((s) => {
                    if (s.ev.kind === 'rest') return y(9)
                    const st = geometry.stems.get(s)
                    const hiPos = Math.max(...s.ev.notes.map((n) => stepToPos(n.step)))
                    const up = st?.up ?? stemUpFor(clef, s.ev.notes.map((n) => n.step))
                    return up ? (st?.endY ?? y(hiPos) - STEM_LEN) : y(hiPos) - 0.6 * SPACE
                  })
                  const top = Math.min(y(9), ...tops) - 0.9 * SPACE
                  const x1 = first.headX
                  const x2 = last.headX + 1.18 * SPACE
                  const cx = (x1 + x2) / 2
                  const bracket = t.slots.some((s) => s.ev.kind === 'rest' || !geometry.stems.has(s))
                  return (
                    <g key={`t${first.ev.tick}`} className="tuplet">
                      {bracket && (
<polyline points={`${x1},${top + 6} ${x1},${top} ${cx - 12},${top}`} fill="none" />
                      )}
                      {bracket && <polyline points={`${cx + 12},${top} ${x2},${top} ${x2},${top + 6}`} fill="none" />}
                      <text className="glyph" x={cx - 0.45 * SPACE} y={top + 0.5 * SPACE} fontSize={FONT * 0.6}>
                        {GLYPH.tuplet3}
                      </text>
                    </g>
                  )
                })}
              </g>
            ))}
            {ties.map((t) => (
              <path key={t.key} className="tie" d={t.d} />
            ))}
            {geometry.beams.map((b) => (
              <rect key={b.key} className="beam" x={b.x1} y={b.y} width={b.x2 - b.x1} height={BEAM_T} />
            ))}
            {labels.map((l) => (
              <text key={l.key} className="chord-label" x={l.x} y={CHORD_Y}>
                {l.text}
              </text>
            ))}
            {press && ghostNote && (
              <g className="ghost">
                {chordInput ? (
                  <ChordGlyph
                    clef={clef}
                    showAcc={ghostAcc}
                    chord={{
                      dur: ghostOnRest ? inputDur : press.slot.ev.dur,
                      notes: chordInput.voice(ghostStep).map((p, i) => ({ ...ghostNote, id: `__ghost${i}`, ...p })),
                    }}
                    headX={press.slot.headX}
                  />
                ) : ghostOnRest ? (
                  <ChordGlyph clef={clef} showAcc={ghostAcc} chord={{ dur: inputDur, notes: [ghostNote] }} headX={press.slot.headX} />
                ) : (
                  <GhostHead headX={press.slot.headX} pos={press.pos} dur={press.slot.ev.dur} />
                )}
                <text className="pitch-label" x={press.slot.headX + 14} y={chordInput ? CHORD_Y + 18 : Math.max(CHORD_Y + 16, y(press.pos) - 2.2 * SPACE)}>
                  {chordInput ? chordInput.label : pitchName(ghostStep, ghostAlter)}
                </text>
              </g>
            )}
            <line ref={playheadRef} className="playhead" x1={0} x2={0} y1={0} y2={STAFF_HEIGHT} style={{ display: 'none' }} />
          </svg>
    </div>
  )
}

/** A lone notehead with ledger lines: where a pitch will join an existing chord. */
function GhostHead({ headX, pos, dur }: { headX: number; pos: number; dur: number }) {
  const base = describeTicks(dur)?.base ?? 'quarter'
  const headW = headWidth(base)
  const head = base === 'whole' ? GLYPH.noteheadWhole : base === 'half' ? GLYPH.noteheadHalf : GLYPH.noteheadBlack
  const ledgers: number[] = []
  for (let p = -2; p >= pos; p -= 2) ledgers.push(p)
  for (let p = 10; p <= pos; p += 2) ledgers.push(p)
  return (
    <g>
      {ledgers.map((p) => (
        <line key={p} className="ledger" x1={headX - 0.4 * SPACE} x2={headX + headW + 0.4 * SPACE} y1={y(p)} y2={y(p)} />
      ))}
      <text className="glyph" x={headX} y={y(pos)} fontSize={FONT}>
        {head}
      </text>
    </g>
  )
}

/** Curves for ties and lines for slides, from each connected note's head to the next note's head. */
function tieCurves(song: Part, layout: SongLayout, stems: Map<Slot, StemSpec>) {
  const clef = layout.clef
  const where = new Map<string, { slot: Slot; chordSize: number; mid: number }>()
  for (const m of layout.measures) {
    for (const s of m.slots) {
      if (s.ev.kind !== 'chord') continue
      const poss = s.ev.notes.map((n) => clefStepToPos(clef, n.step))
      const mid = (Math.min(...poss) + Math.max(...poss)) / 2
      for (const n of s.ev.notes) where.set(n.id, { slot: s, chordSize: s.ev.notes.length, mid })
    }
  }
  const out: { key: string; d: string }[] = []
  for (const n of song.notes) {
    const t = tieTarget(song, n)
    const a = where.get(n.id)
    const b = t && where.get(t.id)
    if (!t || !a || !b) continue
    const pos = clefStepToPos(clef, n.step)
    if (isSlide(n, t)) {
      // A slide: a straight line from one notehead to the next (glissando).
      const x1 = a.slot.headX + 1.18 * SPACE + 3
      const x2 = b.slot.headX - 3
      const y1 = y(pos)
      const y2 = y(clefStepToPos(clef, t.step))
      const dx = x2 - x1
      const dy = y2 - y1
      const len = Math.hypot(dx, dy) || 1
      const [nx, ny] = [(-dy / len) * 1.3, (dx / len) * 1.3]
      out.push({ key: n.id, d: `M${x1 + nx},${y1 + ny} L${x2 + nx},${y2 + ny} L${x2 - nx},${y2 - ny} L${x1 - nx},${y1 - ny} Z` })
      continue
    }
    // Single notes tie on the side away from the stem; in chords, upper notes tie over, lower under.
    let over: boolean
    if (a.chordSize === 1) {
      const st = stems.get(a.slot)
      over = !(st?.up ?? stemUpFor(clef, [n.step]))
    } else over = pos > a.mid || (pos === a.mid && pos >= MIDDLE_POS)
    const dir = over ? -1 : 1
    const x1 = a.slot.headX + 1.18 * SPACE + 2
    const x2 = b.slot.headX - 2
    const y0 = y(pos) + dir * 0.45 * SPACE
    const h = dir * Math.min(0.9 * SPACE, 6 + (x2 - x1) * 0.08)
    const th = dir * 0.12 * SPACE
    // A filled crescent: outer curve there, inner curve back.
    const d = `M${x1},${y0} C${x1 + (x2 - x1) * 0.25},${y0 + h} ${x2 - (x2 - x1) * 0.25},${y0 + h} ${x2},${y0} C${x2 - (x2 - x1) * 0.25},${y0 + h - th} ${x1 + (x2 - x1) * 0.25},${y0 + h - th} ${x1},${y0} Z`
    out.push({ key: n.id, d })
  }
  return out
}

// --- the score: one or more staves scrolling together -----------------------------

/** Staff callbacks, told which staff (0 = top) they came from. */
interface ScoreProps {
  /** The staves to show, top to bottom (two for a grand staff). */
  parts: Part[]
  inputDur: number
  selectedId: string | null
  onSelect: (id: string | null, staff: number) => void
  onPlace: (staff: number, measure: number, tick: number, step: number) => void
  onMove: (staff: number, id: string, step: number) => void
  onPreview: (staff: number, step: number) => void
  onAddMeasure: () => void
  /** Returns the play position in beats, or null when stopped. Polled each frame. */
  getPlayBeat: () => number | null
  /** Chord input for a staff, or null. */
  chordInput?: (staff: number) => StaffRowProps['chordInput']
  inputAlter?: number | null
}

const GRAND_ZOOM = 0.66

/**
 * Chord symbols over the top staff: the notes starting together on every
 * staff are named as one chord.
 */
function scoreLabels(layouts: SongLayout[]) {
  const out: { x: number; text: string; key: string }[] = []
  layouts[0].measures.forEach((m, mi) => {
    const byTick = new Map<number, { x: number; notes: Note[] }>()
    layouts.forEach((l) => {
      for (const s of l.measures[mi].slots) {
        if (s.ev.kind !== 'chord') continue
        const at = byTick.get(s.ev.tick) ?? { x: s.headX, notes: [] }
        at.notes.push(...s.ev.notes)
        byTick.set(s.ev.tick, at)
      }
    })
    for (const [tick, { x, notes }] of byTick) {
      const text = chordName(notes)
      if (text) out.push({ x, text, key: `${m.index}:${tick}` })
    }
  })
  return out
}

export function Score(props: ScoreProps) {
  const { parts, getPlayBeat, onAddMeasure, chordInput } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const playheads = useRef<(SVGLineElement | null)[]>([])
  const layouts = useMemo(() => layoutStaves(parts), [parts])
  const labels = useMemo(() => scoreLabels(layouts), [layouts])
  const grand = parts.length > 1
  const zoom = grand ? GRAND_ZOOM : 1

  // Playhead: moved directly on the DOM each frame, and the score follows it.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const beat = getPlayBeat()
      const x = beat === null ? null : tickToX(parts[0], layouts[0], beat * TPQ)
      for (const line of playheads.current) {
        if (!line) continue
        if (x === null) line.style.display = 'none'
        else {
          line.style.display = ''
          line.setAttribute('transform', `translate(${x},0)`)
        }
      }
      const sc = scrollRef.current
      const svg = playheads.current[0]?.ownerSVGElement
      if (x !== null && sc && svg) {
        const xIn = x * zoom + svg.getBoundingClientRect().left - sc.getBoundingClientRect().left + sc.scrollLeft
        if (xIn < sc.scrollLeft + 20 || xIn > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, xIn - 40)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getPlayBeat, parts, layouts, zoom])

  const height = parts.length * STAFF_HEIGHT * zoom
  // The brace spans from the top line of the first staff to the bottom line of the last.
  const braceTop = y(8) * zoom
  const braceBottom = (STAFF_HEIGHT * (parts.length - 1) + y(0)) * zoom
  return (
    <div className="staff-row">
      <div className="staff-scroll" ref={scrollRef}>
        <div className="staff-inner">
          {grand && (
            <svg className="brace" width={18} height={height} aria-hidden>
              <path d={bracePath(16, braceTop, braceBottom)} />
              <line x1={17} x2={17} y1={braceTop} y2={braceBottom} className="system-line" />
            </svg>
          )}
          <div className="staff-stack">
            {parts.map((part, k) => (
              <StaffRow
                key={k}
                song={part}
                layout={layouts[k]}
                zoom={zoom}
                labels={k === 0 ? labels : []}
                numbers={k === 0}
                playheadRef={(el) => (playheads.current[k] = el)}
                inputDur={props.inputDur}
                selectedId={props.selectedId}
                onSelect={(id) => props.onSelect(id, k)}
                onPlace={(m, tick, step) => props.onPlace(k, m, tick, step)}
                onMove={(id, step) => props.onMove(k, id, step)}
                onPreview={(step) => props.onPreview(k, step)}
                chordInput={chordInput?.(k) ?? null}
                inputAlter={props.inputAlter}
              />
            ))}
          </div>
          <button className="add-measure" style={{ height }} onClick={onAddMeasure} aria-label="Add measure">
            +
          </button>
        </div>
      </div>
    </div>
  )
}

/** A curly brace from top to bottom, `w` wide, thick in the middle of each half. */
function bracePath(w: number, top: number, bottom: number) {
  const h = bottom - top
  const m = top + h / 2
  return [
    `M${w},${top}`,
    `C${w * 0.15},${top + h * 0.06} ${w * 0.95},${m - h * 0.1} 0,${m}`,
    `C${w * 0.95},${m + h * 0.1} ${w * 0.15},${bottom - h * 0.06} ${w},${bottom}`,
    `C${w * 0.5},${bottom - h * 0.08} ${w * 1.5},${m + h * 0.12} ${w * 0.3},${m}`,
    `C${w * 1.5},${m - h * 0.12} ${w * 0.5},${top + h * 0.08} ${w},${top}`,
    'Z',
  ].join(' ')
}
