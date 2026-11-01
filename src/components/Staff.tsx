import { useEffect, useRef, useState } from 'react'
import type { Note, Song } from '../music/song'
import { notesAt } from '../music/song'
import { MAX_POS, MIDDLE_POS, MIN_POS, clampPos, keyAlter, letterOf, pitchName, posToStep, stepToPos } from '../music/theory'

// The score: a treble staff drawn in SVG with SMuFL glyphs from the Bravura
// font. The clef, key and time signature open the line, and the whole line
// scrolls sideways. Every beat is a column you can tap.
//
// Touch: press anywhere on a beat to get a ghost note, slide up or down to
// pick the pitch, release to place it. Tap a note to delete it; press on a
// note and slide to move it. A sideways swipe scrolls the score instead.

export const SPACE = 24 // staff space in px; Bravura is sized 4 spaces to the em
const STEP = SPACE / 2 // one staff position (line to space)
const FONT = SPACE * 4
const BOTTOM_Y = (MAX_POS + 3) * STEP // y of the bottom staff line
export const STAFF_HEIGHT = BOTTOM_Y + (-MIN_POS + 4) * STEP
const BEAT_W = 60
const MEASURE_PAD = 20
const HEAD_W = 1.18 * SPACE
const STEM_W = 0.12 * SPACE
const STEM_LEN = 3.5 * SPACE

const G = {
  gClef: '\uE050',
  noteheadBlack: '\uE0A4',
  restQuarter: '\uE4E5',
  flat: '\uE260',
  natural: '\uE261',
  sharp: '\uE262',
  timeSig: (d: number) => String.fromCodePoint(0xe080 + d),
}

const y = (pos: number) => BOTTOM_Y - pos * STEP
const measureW = (beats: number) => MEASURE_PAD + beats * BEAT_W
export const beatX = (song: Song, absBeat: number) => {
  const m = Math.floor(absBeat / song.beatsPerMeasure)
  return m * measureW(song.beatsPerMeasure) + MEASURE_PAD + (absBeat - m * song.beatsPerMeasure) * BEAT_W
}

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
  const digits = (v: number) => String(v).split('').map((d) => G.timeSig(Number(d))).join('')
  return (
    <svg className="staff-header" width={width} height={STAFF_HEIGHT}>
      <StaffLines width={width} />
      <text className="glyph" x={6} y={y(2)} fontSize={FONT}>
        {G.gClef}
      </text>
      {Array.from({ length: n }, (_, i) => (
        <text key={i} className="glyph" x={keyX + i * 0.95 * SPACE} y={y(song.fifths > 0 ? KEY_SHARP_POS[i] : KEY_FLAT_POS[i])} fontSize={FONT}>
          {song.fifths > 0 ? G.sharp : G.flat}
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

/** One beat's chord: noteheads, accidentals, ledger lines and a shared stem. */
function Chord({ song, notes, cx, hidden }: { song: Song; notes: Note[]; cx: number; hidden?: string }) {
  const shown = notes.filter((n) => n.id !== hidden)
  if (!shown.length) return null
  const poss = shown.map((n) => stepToPos(n.step))
  const lo = Math.min(...poss)
  const hi = Math.max(...poss)
  // Stem direction follows the note farthest from the middle line.
  const up = MIDDLE_POS - lo >= hi - MIDDLE_POS
  const left = cx - HEAD_W / 2

  // Notes a second apart sit on opposite sides of the stem.
  const sorted = [...shown].sort((a, b) => (up ? a.step - b.step : b.step - a.step))
  const shift = new Map<string, number>()
  let prev: { step: number; shifted: boolean } | null = null
  for (const n of sorted) {
    const shifted: boolean = !!prev && Math.abs(n.step - prev.step) === 1 && !prev.shifted
    shift.set(n.id, shifted ? (up ? HEAD_W - STEM_W : -(HEAD_W - STEM_W)) : 0)
    prev = { step: n.step, shifted }
  }

  const ledgers: number[] = []
  for (let p = -2; p >= lo; p -= 2) ledgers.push(p)
  for (let p = 10; p <= hi; p += 2) ledgers.push(p)
  const ledgerExt = 0.4 * SPACE

  const stemX = up ? left + HEAD_W - STEM_W / 2 : left + STEM_W / 2
  const stemY1 = up ? y(lo) - 0.15 * SPACE : y(hi) + 0.15 * SPACE
  const stemY2 = up ? y(hi) - STEM_LEN : y(lo) + STEM_LEN

  return (
    <g className="chord">
      {ledgers.map((p) => (
        <line key={p} className="ledger" x1={left - ledgerExt} x2={left + HEAD_W + ledgerExt} y1={y(p)} y2={y(p)} />
      ))}
      {shown.map((n) => {
        const pos = stepToPos(n.step)
        const dx = shift.get(n.id) ?? 0
        const needsAcc = n.alter !== keyAlter(letterOf(n.step), song.fifths)
        const acc = n.alter > 0 ? G.sharp : n.alter < 0 ? G.flat : G.natural
        return (
          <g key={n.id}>
            {needsAcc && (
              <text className="glyph" x={left + Math.min(0, dx) - 1.3 * SPACE} y={y(pos)} fontSize={FONT}>
                {acc}
              </text>
            )}
            <text className="glyph note" x={left + dx} y={y(pos)} fontSize={FONT}>
              {G.noteheadBlack}
            </text>
          </g>
        )
      })}
      <line className="stem" x1={stemX} x2={stemX} y1={stemY1} y2={stemY2} strokeWidth={STEM_W} />
    </g>
  )
}

interface Press {
  pointerId: number
  measure: number
  beat: number
  pos: number
  /** Set when the press started on an existing note. */
  noteId?: string
  moved: boolean
}

interface StaffProps {
  song: Song
  onAdd: (measure: number, beat: number, step: number) => void
  onRemove: (id: string) => void
  onMove: (id: string, step: number) => void
  onPreview: (step: number) => void
  onAddMeasure: () => void
  /** Returns the play position in beats, or null when stopped. Polled each frame. */
  getPlayBeat: () => number | null
}

export function Staff({ song, onAdd, onRemove, onMove, onPreview, onAddMeasure, getPlayBeat }: StaffProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<SVGLineElement>(null)
  const [press, setPress] = useState<Press | null>(null)
  const pressRef = useRef<Press | null>(null)
  pressRef.current = press

  const mw = measureW(song.beatsPerMeasure)
  const width = song.measures * mw
  const totalBeats = song.measures * song.beatsPerMeasure

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
          const b = Math.min(beat, totalBeats - 0.001)
          const whole = Math.floor(b)
          const x = beatX(song, whole) + (b - whole) * BEAT_W
          line.style.display = ''
          line.setAttribute('transform', `translate(${x},0)`)
          const sc = scrollRef.current
          if (sc && (x < sc.scrollLeft + 20 || x > sc.scrollLeft + sc.clientWidth - 40)) {
            sc.scrollLeft = Math.max(0, x - 40)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getPlayBeat, song, totalBeats])

  const locate = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const py = e.clientY - r.top
    const measure = Math.max(0, Math.min(song.measures - 1, Math.floor(x / mw)))
    const beat = Math.max(0, Math.min(song.beatsPerMeasure - 1, Math.floor((x - measure * mw - MEASURE_PAD) / BEAT_W)))
    const pos = clampPos(Math.round((BOTTOM_Y - py) / STEP))
    return { measure, beat, pos }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button > 0) return
    const { measure, beat, pos } = locate(e)
    // Grab an existing note if the press is on (or right next to) one.
    const here = notesAt(song, measure, beat)
    const hit = here.find((n) => stepToPos(n.step) === pos) ?? here.find((n) => Math.abs(stepToPos(n.step) - pos) === 1)
    const start = hit ? stepToPos(hit.step) : pos
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setPress({ pointerId: e.pointerId, measure, beat, pos: start, noteId: hit?.id, moved: false })
    onPreview(posToStep(start))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = pressRef.current
    if (!p || p.pointerId !== e.pointerId) return
    const { pos } = locate(e)
    if (pos !== p.pos) {
      setPress({ ...p, pos, moved: true })
      onPreview(posToStep(pos))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const p = pressRef.current
    if (!p || p.pointerId !== e.pointerId) return
    setPress(null)
    if (p.noteId) {
      if (p.moved) onMove(p.noteId, posToStep(p.pos))
      else onRemove(p.noteId)
    } else {
      onAdd(p.measure, p.beat, posToStep(p.pos))
    }
  }

  // The browser took the gesture (a sideways scroll): drop the pending edit.
  const onPointerCancel = () => setPress(null)

  const ghostX = press ? beatX(song, press.measure * song.beatsPerMeasure + press.beat) : 0
  const ghostStep = press ? posToStep(press.pos) : 0
  const ghostAlter = keyAlter(letterOf(ghostStep), song.fifths)
  const ghostNote: Note | null = press
    ? { id: '__ghost', measure: press.measure, beat: press.beat, step: ghostStep, alter: ghostAlter }
    : null

  const columns: { bg: React.ReactNode; fg: React.ReactNode }[] = []
  for (let m = 0; m < song.measures; m++) {
    for (let b = 0; b < song.beatsPerMeasure; b++) {
      const x = beatX(song, m * song.beatsPerMeasure + b)
      const notes = notesAt(song, m, b)
      const active = press && press.measure === m && press.beat === b
      const visible = notes.filter((n) => !(active && n.id === press.noteId))
      columns.push({
        bg: <rect key={`${m}:${b}`} className={`beat-col ${b % 2 ? 'odd' : 'even'} ${active ? 'active' : ''}`} x={x} y={0} width={BEAT_W} height={STAFF_HEIGHT} />,
        fg: (
        <g key={`${m}:${b}`}>
          {visible.length === 0 && !active && (
            <text className="glyph rest" x={x + BEAT_W / 2 - 0.54 * SPACE} y={y(MIDDLE_POS)} fontSize={FONT}>
              {G.restQuarter}
            </text>
          )}
          <Chord song={song} notes={notes} cx={x + BEAT_W / 2} hidden={active ? press.noteId : undefined} />
        </g>
        ),
      })
    }
  }

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
            {columns.map((c) => c.bg)}
            {/* faint guides for the ledger-line positions above and below */}
            {[-4, -2, 10, 12].map((p) => (
              <line key={p} className="guide" x1={0} x2={width} y1={y(p)} y2={y(p)} />
            ))}
            {columns.map((c) => c.fg)}
            <StaffLines width={width} />
            {Array.from({ length: song.measures }, (_, m) => (
              <g key={m}>
                <line className="barline" x1={(m + 1) * mw - 0.5} x2={(m + 1) * mw - 0.5} y1={y(8)} y2={y(0)} />
                <text className="measure-num" x={m * mw + 4} y={14}>
                  {m + 1}
                </text>
              </g>
            ))}
            {press && ghostNote && (
              <g className="ghost">
                <Chord song={song} notes={[...notesAt(song, press.measure, press.beat).filter((n) => n.id !== press.noteId), ghostNote]} cx={ghostX + BEAT_W / 2} />
                <text className="pitch-label" x={ghostX + BEAT_W / 2} y={Math.max(24, y(press.pos) - 2.2 * SPACE)}>
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
