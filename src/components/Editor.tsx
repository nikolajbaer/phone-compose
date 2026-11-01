import { useCallback, useEffect, useRef, useState } from 'react'
import { player } from '../audio/player'
import { downloadMidi } from '../audio/midiExport'
import type { Part, Song } from '../music/song'
import {
  addTrack,
  editAllParts,
  partOf,
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
  setInstrument,
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
import { Staff } from './Staff'
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
  const track = Math.min(active, song.tracks.length - 1)
  /** The active track with the song's settings: what the staff shows and edits. */
  const part = partOf(song, track)

  // Every edit goes through here so it can be undone.
  const edit = useCallback(
    (next: Song) => {
      if (next === songRef.current) return
      history.current = [...history.current.slice(-99), songRef.current]
      onChange(next)
    },
    [onChange],
  )

  const editPart = (p: Part) => edit(withPart(songRef.current, track, p))

  const apply = (r: EditResult) => {
    if (r.error) {
      setMessage(r.error)
      return false
    }
    editPart(r.song)
    return true
  }

  const switchTrack = (i: number) => {
    setActive(i)
    setSelectedId(null)
    setChordInput(false)
  }

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 2500)
    return () => clearTimeout(t)
  }, [message])

  // The selection goes away if its note does (undo, overwritten, deleted).
  const selected = part.notes.find((n) => n.id === selectedId) ?? null
  const shownChoice = (selected && describeTicks(selected.dur)) || choice

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

  const clef = getClef(part.clef)
  const range = clefRange(clef)
  const voice = (spec: ChordSpec, bass: number) => voiceChord(spec, bass, range)

  const preview = (step: number) => {
    void player.unlock().then(() => {
      if (chordInput) player.previewChord(part.instrument, voice(chordSpec, step).map((p) => toMidi(p.step, p.alter)), 0.4)
      else player.preview(part.instrument, toMidi(step, inputAlter ?? keyAlter(letterOf(step), part.fifths)))
    })
  }

  const previewSpec = (spec: ChordSpec) => {
    const bass = selected
      ? Math.min(...part.notes.filter((n) => n.measure === selected.measure && n.tick === selected.tick).map((n) => n.step))
      : clef.bottomStep + 2
    void player.unlock().then(() => player.previewChord(part.instrument, voice(spec, bass).map((p) => toMidi(p.step, p.alter))))
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
      const r = placeChord(part, selected.measure, selected.tick, selected.dur, voice(chordSpec, bass))
      if (apply(r)) setSelectedId(r.song.notes.find((n) => n.measure === selected.measure && n.tick === selected.tick)?.id ?? null)
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
        <Staff
          song={part}
          inputDur={choiceTicks(choice)}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          onPlace={(m, tick, step) => {
            setSelectedId(null)
            if (chordInput) apply(placeChord(part, m, tick, choiceTicks(choice), voice(chordSpec, step)))
            else apply(placeNote(part, m, tick, choiceTicks(choice), step, inputAlter ?? undefined))
          }}
          chordInput={chordInput ? { voice: (step) => voice(chordSpec, step), label: specName(chordSpec) } : null}
          inputAlter={inputAlter}
          onMove={(id, step) => editPart(moveNote(part, id, step))}
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
          <InstrumentSelect value={part.instrument} onChange={(id) => editPart(setInstrument(part, id))} />
          <InstrumentStatus id={part.instrument} />
        </label>
      </footer>

      {trackSheet && (
        <div className="sheet-backdrop" onClick={() => setTrackSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2>Track {track + 1}</h2>
            <label>
              Instrument
              <InstrumentSelect value={part.instrument} onChange={(id) => editPart(setInstrument(part, id))} />
            </label>
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
            <label>
              Clef
              <select value={clef.id} onChange={(e) => editPart(updateSong(part, { clef: e.target.value as ClefId }))}>
                {CLEFS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
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
