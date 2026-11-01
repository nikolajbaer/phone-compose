import { useCallback, useEffect, useRef, useState } from 'react'
import { player } from '../audio/player'
import { downloadMidi } from '../audio/midiExport'
import type { InstrumentId, Song } from '../music/song'
import { INSTRUMENTS, addNote, moveNote, removeNote, setBeatsPerMeasure, setKey, setMeasures, updateSong } from '../music/song'
import { KEYS, keyAlter, letterOf, toMidi } from '../music/theory'
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

  const undo = () => {
    const prev = history.current.pop()
    if (prev) onChange(prev)
  }

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
    void player.unlock().then(() => player.preview(song.instrument, toMidi(step, keyAlter(letterOf(step), song.fifths))))
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
          onAdd={(m, b, step) => edit(addNote(song, m, b, step))}
          onRemove={(id) => edit(removeNote(song, id))}
          onMove={(id, step) => edit(moveNote(song, id, step))}
          onPreview={preview}
          onAddMeasure={() => edit(setMeasures(song, song.measures + 1))}
          getPlayBeat={getPlayBeat}
        />
        <p className="hint">Tap a beat to place a quarter note — slide up or down before letting go to pick the pitch. Tap a note to remove it, or drag it to move it.</p>
      </main>

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
          <select value={song.instrument} onChange={(e) => edit(updateSong(song, { instrument: e.target.value as InstrumentId }))}>
            {INSTRUMENTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
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
