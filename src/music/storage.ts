import type { Song } from './song'

const KEY = 'phone-compose:songs'

export function loadSongs(): Song[] {
  try {
    const raw = localStorage.getItem(KEY)
    const songs = raw ? (JSON.parse(raw) as Song[]) : []
    return Array.isArray(songs) ? songs.sort((a, b) => b.updatedAt - a.updatedAt) : []
  } catch {
    return []
  }
}

export function saveSong(song: Song) {
  const songs = loadSongs().filter((s) => s.id !== song.id)
  localStorage.setItem(KEY, JSON.stringify([song, ...songs]))
}

export function deleteSong(id: string) {
  localStorage.setItem(KEY, JSON.stringify(loadSongs().filter((s) => s.id !== id)))
}
