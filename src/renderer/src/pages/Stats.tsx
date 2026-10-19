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

type Source = 'replays' | 'ubisoft'

/** Ubisoft Career stats table: works without replays, covers every PC/game, no map/site detail. */
function UbisoftOps({ who }: { who: 'me' | 'others' }) {
  const [season, setSeason] = useState('all')
  const [playlist, setPlaylist] = useState('')
  const [side, setSide] = useState<Side | ''>('')
  const [data] = useData(() => rs().apiOps({ who, season, playlist: playlist || undefined }), [who, season, playlist])
  const rows = (data?.rows ?? []).filter((r) => !side || r.side === side)
  const sideTotal = (s: Side) => (data?.rows ?? []).filter((r) => r.side === s).reduce((n, r) => n + r.rounds, 0)
  return (
    <>
      <div className="panel row">
        <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="Season">
          {(data?.seasons ?? ['all']).map((s) => <option key={s} value={s}>{s === 'all' ? 'All seasons' : s}{s === data?.current ? ' (current)' : ''}</option>)}
        </select>
        <select value={playlist} onChange={(e) => setPlaylist(e.target.value)} aria-label="Playlist">
          <option value="">All playlists</option><option value="ranked">Ranked</option><option value="unranked">Unranked</option><option value="quick">Quick match</option>
        </select>
        <Seg value={side} options={[{ v: '', label: 'Both' }, { v: 'attack', label: 'Attack' }, { v: 'defense', label: 'Defense' }]} onChange={setSide} />
        <span className="small muted">{who === 'others' ? `${data?.players ?? 0} players you've met` : 'All your games, from Ubisoft'}{data?.lastError ? ` · sync error: ${data.lastError}` : ''}</span>
      </div>
      <div className="panel">
        {!rows.length ? <div className="empty">{who === 'me' ? 'No Ubisoft stats yet. Sign in under Settings and they sync automatically (all seasons).' : 'No players synced yet. Each match adds everyone in your lobby.'}</div> : (
          <table>
            <thead><tr><th>Operator</th><th>Side</th><th className="r">Rounds</th>{who === 'others' && <th>Pick rate</th>}<th className="r">Win %</th>{who === 'others' && <th className="r">Players</th>}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const pick = Math.min(1, (r.rounds * 5) / Math.max(1, sideTotal(r.side)))
                return (
                  <tr key={r.opKey}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td><td><SideTag side={r.side} /></td>
                    <td className="r num">{r.rounds}</td>
                    {who === 'others' && <td><Bar value={pick} /> <span className="num small">{pct(pick)}</span></td>}
                    <td className="r num">{pct(r.wins / r.rounds)}</td>
                    {who === 'others' && <td className="r num">{r.players}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
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
  const [source, setSource] = useState<Source>('ubisoft')
  return (
    <>
      <div className="panel row">
        <h2 style={{ margin: 0 }}>Operator stats</h2>
        <Seg value={source} options={[{ v: 'ubisoft', label: 'All my games (Ubisoft)' }, { v: 'replays', label: 'Replays (map & site detail)' }]} onChange={setSource} />
        {source === 'replays' && <Seg value={mine ? 'me' : 'all'} options={[{ v: 'me', label: 'Me' }, { v: 'all', label: 'Everyone in my replays' }]} onChange={(v) => setMine(v === 'me')} />}
      </div>
      {source === 'ubisoft' ? <UbisoftOps who="me" /> : <>
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
      </>}
    </>
  )
}

export function MetaPage() {
  const [source, setSource] = useState<Source>('ubisoft')
  return (
    <>
      <div className="panel row">
        <h2 style={{ margin: 0 }}>Operator meta</h2>
        <Seg value={source} options={[{ v: 'ubisoft', label: 'Players I\'ve met (Ubisoft, per season)' }, { v: 'replays', label: 'Replays (by map & site)' }]} onChange={setSource} />
      </div>
      {source === 'ubisoft' ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>Every match adds the full operator history of all 10 players in your lobby, straight from Ubisoft. Grows fast, but has no map or site detail.</p>
          <UbisoftOps who="others" />
        </>
      ) : <ReplayMeta />}
    </>
  )
}

function ReplayMeta() {
  const [f, setF] = useState<Filters>({ mapKey: '', site: '', side: 'attack', season: '' })
  const [rows] = useData(() => rs().meta({ mapKey: f.mapKey || undefined, site: f.site || undefined, side: (f.side || 'attack') as Side, season: f.season || undefined }), [f])
  const measured = rows?.filter((r) => r.source === 'replays') ?? []
  const total = measured.reduce((n, r) => n + r.rounds, 0)
  return (
    <>
      <div className="panel">
        <h2>Replay meta</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Pick and win rates for every player in your recorded matches (all 10 per round, {total} player-rounds for this filter).
          Rows marked <em>baseline</em> have no replay data yet and show a curated prior strength instead of a measured win rate.
          These have map &amp; site detail but only grow with your recorded matches.
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
