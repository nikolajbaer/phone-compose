import { useEffect, useState } from 'react'
import { PATTERNS, generatePart, getPattern, type PatternId } from '../music/arrange'
import { specName } from '../music/chordBuilder'
import { TPQ } from '../music/duration'
import { getInstrument } from '../music/instruments'
import {
  TRANSPOSE_OPTIONS,
  deletePhrase,
  ensureMeasures,
  extractPhrase,
  insertPhrase,
  savePhrase,
  type Phrase,
  type Transpose,
} from '../music/phrases'
import { PROGRESSION_PRESETS, clearProgression, fillProgression, presetChords, sortedProgression, suggestChords } from '../music/progression'
import type { Song } from '../music/song'
import { addTrack, partOf, staffCount, withPart } from '../music/song'
import { InstrumentSelect } from './InstrumentSelect'

// The "Arrange" sheet: work at the level of the whole song.
// Chords: set a progression (presets, or suggested from a melody).
// Parts: write a supporting part from the progression into a track.
// Phrases: pick bars, then save, repeat or copy them to another track.

type Tab = 'chords' | 'parts' | 'phrases'
let lastTab: Tab = 'chords'

interface Props {
  song: Song
  /** The track and staff being edited. */
  track: number
  staff: number
  onEdit: (song: Song) => void
  onMessage: (text: string) => void
  /** Bars to highlight on the score while choosing a phrase. */
  onHighlight: (range: { from: number; to: number } | null) => void
  /** Show a track (after writing into it). */
  onShowTrack: (track: number, staff: number) => void
  onClose: () => void
}

const RHYTHM_NAMES: Record<number, string> = {
  [2 * TPQ]: 'Halves',
  [TPQ]: 'Quarters',
  [TPQ / 2]: 'Eighths',
  [TPQ / 4]: 'Sixteenths',
  [TPQ / 3]: 'Triplets',
}

const DEFAULT_INSTRUMENT: Record<PatternId, string> = {
  block: 'strings',
  pulse: 'piano',
  arpUp: 'piano',
  arpUpDown: 'harp',
  alberti: 'piano',
  bassRoot: 'acoustic_bass',
  bassRootFifth: 'acoustic_bass',
  walking: 'acoustic_bass',
  run: 'flute',
}

const trackName = (song: Song, i: number) => `${i + 1} ${getInstrument(song.tracks[i].instrument).name}`

function BarSelect({ value, max, onChange, label }: { value: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: max }, (_, i) => (
          <option key={i} value={i}>
            {i + 1}
          </option>
        ))}
      </select>
    </label>
  )
}

function TrackSelect({ song, value, onChange, allowNew }: { song: Song; value: number; onChange: (v: number) => void; allowNew?: boolean }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {song.tracks.map((_, i) => (
        <option key={i} value={i}>
          Track {trackName(song, i)}
        </option>
      ))}
      {allowNew && <option value={-1}>+ New track</option>}
    </select>
  )
}

function StaffSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label>
      Staff
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={0}>Right hand (treble)</option>
        <option value={1}>Left hand (bass)</option>
      </select>
    </label>
  )
}

export function ArrangeSheet(props: Props) {
  const [tab, setTab] = useState<Tab>(lastTab)
  useEffect(() => {
    lastTab = tab
    if (tab !== 'phrases') props.onHighlight(null)
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sheet-backdrop arrange-backdrop" onClick={props.onClose}>
      <div className="sheet arrange" onClick={(e) => e.stopPropagation()}>
        <div className="arrange-head">
          <div className="tabs" role="tablist">
            {(['chords', 'parts', 'phrases'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                {t === 'chords' ? 'Chords' : t === 'parts' ? 'Parts' : 'Phrases'}
              </button>
            ))}
          </div>
          <button className="btn icon" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {tab === 'chords' && <ChordsTab {...props} />}
        {tab === 'parts' && <PartsTab {...props} />}
        {tab === 'phrases' && <PhrasesTab {...props} />}
      </div>
    </div>
  )
}

function ChordsTab({ song, track, onEdit, onMessage }: Props) {
  const [source, setSource] = useState(track)
  const prog = sortedProgression(song)
  const byBar = Array.from({ length: song.measures }, (_, m) => prog.filter((c) => c.measure === m).map((c) => specName(c.spec)))
  return (
    <div className="arrange-body">
      <p className="sheet-note">Tap the chord lane above the score to set a chord at any bar or beat.</p>
      <div className="prog-summary">
        {byBar.map((names, m) => (
          <span key={m} className="prog-bar">
            <small>{m + 1}</small>
            {names.join(' ') || '·'}
          </span>
        ))}
      </div>
      <section>
        <h3>Suggest from a melody</h3>
        <div className="row">
          <TrackSelect song={song} value={source} onChange={setSource} />
          <button
            className="btn primary"
            onClick={() => {
              const melody = partOf(song, source, 0)
              if (!melody.notes.length) return onMessage('That track has no notes yet.')
              onEdit(fillProgression(song, suggestChords(melody)))
              onMessage('Chords suggested for every bar: tap the chord lane to change any of them.')
            }}
          >
            Suggest
          </button>
        </div>
      </section>
      <section>
        <h3>Common progressions</h3>
        <div className="chips">
          {PROGRESSION_PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => onEdit(fillProgression(song, presetChords(song.fifths, p.degrees)))}>
              <b>{p.name}</b>
              <small>{presetChords(song.fifths, p.degrees).map(specName).join(' ')}</small>
            </button>
          ))}
        </div>
      </section>
      <div className="sheet-actions">
        <button className="btn" disabled={!prog.length} onClick={() => onEdit(clearProgression(song))}>
          Clear chords
        </button>
      </div>
    </div>
  )
}

function PartsTab({ song, onEdit, onMessage, onShowTrack, onClose }: Props) {
  const [pattern, setPattern] = useState<PatternId>('arpUp')
  const def = getPattern(pattern)
  const [rhythm, setRhythm] = useState<number>(TPQ / 2)
  const [target, setTarget] = useState(-1)
  const [instrument, setInstrument] = useState(DEFAULT_INSTRUMENT.arpUp)
  const [staff, setStaff] = useState(0)
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(song.measures - 1)
  const grandTarget = target >= 0 && staffCount(song.tracks[target]) > 1
  const pick = (id: PatternId) => {
    setPattern(id)
    const d = getPattern(id)
    if (d.rhythms.length && !d.rhythms.includes(rhythm)) setRhythm(d.rhythms[0])
    setInstrument(DEFAULT_INSTRUMENT[id])
    setStaff(d.low ? 1 : 0)
  }
  const write = () => {
    if (!sortedProgression(song).length) return onMessage('Set some chords first (Chords tab).')
    let s = song
    let t = target
    if (t < 0) {
      s = addTrack(s, instrument)
      t = s.tracks.length - 1
    }
    const k = staffCount(s.tracks[t]) > 1 ? staff : 0
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    s = withPart(s, t, generatePart(s, partOf(s, t, k), { pattern, rhythm, fromMeasure: lo, toMeasure: hi }), k)
    onEdit(s)
    onShowTrack(t, k)
    onMessage(`${def.name} written into track ${t + 1}, bars ${lo + 1}–${hi + 1}. Edit it freely.`)
    onClose() // show the new part
  }
  return (
    <div className="arrange-body">
      <section>
        <h3>Pattern</h3>
        <div className="chips">
          {PATTERNS.map((p) => (
            <button key={p.id} className={`chip ${p.id === pattern ? 'on' : ''}`} onClick={() => pick(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        <p className="sheet-note">{def.hint}.</p>
      </section>
      {def.rhythms.length > 0 && (
        <section>
          <h3>Rhythm</h3>
          <div className="chips">
            {def.rhythms.map((r) => (
              <button key={r} className={`chip ${r === rhythm ? 'on' : ''}`} onClick={() => setRhythm(r)}>
                {RHYTHM_NAMES[r] ?? r}
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3>Into</h3>
        <div className="row">
          <label>
            Track
            <TrackSelect song={song} value={target} onChange={setTarget} allowNew />
          </label>
          {target < 0 && (
            <label>
              Instrument
              <InstrumentSelect value={instrument} onChange={setInstrument} />
            </label>
          )}
        </div>
        {(grandTarget || (target < 0 && getInstrument(instrument).grand)) && <StaffSelect value={staff} onChange={setStaff} />}
        <div className="row">
          <BarSelect label="From bar" value={from} max={song.measures} onChange={setFrom} />
          <BarSelect label="To bar" value={to} max={song.measures} onChange={setTo} />
        </div>
      </section>
      <div className="sheet-actions">
        <button className="btn primary" onClick={write}>
          Write part
        </button>
      </div>
    </div>
  )
}

function PhrasesTab({ song, track, staff, onEdit, onMessage, onHighlight, onShowTrack }: Props) {
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(Math.min(1, song.measures - 1))
  const [name, setName] = useState('')
  const [dest, setDest] = useState(track)
  const [destStaff, setDestStaff] = useState(0)
  const [at, setAt] = useState(Math.min(song.measures - 1, 2))
  const [how, setHow] = useState<Transpose>('fit')
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  useEffect(() => onHighlight({ from: lo, to: hi }), [lo, hi]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onHighlight(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  const source = () => extractPhrase(partOf(song, track, staff), lo, hi, name.trim() || `Phrase ${(song.phrases?.length ?? 0) + 1}`)
  const destK = staffCount(song.tracks[dest] ?? song.tracks[0]) > 1 ? destStaff : 0
  const put = (s: Song, phrase: Phrase, t: number, k: number, bar: number, transpose: Transpose) => {
    s = ensureMeasures(s, bar + phrase.length)
    return withPart(s, t, insertPhrase(partOf(s, t, k), phrase, bar, transpose), k)
  }
  const sourceName = `track ${trackName(song, track)}${staffCount(song.tracks[track]) > 1 ? (staff ? ', left hand' : ', right hand') : ''}`
  return (
    <div className="arrange-body">
      <p className="sheet-note">From {sourceName}. The bars are highlighted on the score.</p>
      <div className="row">
        <BarSelect label="From bar" value={from} max={song.measures} onChange={setFrom} />
        <BarSelect label="To bar" value={to} max={song.measures} onChange={setTo} />
      </div>
      <div className="row">
        <button
          className="btn"
          onClick={() => {
            const p = source()
            onEdit(put(song, p, track, staff, hi + 1, 'none'))
            onMessage(`Bars ${lo + 1}–${hi + 1} repeated in bars ${hi + 2}–${hi + 2 + hi - lo}.`)
            setFrom(hi + 1)
            setTo(hi + 1 + hi - lo)
          }}
        >
          Repeat after
        </button>
        <input placeholder="Phrase name" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn"
          onClick={() => {
            const p = source()
            onEdit(savePhrase(song, p))
            onMessage(`Saved “${p.name}”.`)
            setName('')
          }}
        >
          Save
        </button>
      </div>
      <section>
        <h3>Copy to</h3>
        <div className="row">
          <label>
            Track
            <TrackSelect song={song} value={dest} onChange={setDest} />
          </label>
          <BarSelect label="At bar" value={at} max={song.measures} onChange={setAt} />
        </div>
        {staffCount(song.tracks[dest] ?? song.tracks[0]) > 1 && <StaffSelect value={destStaff} onChange={setDestStaff} />}
        <label>
          Pitch
          <select value={how} onChange={(e) => setHow(e.target.value as Transpose)}>
            {TRANSPOSE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <div className="sheet-actions">
          <button
            className="btn primary"
            onClick={() => {
              onEdit(put(song, source(), dest, destK, at, how))
              onShowTrack(dest, destK)
              onMessage(`Bars ${lo + 1}–${hi + 1} copied to track ${dest + 1} at bar ${at + 1}.`)
            }}
          >
            Copy bars {lo + 1}–{hi + 1}
          </button>
        </div>
      </section>
      {(song.phrases?.length ?? 0) > 0 && (
        <section>
          <h3>Saved phrases</h3>
          <ul className="phrase-list">
            {song.phrases!.map((p) => (
              <li key={p.id}>
                <span>
                  <b>{p.name}</b> <small>{p.length} bar{p.length > 1 ? 's' : ''}</small>
                </span>
                <button
                  className="btn small"
                  onClick={() => {
                    onEdit(put(song, p, dest, destK, at, how))
                    onShowTrack(dest, destK)
                    onMessage(`“${p.name}” put into track ${dest + 1} at bar ${at + 1}.`)
                  }}
                >
                  Insert at bar {at + 1}
                </button>
                <button className="btn small" aria-label={`Delete ${p.name}`} onClick={() => onEdit(deletePhrase(song, p.id))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <p className="sheet-note">Inserts into the “Copy to” track, at its bar and pitch.</p>
        </section>
      )}
    </div>
  )
}
