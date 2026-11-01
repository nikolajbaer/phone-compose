import { useEffect, useMemo, useRef, useState } from 'react'
import { TPQ, describeTicks, type BaseDuration, type RestShape } from '../music/duration'
import type { Chord, Note, Song } from '../music/song'
import { MAX_POS, MIN_POS, clampPos, keyAlter, letterOf, pitchName, posToStep, stepToPos } from '../music/theory'
import { SPACE, STEP, beamCount, chordLabels, hitSlot, layoutSong, stemUp, tickToX, type Slot, type SongLayout } from './staffLayout'

// The score: a treble staff drawn in SVG with SMuFL glyphs from the Bravura
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

export function StaffHeader({ song }: { song: Song }) {
  const n = Math.abs(song.fifths)
  const keyX = 2.9 * SPACE
  const timeX = keyX + n * 0.95 * SPACE + (n ? 0.4 * SPACE : 0)
  const width = timeX + 2.1 * SPACE
  const digits = (v: number) => String(v).split('').map((d) => GLYPH.timeSig(Number(d))).join('')
  return (
    <svg className="staff-header" width={width} height={STAFF_HEIGHT}>
      <StaffLines width={width} />
      <text className="glyph" x={6} y={y(2)} fontSize={FONT}>
        {GLYPH.gClef}
      </text>
      {Array.from({ length: n }, (_, i) => (
        <text key={i} className="glyph" x={keyX + i * 0.95 * SPACE} y={y(song.fifths > 0 ? KEY_SHARP_POS[i] : KEY_FLAT_POS[i])} fontSize={FONT}>
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
  song,
  chord,
  headX,
  stem,
  selectedId,
  hiddenId,
}: {
  song: Song
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
  const poss = shown.map((n) => stepToPos(n.step))
  const lo = Math.min(...poss)
  const hi = Math.max(...poss)
  const up = stem?.up ?? stemUp(shown.map((n) => n.step))
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
        const pos = stepToPos(n.step)
        const dx = shift.get(n.id) ?? 0
        const needsAcc = n.alter !== keyAlter(letterOf(n.step), song.fifths)
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
  const stems = new Map<Slot, StemSpec>()
  const beams: { key: string; x1: number; x2: number; y: number }[] = []
  for (const m of layout.measures) {
    m.beams.forEach((g, gi) => {
      const chords = g.slots.map((s) => s.ev as Chord & { kind: 'chord' })
      const double = chords.some((c) => beamCount(c.dur) === 2)
      const len = STEM_LEN + (double ? 0.25 * SPACE : 0)
      const endY = g.up
        ? Math.min(...chords.map((c) => y(Math.max(...c.notes.map((n) => stepToPos(n.step)))) - len))
        : Math.max(...chords.map((c) => y(Math.min(...c.notes.map((n) => stepToPos(n.step)))) + len))
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

interface StaffProps {
  song: Song
  /** Length in ticks of the note the palette will write. */
  inputDur: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onPlace: (measure: number, tick: number, step: number) => void
  onMove: (id: string, step: number) => void
  onPreview: (step: number) => void
  onAddMeasure: () => void
  /** Returns the play position in beats, or null when stopped. Polled each frame. */
  getPlayBeat: () => number | null
}

export function Staff({ song, inputDur, selectedId, onSelect, onPlace, onMove, onPreview, onAddMeasure, getPlayBeat }: StaffProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<SVGLineElement>(null)
  const [press, setPress] = useState<Press | null>(null)
  const pressRef = useRef<Press | null>(null)
  pressRef.current = press

  const layout = useMemo(() => layoutSong(song), [song])
  const geometry = useMemo(() => beamGeometry(layout), [layout])
  const labels = useMemo(() => chordLabels(layout), [layout])
  const width = layout.width

  // Playhead: moved directly on the DOM each frame, and the score follows it.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const line = playheadRef.current
      const beat = getPlayBeat()
      if (line) {
        if (beat === null) {
          line.style.display = 'none'
        } else {
          const x = tickToX(song, layout, beat * TPQ)
          line.style.display = ''
          line.setAttribute('transform', `translate(${x},0)`)
          const sc = scrollRef.current
          const svgLeft = svgRef.current?.getBoundingClientRect().left ?? 0
          const scLeft = sc?.getBoundingClientRect().left ?? 0
          const xIn = x + svgLeft - scLeft + (sc?.scrollLeft ?? 0)
          if (sc && (xIn < sc.scrollLeft + 20 || xIn > sc.scrollLeft + sc.clientWidth - 40)) {
            sc.scrollLeft = Math.max(0, xIn - 40)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getPlayBeat, song, layout])

  const locate = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const hit = hitSlot(layout, e.clientX - r.left)
    const pos = clampPos(Math.round((BOTTOM_Y - (e.clientY - r.top)) / STEP))
    return hit ? { measure: hit.measure.index, slot: hit.slot, pos } : null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button > 0) return
    const at = locate(e)
    if (!at) return
    const { measure, slot, pos } = at
    // Grab an existing note if the press is on (or right next to) one.
    let hit: Note | undefined
    if (slot.ev.kind === 'chord') {
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
  const ghostAlter = keyAlter(letterOf(ghostStep), song.fifths)
  const ghostNote: Note | null = press
    ? { id: '__ghost', measure: press.measure, tick: press.slot.ev.tick, dur: inputDur, step: ghostStep, alter: ghostAlter }
    : null
  const ghostOnRest = press?.slot.ev.kind === 'rest'

  return (
    <div className="staff-row">
      <div className="staff-scroll" ref={scrollRef}>
        <div className="staff-inner">
          <StaffHeader song={song} />
          <svg
            ref={svgRef}
            className="staff-measures"
            width={width}
            height={STAFF_HEIGHT}
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
                <text className="measure-num" x={m.x + 4} y={12}>
                  {m.index + 1}
                </text>
                {m.slots.map((s) =>
                  s.ev.kind === 'rest' ? (
                    !(press?.slot === s) && <RestGlyph key={s.ev.tick} slot={s} />
                  ) : (
                    <ChordGlyph
                      key={s.ev.tick}
                      song={song}
                      chord={s.ev}
                      headX={s.headX}
                      stem={geometry.stems.get(s)}
                      selectedId={selectedId}
                      hiddenId={press?.slot === s && press.moved ? press.noteId : undefined}
                    />
                  ),
                )}
                {m.tuplets.map((t) => {
                  const first = t.slots[0]
                  const last = t.slots[t.slots.length - 1]
                  const tops = t.slots.map((s) => {
                    if (s.ev.kind === 'rest') return y(9)
                    const st = geometry.stems.get(s)
                    const hiPos = Math.max(...s.ev.notes.map((n) => stepToPos(n.step)))
                    const up = st?.up ?? stemUp(s.ev.notes.map((n) => n.step))
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
                {ghostOnRest ? (
                  <ChordGlyph song={song} chord={{ dur: inputDur, notes: [ghostNote] }} headX={press.slot.headX} />
                ) : (
                  <GhostHead headX={press.slot.headX} pos={press.pos} dur={press.slot.ev.dur} />
                )}
                <text className="pitch-label" x={press.slot.headX + 14} y={Math.max(CHORD_Y + 16, y(press.pos) - 2.2 * SPACE)}>
                  {pitchName(ghostStep, ghostAlter)}
                </text>
              </g>
            )}
            <line ref={playheadRef} className="playhead" x1={0} x2={0} y1={0} y2={STAFF_HEIGHT} style={{ display: 'none' }} />
          </svg>
          <button className="add-measure" style={{ height: STAFF_HEIGHT }} onClick={onAddMeasure} aria-label="Add measure">
            +
          </button>
        </div>
      </div>
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
