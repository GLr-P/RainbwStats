// Operators (your stats) and Meta (everyone in your replays) pages share the filter bar.
import { useState } from 'react'
import { allMaps } from '../../../shared/catalog'
import type { Side } from '../../../shared/types'
import { Bar, Seg, SideTag, pct, ratio, rs, useData } from '../lib'

interface Filters { mapKey: string; site: string; side: Side | ''; season: string }

function FilterBar({ f, set, sideRequired }: { f: Filters; set: (f: Filters) => void; sideRequired?: boolean }) {
  const [sites] = useData(() => (f.mapKey ? rs().sites(f.mapKey) : Promise.resolve([])), [f.mapKey])
  const [seasons] = useData(() => rs().seasons(), [])
  const sides = [...(sideRequired ? [] : [{ v: '' as const, label: 'Both' }]), { v: 'attack' as const, label: 'Attack' }, { v: 'defense' as const, label: 'Defense' }]
  return (
    <div className="panel row">
      <select value={f.season} onChange={(e) => set({ ...f, season: e.target.value })} aria-label="Season">
        <option value="">All seasons</option>
        {seasons?.map((s) => <option key={s}>{s}</option>)}
      </select>
      <select value={f.mapKey} onChange={(e) => set({ ...f, mapKey: e.target.value, site: '' })} aria-label="Map">
        <option value="">All maps</option>
        {allMaps().map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
      </select>
      <select value={f.site} onChange={(e) => set({ ...f, site: e.target.value })} disabled={!sites?.length} aria-label="Site">
        <option value="">All sites</option>
        {sites?.map((s) => <option key={s.site} value={s.site}>{s.site} ({s.rounds})</option>)}
      </select>
      <Seg value={f.side} options={sides} onChange={(v) => set({ ...f, side: v })} />
    </div>
  )
}

type SortKey = 'rounds' | 'wr' | 'kd' | 'kpr' | 'hs'

export function OperatorsPage() {
  const [f, setF] = useState<Filters>({ mapKey: '', site: '', side: '', season: '' })
  const [mine, setMine] = useState(true)
  const [sort, setSort] = useState<SortKey>('rounds')
  const [rows] = useData(() => rs().opStats({ mine, mapKey: f.mapKey || undefined, site: f.site || undefined, side: f.side || undefined, season: f.season || undefined }), [mine, f])
  const val = (a: { rounds: number; wins: number; kills: number; deaths: number; headshots: number }, k: SortKey) =>
    k === 'rounds' ? a.rounds : k === 'wr' ? a.wins / Math.max(1, a.rounds) : k === 'kd' ? a.kills / Math.max(1, a.deaths) : k === 'kpr' ? a.kills / Math.max(1, a.rounds) : a.headshots / Math.max(1, a.kills)
  const sorted = (rows ?? []).slice().sort((a, b) => val(b.agg, sort) - val(a.agg, sort))
  const H = ({ k, children }: { k: SortKey; children: string }) => <th className={`r sort${sort === k ? ' sorted' : ''}`} onClick={() => setSort(k)}>{children}</th>
  return (
    <>
      <div className="panel row">
        <h2 style={{ margin: 0 }}>Operator stats</h2>
        <Seg value={mine ? 'me' : 'all'} options={[{ v: 'me', label: 'Me' }, { v: 'all', label: 'Everyone in my replays' }]} onChange={(v) => setMine(v === 'me')} />
      </div>
      <FilterBar f={f} set={setF} />
      <div className="panel">
        {!sorted.length ? <div className="empty">No rounds match these filters yet. Play with Match Replay enabled and they'll appear here.</div> : (
          <table>
            <thead><tr><th>Operator</th><th>Side</th><H k="rounds">Rounds</H><H k="wr">Win %</H><H k="kd">K/D</H><H k="kpr">Kills/rd</H><H k="hs">HS %</H></tr></thead>
            <tbody>
              {sorted.map(({ operatorId, name, side, agg }) => (
                <tr key={operatorId}>
                  <td style={{ fontWeight: 600 }}>{name}</td>
                  <td><SideTag side={side} /></td>
                  <td className="r num">{agg.rounds}</td>
                  <td className="r num">{pct(agg.wins / agg.rounds)}</td>
                  <td className="r num">{ratio(agg.kills, agg.deaths)}</td>
                  <td className="r num">{(agg.kills / agg.rounds).toFixed(2)}</td>
                  <td className="r num">{agg.kills ? pct(agg.headshots / agg.kills) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

export function MetaPage() {
  const [f, setF] = useState<Filters>({ mapKey: '', site: '', side: 'attack', season: '' })
  const [rows] = useData(() => rs().meta({ mapKey: f.mapKey || undefined, site: f.site || undefined, side: (f.side || 'attack') as Side, season: f.season || undefined }), [f])
  const measured = rows?.filter((r) => r.source === 'replays') ?? []
  const total = measured.reduce((n, r) => n + r.rounds, 0)
  return (
    <>
      <div className="panel">
        <h2>Operator meta</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Pick and win rates for every player in your recorded matches (all 10 per round, {total} player-rounds for this filter).
          Rows marked <em>baseline</em> have no replay data yet and show a curated prior strength instead of a measured win rate.
          A global, all-users database is planned (PLAN.md Phase 8).
        </p>
      </div>
      <FilterBar f={f} set={setF} sideRequired />
      <div className="panel">
        <table>
          <thead><tr><th>Operator</th><th className="r">Rounds</th><th>Pick rate</th><th className="r">Win %</th><th>Source</th></tr></thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.operatorId}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td className="r num">{r.rounds || '–'}</td>
                <td>{r.source === 'replays' ? <><Bar value={r.pickRate} /> <span className="num small">{pct(r.pickRate)}</span></> : <span className="faint">–</span>}</td>
                <td className="r num">{r.source === 'replays' ? pct(r.winRate) : <span className="faint">–</span>}</td>
                <td className="small">{r.source === 'replays' ? (r.rounds < 20 ? <span className="warn">low sample</span> : 'replays') : <span className="faint">baseline strength {Math.round(r.winRate * 100)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
