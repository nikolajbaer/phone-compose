import { QUALITIES, diatonicChords, inversionCount, specName, type ChordSpec } from '../music/chordBuilder'
import { LETTERS } from '../music/theory'

// Bottom sheet to choose a chord: a chord of the key, or any root, quality
// and inversion. With a note selected it replaces that chord; otherwise it
// turns on chord input, where tapping a rest writes the chord.

const INVERSIONS = ['Root', '1st inv', '2nd inv', '3rd inv']

interface Props {
  fifths: number
  value: ChordSpec
  onChange: (spec: ChordSpec) => void
  onPreview: (spec: ChordSpec) => void
  /** A chord is selected in the score: the main button replaces it. */
  replacing: boolean
  armed: boolean
  onApply: () => void
  onStop: () => void
  onClose: () => void
  /** Editing the progression: where (e.g. "bar 3, beat 1"), and removing the chord there. */
  lane?: { where: string; onRemove?: () => void } | null
}

export function ChordPicker({ fifths, value, onChange, onPreview, replacing, armed, onApply, onStop, onClose, lane }: Props) {
  const set = (patch: Partial<ChordSpec>) => {
    const next = { ...value, ...patch }
    next.inversion = Math.min(next.inversion, inversionCount(next.quality) - 1)
    onChange(next)
    onPreview(next)
  }
  const same = (a: ChordSpec, b: ChordSpec) => a.letter === b.letter && a.alter === b.alter && a.quality === b.quality

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet chord-picker" onClick={(e) => e.stopPropagation()}>
        <div className="cp-head">
          <h2 className="cp-name">{specName(value)}</h2>
          <button className="btn" onClick={() => onPreview(value)} aria-label="Hear chord">
            ▶ Hear
          </button>
        </div>

        <section>
          <h3>In this key</h3>
          <div className="chips">
            {diatonicChords(fifths).map((c) => (
              <button
                key={c.numeral}
                className={`chip ${same(c, value) ? 'on' : ''}`}
                onClick={() => set({ letter: c.letter, alter: c.alter, quality: c.quality })}
              >
                <b>{c.numeral}</b>
                <small>{specName(c)}</small>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Root</h3>
          <div className="chips">
            {LETTERS.map((l, i) => (
              <button key={l} className={`chip ${value.letter === i ? 'on' : ''}`} onClick={() => set({ letter: i })}>
                {l}
              </button>
            ))}
            <span className="chip-sep" />
            {[
              [-1, '♭'],
              [0, '♮'],
              [1, '♯'],
            ].map(([a, label]) => (
              <button key={a} className={`chip ${value.alter === a ? 'on' : ''}`} onClick={() => set({ alter: a as number })}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Type</h3>
          <div className="chips">
            {QUALITIES.map((q) => (
              <button key={q.id} className={`chip ${value.quality === q.id ? 'on' : ''}`} onClick={() => set({ quality: q.id })}>
                {q.label}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Bass note</h3>
          <div className="chips">
            {INVERSIONS.slice(0, inversionCount(value.quality)).map((label, i) => (
              <button key={label} className={`chip ${value.inversion === i ? 'on' : ''}`} onClick={() => set({ inversion: i })}>
                {label}
                <small>{specName({ ...value, inversion: i })}</small>
              </button>
            ))}
          </div>
        </section>

        <div className="sheet-actions">
          {lane?.onRemove && (
            <button className="btn" onClick={lane.onRemove}>
              Remove
            </button>
          )}
          {!lane && armed && !replacing && (
            <button className="btn" onClick={onStop}>
              Stop chord input
            </button>
          )}
          <button className="btn primary" onClick={onApply}>
            {lane ? `Set chord at ${lane.where}` : replacing ? 'Replace selected chord' : armed ? 'Done' : 'Write this chord'}
          </button>
        </div>
      </div>
    </div>
  )
}
