import { useEffect, useState } from 'react'
import { Editor } from './components/Editor'
import { Home } from './components/Home'
import { NewSongForm } from './components/NewSongForm'
import type { NewSongOptions, Song } from './music/song'
import { createSong } from './music/song'
import { deleteSong, loadSongs, saveSong } from './music/storage'

export function App() {
  const [songs, setSongs] = useState<Song[]>(() => loadSongs())
  const [current, setCurrent] = useState<Song | null>(null)
  const [creating, setCreating] = useState(false)

  // Autosave the open song.
  useEffect(() => {
    if (!current) return
    const t = setTimeout(() => saveSong(current), 300)
    return () => clearTimeout(t)
  }, [current])

  const goHome = () => {
    if (current) saveSong(current)
    setCurrent(null)
    setSongs(loadSongs())
  }

  const create = (opts: NewSongOptions) => {
    if (current) saveSong(current)
    const song = createSong(opts)
    saveSong(song)
    setCreating(false)
    setCurrent(song)
  }

  return (
    <>
      {current ? (
        <Editor key={current.id} song={current} onChange={setCurrent} onNewSong={() => setCreating(true)} onHome={goHome} />
      ) : (
        <Home
          songs={songs}
          onNew={() => setCreating(true)}
          onOpen={setCurrent}
          onDelete={(s) => {
            deleteSong(s.id)
            setSongs(loadSongs())
          }}
        />
      )}
      {creating && <NewSongForm onCreate={create} onCancel={() => setCreating(false)} />}
    </>
  )
}
