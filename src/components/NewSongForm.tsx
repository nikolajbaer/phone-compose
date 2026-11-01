import { useState } from 'react'
import type { InstrumentId, NewSongOptions } from '../music/song'
import { INSTRUMENTS } from '../music/song'
import { KEYS } from '../music/theory'

export function NewSongForm({ onCreate, onCancel }: { onCreate: (o: NewSongOptions) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [tempo, setTempo] = useState(120)
  const [beats, setBeats] = useState(4)
  const [fifths, setFifths] = useState(0)
  const [instrument, setInstrument] = useState<InstrumentId>('square')
  const [measures, setMeasures] = useState(4)

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <form
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onCreate({ title, tempo, beatsPerMeasure: beats, fifths, instrument, measures })
        }}
      >
        <h2>New song</h2>
        <label>
          Title
          <input autoFocus value={title} placeholder="Untitled song" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="row">
          <label>
            Tempo
            <input type="number" min={30} max={300} value={tempo} onChange={(e) => setTempo(Number(e.target.value) || 120)} />
          </label>
          <label>
            Time
            <select value={beats} onChange={(e) => setBeats(Number(e.target.value))}>
              {[2, 3, 4, 5, 6].map((b) => (
                <option key={b} value={b}>
                  {b}/4
                </option>
              ))}
            </select>
          </label>
          <label>
            Measures
            <input type="number" min={1} max={256} value={measures} onChange={(e) => setMeasures(Number(e.target.value) || 4)} />
          </label>
        </div>
        <label>
          Key
          <select value={fifths} onChange={(e) => setFifths(Number(e.target.value))}>
            {KEYS.map((k) => (
              <option key={k.fifths} value={k.fifths}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Instrument
          <select value={instrument} onChange={(e) => setInstrument(e.target.value as InstrumentId)}>
            {INSTRUMENTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Create song
          </button>
        </div>
      </form>
    </div>
  )
}
