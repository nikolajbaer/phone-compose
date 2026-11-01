import { useSyncExternalStore } from 'react'
import { player } from '../audio/player'
import { INSTRUMENTS } from '../music/instruments'

const GROUPS = ['Instruments', 'Synths'] as const

export function InstrumentSelect({ value, onChange, className }: { value: string; onChange: (id: string) => void; className?: string }) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {INSTRUMENTS.filter((i) => i.group === g).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/** "Loading 40%" / "Couldn't load" for a sampled instrument; nothing once it is ready. */
export function InstrumentStatus({ id }: { id: string }) {
  const status = useSyncExternalStore(player.subscribe, () => player.getStatus(id))
  if (!status || status.state === 'ready') return null
  if (status.state === 'error') {
    return (
      <button className="inst-status error" onClick={() => player.preload(id)}>
        Couldn’t load · retry
      </button>
    )
  }
  const pct = status.total ? Math.round((100 * status.loaded) / status.total) : 0
  return <span className="inst-status">Loading {pct}%</span>
}
