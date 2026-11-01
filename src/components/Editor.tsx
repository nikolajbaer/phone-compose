import { useCallback, useEffect, useRef, useState } from 'react'
import { player } from '../audio/player'
import { downloadMidi } from '../audio/midiExport'
import type { Part, Song } from '../music/song'
import {
  addTrack,
  editAllParts,
  partOf,
  partsOf,
  setTrackGrand,
  setTrackInstrument,
  removeTrack,
  setTrackMuted,
  withPart,
  moveNote,
  placeChord,
  placeNote,
  removeNote,
  setAccidental,
  setBeatsPerMeasure,
  setChordDuration,
  setKey,
  setMeasures,
  tieTarget,
  toggleTie,
  updateSong,
  type EditResult,
} from '../music/song'
import { CLEFS, clefRange, getClef, type ClefId } from '../music/clefs'
import { choiceTicks, describeTicks, type DurationChoice } from '../music/duration'
import { KEYS, keyAlter, letterOf, toMidi } from '../music/theory'
import { InstrumentSelect, InstrumentStatus } from './InstrumentSelect'
import { DurationPalette } from './DurationPalette'
import { ChordPicker } from './ChordPicker'
import { diatonicChords, specName, voiceChord, type ChordSpec } from '../music/chordBuilder'
import { Score } from './Staff'
import { TrackBar } from './TrackBar'

interface EditorProps {
  song: Song
  onChange: (s: Song) => void
  onNewSong: () => void
  onHome: () => void
}

export function Editor({ song, onChange, onNewSong, onHome }: EditorProps) {
  const [playing, setPlaying] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [choice, setChoice] = useState<DurationChoice>({ base: 'quarter', dotted: false, triplet: false })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [chordSpec, setChordSpec] = useState<ChordSpec>(() => diatonicChords(song.fifths)[0])
  const [chordInput, setChordInput] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Sharp/flat/natural for the next notes written, or null to follow the key signature. */
  const [inputAlter, setInputAlter] = useState<number | null>(null)
  const history = useRef<Song[]>([])
  const songRef = useRef(song)
  songRef.current = song
  const [active, setActive] = useState(0)
  const [trackSheet, setTrackSheet] = useState(false)
  /** The staff last touched (0 = top), for a grand staff. */
  const [staffIdx, setStaffIdx] = useState(0)
  const track = Math.min(active, song.tracks.length - 1)
  const grand = !!song.tracks[track].grand
  /** The active track's staves with the song's settings: what the score shows and edits. */
  const parts = partsOf(song, track)

  // Every edit goes through here so it can be undone.
  const edit = useCallback(
    (next: Song) => {
      if (next === songRef.current) return
      history.current = [...history.current.slice(-99), songRef.current]
      onChange(next)
    },
    [onChange],
  )

  const switchTrack = (i: number) => {
    setActive(i)
    setSelectedId(null)
    setChordInput(false)
    setStaffIdx(0)
  }

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 2500)
    return () => clearTimeout(t)
  }, [message])

  // The selection goes away if its note does (undo, overwritten, deleted).
  const found = parts.map((p, k) => ({ k, n: p.notes.find((n) => n.id === selectedId) })).find((x) => x.n)
  const selected = found?.n ?? null
  const selStaff = found?.k ?? staffIdx
  /** The staff the palette's actions apply to: the selected note's. */
  const part = parts[Math.min(selStaff, parts.length - 1)]
  const shownChoice = (selected && describeTicks(selected.dur)) || choice

  const editPart = (p: Part, staff = selStaff) => edit(withPart(songRef.current, track, p, staff))

  const apply = (r: EditResult, staff = selStaff) => {
    if (r.error) {
      setMessage(r.error)
      return false
    }
    editPart(r.song, staff)
    return true
  }

  const changeDuration = (c: DurationChoice) => {
    setChoice(c)
    if (selected) apply(setChordDuration(part, selected.id, choiceTicks(c)))
  }

  const undo = () => {
    const prev = history.current.pop()
    if (prev) onChange(prev)
  }

  // Start downloading the tracks' instruments as soon as they are chosen.
  const instruments = song.tracks.map((t) => t.instrument).join(',')
  useEffect(() => instruments.split(',').forEach((id) => player.preload(id)), [instruments])

  // Keep playback in sync with edits.
  useEffect(() => {
    if (playing) player.load(song)
  }, [song, playing])

  useEffect(() => () => player.stop(), [])

  const togglePlay = async () => {
    if (playing) {
      player.stop()
      setPlaying(false)
    } else {
      await player.play(song)
      setPlaying(true)
    }
  }

  const rangeOf = (k: number) => clefRange(getClef(parts[Math.min(k, parts.length - 1)].clef))
  const voice = (spec: ChordSpec, bass: number, k: number) => voiceChord(spec, bass, rangeOf(k))
  const midis = (ps: { step: number; alter: number }[]) => ps.map((p) => toMidi(p.step, p.alter))

  /** On a grand staff the chord's bass note also goes to the left hand, an octave or more lower. */
  const leftHand = (bass: { step: number; alter: number }) => {
    const r = clefRange(getClef('bass'))
    let step = bass.step - 7
    while (step > r.hi) step -= 7
    while (step < r.lo) step += 7
    return { step, alter: bass.alter }
  }
  /** The notes a chord press writes on staff k: [this staff's notes, left-hand note or null]. */
  const chordNotes = (spec: ChordSpec, bass: number, k: number) => {
    const notes = voice(spec, bass, k)
    return { notes, lh: grand && k === 0 ? leftHand(notes[0]) : null }
  }

  /** Write (or replace) a chord on staff k, and its bass note in the left hand on a grand staff. */
  const writeChord = (k: number, measure: number, tick: number, dur: number, bass: number) => {
    const { notes, lh } = chordNotes(chordSpec, bass, k)
    const r = placeChord(parts[k], measure, tick, dur, notes)
    if (r.error) {
      setMessage(r.error)
      return null
    }
    let next = withPart(songRef.current, track, r.song, k)
    if (lh) {
      const l = placeChord(partOf(next, track, 1), measure, tick, dur, [lh])
      if (l.error) setMessage(`Left hand: ${l.error}`)
      else next = withPart(next, track, l.song, 1)
    }
    edit(next)
    return r.song
  }

  const preview = (k: number, step: number) => {
    void player.unlock().then(() => {
      if (chordInput) {
        const { notes, lh } = chordNotes(chordSpec, step, k)
        player.previewChord(parts[k].instrument, midis(lh ? [lh, ...notes] : notes), 0.4)
      } else player.preview(parts[k].instrument, toMidi(step, inputAlter ?? keyAlter(letterOf(step), parts[k].fifths)))
    })
  }

  const previewSpec = (spec: ChordSpec) => {
    const k = selStaff
    const bass = selected
      ? Math.min(...part.notes.filter((n) => n.measure === selected.measure && n.tick === selected.tick).map((n) => n.step))
      : getClef(parts[k].clef).bottomStep + 2
    const { notes, lh } = chordNotes(spec, bass, k)
    void player.unlock().then(() => player.previewChord(part.instrument, midis(lh ? [lh, ...notes] : notes)))
  }

  const tie = () => {
    if (!selected) return
    const r = toggleTie(part, selected.id, choiceTicks(choice))
    if (apply(r) && r.nextId) setSelectedId(r.nextId)
  }

  const accidental = (alter: number) => {
    if (selected) {
      editPart(setAccidental(part, selected.id, alter))
      void player.unlock().then(() => player.preview(part.instrument, toMidi(selected.step, alter)))
    } else {
      setInputAlter((a) => (a === alter ? null : alter))
    }
  }

  /** The picker's main button: replace the selected chord, or turn on chord input. */
  const applyChord = () => {
    setPickerOpen(false)
    if (selected) {
      const chord = part.notes.filter((n) => n.measure === selected.measure && n.tick === selected.tick)
      const bass = Math.min(...chord.map((n) => n.step))
      const written = writeChord(selStaff, selected.measure, selected.tick, selected.dur, bass)
      if (written) setSelectedId(written.notes.find((n) => n.measure === selected.measure && n.tick === selected.tick)?.id ?? null)
    } else {
      setChordInput(true)
    }
  }

  const getPlayBeat = useCallback(() => player.positionBeats(), [])

  const menu = (action: () => void) => () => {
    setMenuOpen(false)
    action()
  }

  return (
    <div className="editor">
      <header className="topbar">
        <button className="btn icon" onClick={() => setMenuOpen(true)} aria-label="Menu">
          ☰
        </button>
        <input
          className="title-input"
          value={song.title}
          onChange={(e) => onChange({ ...song, title: e.target.value, updatedAt: Date.now() })}
          aria-label="Song title"
        />
        <button className="btn icon" onClick={undo} disabled={!history.current.length} aria-label="Undo">
          ↶
        </button>
      </header>

      <TrackBar
        song={song}
        active={track}
        onSelect={(i) => (i === track ? setTrackSheet(true) : switchTrack(i))}
        onAdd={() => {
          edit(addTrack(song))
          switchTrack(song.tracks.length)
        }}
      />

      <main className="score">
        <Score
          parts={parts}
          inputDur={choiceTicks(choice)}
          selectedId={selected?.id ?? null}
          onSelect={(id, k) => {
            setSelectedId(id)
            setStaffIdx(k)
          }}
          onPlace={(k, m, tick, step) => {
            setSelectedId(null)
            setStaffIdx(k)
            if (chordInput) writeChord(k, m, tick, choiceTicks(choice), step)
            else apply(placeNote(parts[k], m, tick, choiceTicks(choice), step, inputAlter ?? undefined), k)
          }}
          chordInput={
            chordInput
              ? (k) => ({ voice: (step) => chordNotes(chordSpec, step, k).notes, label: specName(chordSpec) + (grand && k === 0 ? ' (+ left hand)' : '') })
              : undefined
          }
          inputAlter={inputAlter}
          onMove={(k, id, step) => editPart(moveNote(parts[k], id, step), k)}
          onPreview={preview}
          onAddMeasure={() => edit(editAllParts(song, (p) => setMeasures(p, song.measures + 1)))}
          getPlayBeat={getPlayBeat}
        />
        <p className={`hint ${message ? 'error' : ''}`}>
          {message ??
            (chordInput
              ? `Chord input: tap a rest to write ${specName(chordSpec)}; slide to move it. Tap Chord to change or stop.`
              : selected
              ? 'Selected: change its length, tie it (drag the tied note to make a slide), ♭ ♮ ♯, Chord or 🗑. Tap again to deselect.'
              : 'Tap a rest and slide up or down to pick the pitch. Tap a note to select it; drag it to move it.')}
        </p>
      </main>

      <DurationPalette
        value={shownChoice}
        onChange={changeDuration}
        canDelete={!!selected}
        onDelete={() => {
          if (selected) editPart(removeNote(part, selected.id))
          setSelectedId(null)
        }}
        chordLabel={chordInput ? specName(chordSpec) : null}
        onChord={() => setPickerOpen(true)}
        canTie={!!selected}
        tied={!!selected && !!tieTarget(part, selected)}
        onTie={tie}
        accidental={selected ? selected.alter : inputAlter}
        onAccidental={accidental}
      />

      {pickerOpen && (
        <ChordPicker
          fifths={part.fifths}
          value={chordSpec}
          onChange={setChordSpec}
          onPreview={previewSpec}
          replacing={!!selected}
          armed={chordInput}
          onApply={applyChord}
          onStop={() => {
            setChordInput(false)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <footer className="transport">
        <button className={`btn play ${playing ? 'on' : ''}`} onClick={togglePlay} aria-label={playing ? 'Stop' : 'Play'}>
          {playing ? '■' : '▶'}
        </button>
        <label className="field">
          <span>Tempo</span>
          <div className="stepper">
            <button className="btn small" onClick={() => editPart(updateSong(part, { tempo: Math.max(30, song.tempo - 5) }))}>
              −
            </button>
            <output>{song.tempo}</output>
            <button className="btn small" onClick={() => editPart(updateSong(part, { tempo: Math.min(300, song.tempo + 5) }))}>
              +
            </button>
          </div>
        </label>
        <label className="field">
          <span>Sound</span>
          <InstrumentSelect value={part.instrument} onChange={(id) => edit(setTrackInstrument(song, track, id))} />
          <InstrumentStatus id={part.instrument} />
        </label>
      </footer>

      {trackSheet && (
        <div className="sheet-backdrop" onClick={() => setTrackSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Track {track + 1}</h2>
            <label>
              Instrument
              <InstrumentSelect value={part.instrument} onChange={(id) => edit(setTrackInstrument(song, track, id))} />
            </label>
            <button
              className={`menu-item toggle ${grand ? 'on' : ''}`}
              aria-pressed={grand}
              onClick={() => {
                if (grand && song.tracks[track].notes.some((n) => n.staff) && !confirm('Merge the bass staff into one staff?')) return
                edit(setTrackGrand(song, track, !grand))
                setSelectedId(null)
                setStaffIdx(0)
              }}
            >
              {grand ? '☑' : '☐'} Grand staff (treble + bass)
            </button>
            {!grand && (
              <label>
                Clef
                <select value={part.clef} onChange={(e) => editPart(updateSong(part, { clef: e.target.value as ClefId }))}>
                  {CLEFS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="menu-item" onClick={() => edit(setTrackMuted(song, track, !song.tracks[track].muted))}>
              {song.tracks[track].muted ? '🔊 Unmute track' : '🔇 Mute track'}
            </button>
            <button
              className="menu-item danger"
              disabled={song.tracks.length <= 1}
              onClick={() => {
                if (!confirm(`Delete track ${track + 1} and its notes?`)) return
                edit(removeTrack(song, track))
                switchTrack(Math.max(0, track - 1))
                setTrackSheet(false)
              }}
            >
              Delete track
            </button>
            <div className="sheet-actions">
              <button className="btn primary" onClick={() => setTrackSheet(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {menuOpen && (
        <div className="sheet-backdrop" onClick={() => setMenuOpen(false)}>
          <nav className="sheet menu" onClick={(e) => e.stopPropagation()}>
            <h2>Song</h2>
            <button className="menu-item" onClick={menu(onNewSong)}>
              ＋ Create song
            </button>
            <button className="menu-item" onClick={menu(onHome)}>
              ♫ My songs
            </button>
            <button className="menu-item" onClick={menu(() => downloadMidi(song))}>
              ⤓ Export MIDI file
            </button>
            <div className="menu-row">
              <label>
                Key
                <select value={part.fifths} onChange={(e) => edit(editAllParts(song, (p) => setKey(p, Number(e.target.value))))}>
                  {KEYS.map((k) => (
                    <option key={k.fifths} value={k.fifths}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Time
                <select value={song.beatsPerMeasure} onChange={(e) => edit(editAllParts(song, (p) => setBeatsPerMeasure(p, Number(e.target.value))))}>
                  {[2, 3, 4, 5, 6].map((b) => (
                    <option key={b} value={b}>
                      {b}/4
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="menu-row">
              <button className="menu-item" onClick={() => edit(editAllParts(song, (p) => setMeasures(p, song.measures + 1)))}>
                ＋ Add measure
              </button>
              <button className="menu-item" disabled={song.measures <= 1} onClick={() => edit(editAllParts(song, (p) => setMeasures(p, song.measures - 1)))}>
                − Remove last measure
              </button>
            </div>
            <button className="menu-item danger" disabled={!part.notes.length} onClick={menu(() => editPart({ ...part, notes: [] }))}>
              Clear this track’s notes
            </button>
          </nav>
        </div>
      )}
    </div>
  )
}
