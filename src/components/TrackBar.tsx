import { getInstrument } from '../music/instruments'
import type { Song } from '../music/song'

// Tabs for the song's tracks. Tap a track to edit it on the staff; tap the
// active one again for its settings (instrument, clef, mute, delete).

interface Props {
  song: Song
  active: number
  onSelect: (track: number) => void
  onAdd: () => void
}

export function TrackBar({ song, active, onSelect, onAdd }: Props) {
  return (
    <div className="track-bar" role="tablist" aria-label="Tracks">
      {song.tracks.map((t, i) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={i === active}
          className={`track-tab ${i === active ? 'on' : ''} ${t.muted ? 'muted' : ''}`}
          onClick={() => onSelect(i)}
        >
          <span className="track-num">{i + 1}</span>
          {getInstrument(t.instrument).name}
          {t.muted && <span aria-label="muted"> 🔇</span>}
          {i === active && <span className="track-gear" aria-hidden> ⚙</span>}
        </button>
      ))}
      <button className="track-tab add" onClick={onAdd} aria-label="Add track">
        + Track
      </button>
    </div>
  )
}
