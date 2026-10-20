// Suggested bans (one attacker + one defender per team), shared by the Live page and the Maps tab.
import type { MapBans } from '../../shared/ipc'
import { SideTag } from './lib'

/** `only`: show just the side you can ban (Siege X: each team bans one enemy operator per round). */
export function BansPanel({ bans, note, only }: { bans: MapBans; note?: string; only?: 'attack' | 'defense' }) {
  return (
    <div className="panel">
      <h2>Suggested bans <span className="sub">{note ?? 'for this map · hover for why'}</span></h2>
      {(only ? [only] : (['attack', 'defense'] as const)).map((side) => (
        <div className="row" key={side} style={{ gap: 8, marginBottom: 8 }}>
          <SideTag side={side} />
          {bans[side].length ? bans[side].map((b, i) => (
            <span key={b.opKey} className="opchip" title={b.reasons.join(' · ')} style={i === 0 ? { fontSize: '0.9rem', padding: '3px 9px' } : undefined}>
              {b.name}
              <span className="faint small" style={{ marginLeft: 6, textTransform: 'none', fontFamily: 'var(--body)', fontWeight: 400 }}>{b.reasons[0]}</span>
            </span>
          )) : <span className="faint small">No clear ban</span>}
        </div>
      ))}
    </div>
  )
}
