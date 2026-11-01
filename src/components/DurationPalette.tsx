import { BASES, type BaseDuration, type DurationChoice } from '../music/duration'

// The note-length palette, like MuseScore's note input toolbar: pick the
// length for the next note, or, with a note selected, change that note.

const ICON: Record<BaseDuration, string> = {
  whole: '',
  half: '',
  quarter: '',
  eighth: '',
  sixteenth: '',
}
const LABEL: Record<BaseDuration, string> = {
  whole: 'Whole note',
  half: 'Half note',
  quarter: 'Quarter note',
  eighth: 'Eighth note',
  sixteenth: 'Sixteenth note',
}

function Glyph({ ch, y = 30, size = 30 }: { ch: string; y?: number; size?: number }) {
  return (
    <svg width={22} height={40} aria-hidden>
      <text className="glyph" x={4} y={y} fontSize={size}>
        {ch}
      </text>
    </svg>
  )
}

interface Props {
  value: DurationChoice
  onChange: (c: DurationChoice) => void
  canDelete: boolean
  onDelete: () => void
  /** Chord name while chord input is on. */
  chordLabel: string | null
  onChord: () => void
}

export function DurationPalette({ value, onChange, canDelete, onDelete, chordLabel, onChord }: Props) {
  return (
    <div className="palette" role="toolbar" aria-label="Note length">
      {BASES.map((b) => (
        <button
          key={b}
          className={`pal-btn ${value.base === b ? 'on' : ''}`}
          aria-label={LABEL[b]}
          aria-pressed={value.base === b}
          onClick={() => onChange({ ...value, base: b })}
        >
          <Glyph ch={ICON[b]} y={b === 'whole' ? 22 : 30} />
        </button>
      ))}
      <span className="pal-sep" />
      <button
        className={`pal-btn ${value.dotted ? 'on' : ''}`}
        aria-label="Dotted"
        aria-pressed={value.dotted}
        onClick={() => onChange({ ...value, dotted: !value.dotted, triplet: false })}
      >
        <Glyph ch={''} y={24} size={40} />
      </button>
      <button
        className={`pal-btn ${value.triplet ? 'on' : ''}`}
        aria-label="Triplet"
        aria-pressed={value.triplet}
        onClick={() => onChange({ ...value, triplet: !value.triplet, dotted: false })}
      >
        <Glyph ch={''} y={28} size={30} />
      </button>
      <span className="pal-sep" />
      <button className={`pal-btn chord-btn ${chordLabel ? 'on' : ''}`} aria-label="Chord" onClick={onChord}>
        {chordLabel ?? 'Chord'}
      </button>
      <button className="pal-btn" aria-label="Delete note" disabled={!canDelete} onClick={onDelete}>
        🗑
      </button>
    </div>
  )
}
