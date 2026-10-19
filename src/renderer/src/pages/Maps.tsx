// Maps tab: the researched meta for any ranked map, outside a live game.
import { useState } from 'react'
import type { GuideOp, MapGuide } from '../../../shared/ipc'
import { allMaps } from '../../../shared/catalog'
import { pickerMaps } from '../../../shared/data/sitePicks'
import type { Side } from '../../../shared/types'
import { Bar, Seg, SideTag, pct, rs, useData, useSort } from '../lib'
import { BansPanel } from '../Bans'

const signed = (x: number | null) => (x === null ? '' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`)

function Op({ op, big }: { op: GuideOp; big?: boolean }) {
  const tip = [
    op.winDelta !== null ? `Ranked win delta ${signed(op.winDelta)}` : 'No official ranked delta',
    op.proBan !== null ? `Pro ban rate here ${pct(op.proBan)}` : null,
    op.yourRounds ? `You: ${pct(op.yourWinRate ?? 0)} in ${op.yourRounds} rds` : null
  ].filter(Boolean).join(' · ')
  return (
    <span className="opchip" title={tip} style={big ? { fontSize: '0.85rem', padding: '3px 8px' } : undefined}>
      {op.name}
      {op.winDelta !== null && <span className={op.winDelta >= 0 ? 'w' : 'l'} style={{ marginLeft: 6, fontWeight: 600 }}>{signed(op.winDelta)}</span>}
    </span>
  )
}

export function MapsPage() {
  const maps = pickerMaps(allMaps())
  const [mapKey, setMapKey] = useState(maps[0]?.key ?? 'clubhouse')
  const [side, setSide] = useState<Side>('defense')
  const [g] = useData(() => rs().mapGuide(mapKey, side), [mapKey, side])
  const { sort, H } = useSort<MapGuide['ranked'][number], 'delta' | 'name' | 'ban' | 'pro' | 'you'>('delta', (o, k) =>
    k === 'delta' ? o.winDelta : k === 'name' ? o.name : k === 'ban' ? o.banRate : k === 'pro' ? o.proBan : o.yourWinRate)

  return (
    <>
      <div className="panel row">
        <h2 style={{ margin: 0 }}>Map guide</h2>
        <select value={mapKey} onChange={(e) => setMapKey(e.target.value)} aria-label="Map">
          {maps.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
        </select>
        <Seg value={side} options={[{ v: 'attack', label: 'Attack' }, { v: 'defense', label: 'Defense' }]} onChange={setSide} />
        {g && <span className="small muted">Data {g.info.patch} · operators sorted by ranked win delta · hover an operator for details</span>}
      </div>

      {g && (
        <div className="grid-2">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
            {g.sites.map((s) => (
              <div className="panel" key={s.name}>
                <h2 style={{ marginBottom: 8 }}>
                  {s.name}
                  <span className="sub">{s.kind === 'upper' ? 'upper floor' : s.kind} · {s.source === 'research' ? `researched (confidence ${Math.round(s.confidence * 100)}%)` : s.source === 'curated' ? 'curated (thin data)' : 'no data'}</span>
                </h2>
                <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                  <span className="badge" style={{ color: 'var(--accent)' }}>S</span>
                  {s.S.length ? s.S.map((o) => <Op key={o.key} op={o} big />) : <span className="faint small">none</span>}
                </div>
                <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                  <span className="badge">A</span>
                  {s.A.length ? s.A.map((o) => <Op key={o.key} op={o} />) : <span className="faint small">none</span>}
                </div>
                <div className="row small" style={{ gap: 8 }}>
                  <span className="muted">Your picks:</span>
                  {s.picks.map((r) => <span key={r.operatorId} style={{ fontFamily: 'var(--head)', fontWeight: 700, textTransform: 'uppercase' }}>{r.name} <span className="faint">{r.score}%</span></span>)}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
            <BansPanel bans={g.bans} />
            <div className="panel">
              <h2>Strong on this map <SideTag side={side} /></h2>
              <div className="row" style={{ gap: 6 }}>{g.strong.length ? g.strong.map((o) => <Op key={o.key} op={o} />) : <span className="faint small">No map-level data</span>}</div>
            </div>

            <div className="panel">
              <h2>Pro bans on this map <span className="sub">{g.proGames ? `${g.proGames} pro games` : 'not in the pro map pool'}</span></h2>
              {g.proBans.length ? (
                <table>
                  <tbody>
                    {g.proBans.slice(0, 10).map((o) => (
                      <tr key={o.key}><td style={{ fontWeight: 600 }}>{o.name}</td><td><Bar value={o.proBan ?? 0} /> <span className="num small">{pct(o.proBan ?? 0)}</span></td></tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="faint small">No pro data for this map.</div>}
            </div>

            <div className="panel">
              <h2>Ranked meta <span className="sub">{g.info.rankedScope}</span></h2>
              <table>
                <thead><tr><H k="name" left>Operator</H><H k="delta" title="Official ranked win delta (Ubisoft, Plat+). Default sort; click any header to sort by it.">Win delta</H><H k="ban">Ban rate</H><H k="pro" title="Share of pro games on this map where it was banned">Pro ban</H><H k="you" title="Your win rate · rounds (Ubisoft, all seasons)">You</H></tr></thead>
                <tbody>
                  {sort(g.ranked).map((o) => (
                    <tr key={o.key}>
                      <td style={{ fontWeight: 600 }}>{o.name}</td>
                      <td className={`r num ${o.winDelta === null ? 'faint' : o.winDelta >= 0 ? 'w' : 'l'}`}>{o.winDelta === null ? '–' : signed(o.winDelta)}</td>
                      <td className="r num">{o.banRate === null ? '–' : pct(o.banRate)}</td>
                      <td className="r num">{o.proBan === null ? '–' : pct(o.proBan)}</td>
                      <td className="r num faint">{o.yourRounds ? `${pct(o.yourWinRate ?? 0)} · ${o.yourRounds}` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel small muted">
              <h2>Sources</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {g.info.sources.map((s) => <li key={s.url + s.name}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> · {s.detail}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
