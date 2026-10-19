import type { Settings } from '../../../shared/ipc'
import { allOperators } from '../../../shared/catalog'
import type { Side } from '../../../shared/types'
import { SideTag, rs } from '../lib'

const ROLE: Record<string, string> = {
  hb: 'hard breach', sb: 'soft breach', uc: 'utility clear', in: 'intel', fl: 'flank watch', sh: 'shield', pl: 'plant', en: 'entry',
  ah: 'anti-breach', ap: 'anti-projectile', ro: 'roam', an: 'anchor', tr: 'trap', de: 'denial', rf: 'reinforce', su: 'support'
}

export function RosterPage({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const setSide = (side: Side, keys: string[]) => update({ roster: { ...settings.roster, [side]: keys } })
  const mostPlayed = async (side: Side) => {
    const rows = await rs().opStats({ mine: true, side })
    const keys = rows.slice(0, 8).map((r) => allOperators().find((o) => o.id === r.operatorId)?.key).filter((k): k is string => !!k)
    if (keys.length) await setSide(side, keys)
  }
  return (
    <>
      <div className="panel">
        <h2>Active roster</h2>
        <p className="muted small" style={{ margin: 0 }}>Pick the operators you're willing to play. Recommendations only come from this list. Nothing selected on a side means every operator is considered.</p>
      </div>
      {(['attack', 'defense'] as Side[]).map((side) => {
        const sel = new Set(settings.roster[side])
        const ops = allOperators(side).slice().sort((a, b) => a.name.localeCompare(b.name))
        const toggle = (key: string) => setSide(side, sel.has(key) ? [...sel].filter((k) => k !== key) : [...sel, key])
        return (
          <div className="panel" key={side}>
            <h2><SideTag side={side} /> {sel.size ? `${sel.size} selected` : 'All operators'}
              <span className="spacer" />
              <button className="btn" onClick={() => setSide(side, ops.map((o) => o.key))}>All</button>
              <button className="btn" onClick={() => setSide(side, [])}>Clear</button>
              <button className="btn" onClick={() => void mostPlayed(side)} title="Your 8 most-played from replays">Most played</button>
            </h2>
            <div className="roster">
              {ops.map((o) => (
                <button key={o.key} className={`op${sel.size === 0 || sel.has(o.key) ? ' on' : ''}`} onClick={() => void toggle(o.key)} aria-pressed={sel.has(o.key)}>
                  <span className="n">{o.name}</span>
                  <span className="r">{o.roles.map((r) => ROLE[r] ?? r).join(' · ')}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
