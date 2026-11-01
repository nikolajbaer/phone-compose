import { BASES, type BaseDuration, type DurationChoice } from '../music/duration'

// The note-length palette, like MuseScore's note input toolbar: pick the
// length for the next note, or, with a note selected, change that note.

const ICON: Record<BaseDuration, string> = {
  whole: '\uE1D2',
  half: '\uE1D3',
  quarter: '\uE1D5',
  eighth: '\uE1D7',
  sixteenth: '\uE1D9',
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
  /** Tie: enabled with a note selected; on when that note is tied. */
  canTie: boolean
  tied: boolean
  onTie: () => void
  /** The highlighted accidental (selected note's, or the one for new notes), or null. */
  accidental: number | null
  onAccidental: (alter: number) => void
}

const ACCIDENTALS: [number, string, string][] = [
  [-1, '\uE260', 'Flat'],
  [0, '\uE261', 'Natural'],
  [1, '\uE262', 'Sharp'],
]

function TieIcon() {
  return (
    <svg width={28} height={20} aria-hidden>
      <path d="M3,6 C9,16 19,16 25,6 C19,13 9,13 3,6 Z" className="tie-icon" />
    </svg>
  )
}

export function DurationPalette(props: Props) {
  const { value, onChange, canDelete, onDelete, chordLabel, onChord, canTie, tied, onTie, accidental, onAccidental } = props
  return (
    <div className="palette" role="toolbar" aria-label="Note input">
      <div className="pal-row">
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
          <Glyph ch={'\uE1E7'} y={24} size={40} />
        </button>
        <button
          className={`pal-btn ${value.triplet ? 'on' : ''}`}
          aria-label="Triplet"
          aria-pressed={value.triplet}
          onClick={() => onChange({ ...value, triplet: !value.triplet, dotted: false })}
        >
          <Glyph ch={'\uE883'} y={28} size={30} />
        </button>
        <button className={`pal-btn ${tied ? 'on' : ''}`} aria-label="Tie" aria-pressed={tied} disabled={!canTie} onClick={onTie}>
          <TieIcon />
        </button>
      </div>
      <div className="pal-row">
        {ACCIDENTALS.map(([a, ch, label]) => (
          <button
            key={a}
            className={`pal-btn ${accidental === a ? 'on' : ''}`}
            aria-label={label}
            aria-pressed={accidental === a}
            onClick={() => onAccidental(a)}
          >
            <Glyph ch={ch} y={26} size={30} />
          </button>
        ))}
        <span className="pal-sep" />
        <button className={`pal-btn chord-btn ${chordLabel ? 'on' : ''}`} aria-label="Chord" onClick={onChord}>
          {chordLabel ?? 'Chord'}
        </button>
        <button className="pal-btn" aria-label="Delete note" disabled={!canDelete} onClick={onDelete}>
          🗑
        </button>
      </div>
    </div>
  )
}
