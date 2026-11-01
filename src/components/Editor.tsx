import { useCallback, useEffect, useRef, useState } from 'react'
import { player } from '../audio/player'
import { downloadMidi } from '../audio/midiExport'
import type { Song } from '../music/song'
import { moveNote, placeChord, placeNote, removeNote, setBeatsPerMeasure, setChordDuration, setKey, setMeasures, updateSong, type EditResult } from '../music/song'
import { choiceTicks, describeTicks, type DurationChoice } from '../music/duration'
import { KEYS, keyAlter, letterOf, toMidi } from '../music/theory'
import { InstrumentSelect, InstrumentStatus } from './InstrumentSelect'
import { DurationPalette } from './DurationPalette'
import { ChordPicker } from './ChordPicker'
import { diatonicChords, specName, voiceChord, type ChordSpec } from '../music/chordBuilder'
import { Staff } from './Staff'

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
  const history = useRef<Song[]>([])
  const songRef = useRef(song)
  songRef.current = song

  // Every edit goes through here so it can be undone.
  const edit = useCallback(
    (next: Song) => {
      if (next === songRef.current) return
      history.current = [...history.current.slice(-99), songRef.current]
      onChange(next)
    },
    [onChange],
  )

  const apply = (r: EditResult) => {
    if (r.error) {
      setMessage(r.error)
      return false
    }
    edit(r.song)
    return true
  }

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 2500)
    return () => clearTimeout(t)
  }, [message])

  // The selection goes away if its note does (undo, overwritten, deleted).
  const selected = song.notes.find((n) => n.id === selectedId) ?? null
  const shownChoice = (selected && describeTicks(selected.dur)) || choice

  const changeDuration = (c: DurationChoice) => {
    setChoice(c)
    if (selected) apply(setChordDuration(song, selected.id, choiceTicks(c)))
  }

  const undo = () => {
    const prev = history.current.pop()
    if (prev) onChange(prev)
  }

  // Start downloading the song's instrument as soon as it is chosen.
  useEffect(() => player.preload(song.instrument), [song.instrument])

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

  const preview = (step: number) => {
    void player.unlock().then(() => {
      if (chordInput) player.previewChord(song.instrument, voiceChord(chordSpec, step).map((p) => toMidi(p.step, p.alter)), 0.4)
      else player.preview(song.instrument, toMidi(step, keyAlter(letterOf(step), song.fifths)))
    })
  }

  const previewSpec = (spec: ChordSpec) => {
    const bass = selected ? Math.min(...song.notes.filter((n) => n.measure === selected.measure && n.tick === selected.tick).map((n) => n.step)) : 0
    void player.unlock().then(() => player.previewChord(song.instrument, voiceChord(spec, bass).map((p) => toMidi(p.step, p.alter))))
  }

  /** The picker's main button: replace the selected chord, or turn on chord input. */
  const applyChord = () => {
    setPickerOpen(false)
    if (selected) {
      const chord = song.notes.filter((n) => n.measure === selected.measure && n.tick === selected.tick)
      const bass = Math.min(...chord.map((n) => n.step))
      const r = placeChord(song, selected.measure, selected.tick, selected.dur, voiceChord(chordSpec, bass))
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
          onChange={(e) => onChange(updateSong(song, { title: e.target.value }))}
          aria-label="Song title"
        />
        <button className="btn icon" onClick={undo} disabled={!history.current.length} aria-label="Undo">
          ↶
        </button>
      </header>

      <main className="score">
        <Staff
          song={song}
          inputDur={choiceTicks(choice)}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          onPlace={(m, tick, step) => {
            setSelectedId(null)
            if (chordInput) apply(placeChord(song, m, tick, choiceTicks(choice), voiceChord(chordSpec, step)))
            else apply(placeNote(song, m, tick, choiceTicks(choice), step))
          }}
          chordInput={chordInput ? { voice: (step) => voiceChord(chordSpec, step), label: specName(chordSpec) } : null}
          onMove={(id, step) => edit(moveNote(song, id, step))}
          onPreview={preview}
          onAddMeasure={() => edit(setMeasures(song, song.measures + 1))}
          getPlayBeat={getPlayBeat}
        />
        <p className={`hint ${message ? 'error' : ''}`}>
          {message ??
            (chordInput
              ? `Chord input: tap a rest to write ${specName(chordSpec)} — slide up or down to move it. Tap Chord to change or stop.`
              : selected
              ? 'Note selected: pick a length to change it, Chord to replace it, 🗑 to delete it, or tap it again to deselect.'
              : 'Pick a length, then tap a rest and slide up or down to choose the pitch. Tap a note to select it; drag it to move it.')}
        </p>
      </main>

      <DurationPalette
        value={shownChoice}
        onChange={changeDuration}
        canDelete={!!selected}
        onDelete={() => {
          if (selected) edit(removeNote(song, selected.id))
          setSelectedId(null)
        }}
        chordLabel={chordInput ? specName(chordSpec) : null}
        onChord={() => setPickerOpen(true)}
      />

      {pickerOpen && (
        <ChordPicker
          fifths={song.fifths}
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
            <button className="btn small" onClick={() => edit(updateSong(song, { tempo: Math.max(30, song.tempo - 5) }))}>
              −
            </button>
            <output>{song.tempo}</output>
            <button className="btn small" onClick={() => edit(updateSong(song, { tempo: Math.min(300, song.tempo + 5) }))}>
              +
            </button>
          </div>
        </label>
        <label className="field">
          <span>Sound</span>
          <InstrumentSelect value={song.instrument} onChange={(id) => edit(updateSong(song, { instrument: id }))} />
          <InstrumentStatus id={song.instrument} />
        </label>
      </footer>

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
                <select value={song.fifths} onChange={(e) => edit(setKey(song, Number(e.target.value)))}>
                  {KEYS.map((k) => (
                    <option key={k.fifths} value={k.fifths}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Time
                <select value={song.beatsPerMeasure} onChange={(e) => edit(setBeatsPerMeasure(song, Number(e.target.value)))}>
                  {[2, 3, 4, 5, 6].map((b) => (
                    <option key={b} value={b}>
                      {b}/4
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="menu-row">
              <button className="menu-item" onClick={() => edit(setMeasures(song, song.measures + 1))}>
                ＋ Add measure
              </button>
              <button className="menu-item" disabled={song.measures <= 1} onClick={() => edit(setMeasures(song, song.measures - 1))}>
                − Remove last measure
              </button>
            </div>
            <button className="menu-item danger" disabled={!song.notes.length} onClick={menu(() => edit({ ...song, notes: [], updatedAt: Date.now() }))}>
              Clear all notes
            </button>
          </nav>
        </div>
      )}
    </div>
  )
}
