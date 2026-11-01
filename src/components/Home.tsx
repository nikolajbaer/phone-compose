import type { Song } from '../music/song'

export function Home({ songs, onNew, onOpen, onDelete }: { songs: Song[]; onNew: () => void; onOpen: (s: Song) => void; onDelete: (s: Song) => void }) {
  return (
    <div className="home">
      <header className="home-head">
        <h1>
          <svg className="logo" width={34} height={64} aria-hidden>
            <text className="glyph" x={2} y={42} fontSize={34}>
              {'\uE050'}
            </text>
          </svg> Phone Compose
        </h1>
        <p>Write music on a staff, right on your phone.</p>
      </header>
      <button className="btn primary big" onClick={onNew}>
        + Create song
      </button>
      {songs.length > 0 && (
        <section className="song-list">
          <h2>Your songs</h2>
          <ul>
            {songs.map((s) => (
              <li key={s.id}>
                <button className="song-open" onClick={() => onOpen(s)}>
                  <strong>{s.title}</strong>
                  <span>
                    {s.notes.length} notes · {s.measures} bars · {s.tempo} bpm · {new Date(s.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                <button
                  className="btn icon"
                  aria-label={`Delete ${s.title}`}
                  onClick={() => confirm(`Delete "${s.title}"?`) && onDelete(s)}
                >
                  🗑
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
