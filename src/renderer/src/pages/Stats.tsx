// Operators (your stats) and Meta (everyone in your replays) pages share the filter bar.
import { useState } from 'react'
import { allMaps } from '../../../shared/catalog'
import { pickerMaps } from '../../../shared/data/sitePicks'
import type { Side } from '../../../shared/types'
import { BANDS } from '../../../shared/crowd'
import { Bar, Seg, SideTag, pct, ratio, rs, useData, useSort } from '../lib'

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
        {pickerMaps(allMaps()).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
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

/** Win-rate delta vs the side average, shrunk toward it (≈20 rounds) so tiny samples don't top lists. */
export const winDelta = (wins: number, rounds: number, avg: number): number | null => (rounds ? (wins + avg * 20) / (rounds + 20) - avg : null)
const sideAvgs = (rows: { side: Side; wins: number; rounds: number }[]): Record<Side, number> => {
  const avg = (s: Side) => { const r = rows.filter((x) => x.side === s); const n = r.reduce((a, x) => a + x.rounds, 0); return n ? r.reduce((a, x) => a + x.wins, 0) / n : 0.5 }
  return { attack: avg('attack'), defense: avg('defense') }
}
const DELTA_TIP = 'Win rate compared with the average on that side (small samples discounted). Default sort; click any header to sort by it.'
function DeltaCell({ d }: { d: number | null }) {
  return <td className={`r num ${d === null ? 'faint' : d >= 0 ? 'w' : 'l'}`}>{d === null ? '–' : `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%`}</td>
}

/** Ubisoft Career stats table: works without replays, covers every PC/game, no map/site detail. */
function UbisoftOps({ who }: { who: 'me' | 'others' }) {
  const [season, setSeason] = useState('all')
  const [playlist, setPlaylist] = useState('')
  const [side, setSide] = useState<Side | ''>('')
  const [data] = useData(() => rs().apiOps({ who, season, playlist: playlist || undefined }), [who, season, playlist])
  const avgs = sideAvgs(data?.rows ?? [])
  type Row = NonNullable<typeof data>['rows'][number]
  const delta = (r: { side: Side; wins: number; rounds: number }) => winDelta(r.wins, r.rounds, avgs[r.side])
  const sideTotal = (s: Side) => (data?.rows ?? []).filter((r) => r.side === s).reduce((n, r) => n + r.rounds, 0)
  const pickOf = (r: Row) => Math.min(1, (r.rounds * 5) / Math.max(1, sideTotal(r.side)))
  const { sort, H } = useSort<Row, 'delta' | 'name' | 'side' | 'wr' | 'rounds' | 'pick' | 'players'>('delta', (r, k) =>
    k === 'delta' ? delta(r) : k === 'name' ? r.name : k === 'side' ? r.side : k === 'wr' ? r.wins / r.rounds : k === 'rounds' ? r.rounds : k === 'pick' ? pickOf(r) : r.players)
  const rows = sort((data?.rows ?? []).filter((r) => !side || r.side === side))
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
            <thead><tr><H k="name" left>Operator</H><H k="side" left>Side</H><H k="delta" title={DELTA_TIP}>Δ win</H><H k="wr">Win %</H><H k="rounds">Rounds</H>{who === 'others' && <H k="pick" left>Pick rate</H>}{who === 'others' && <H k="players">Players</H>}</tr></thead>
            <tbody>
              {rows.map((r) => {
                const pick = pickOf(r)
                return (
                  <tr key={r.opKey}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td><td><SideTag side={r.side} /></td>
                    <DeltaCell d={delta(r)} />
                    <td className="r num">{pct(r.wins / r.rounds)}</td>
                    <td className="r num">{r.rounds}</td>
                    {who === 'others' && <td><Bar value={pick} /> <span className="num small">{pct(pick)}</span></td>}
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

type SortKey = 'delta' | 'name' | 'side' | 'rounds' | 'wr' | 'kd' | 'kpr' | 'hs'

export function OperatorsPage() {
  const [f, setF] = useState<Filters>({ mapKey: '', site: '', side: '', season: '' })
  const [mine, setMine] = useState(true)
  const [rows] = useData(() => rs().opStats({ mine, mapKey: f.mapKey || undefined, site: f.site || undefined, side: f.side || undefined, season: f.season || undefined }), [mine, f])
  const avgs = sideAvgs((rows ?? []).map((r) => ({ side: r.side, wins: r.agg.wins, rounds: r.agg.rounds })))
  const deltaOf = (r: { side: Side; agg: { wins: number; rounds: number } }) => winDelta(r.agg.wins, r.agg.rounds, avgs[r.side])
  const { sort, H } = useSort<NonNullable<typeof rows>[number], SortKey>('delta', (r, k) => {
    const a = r.agg
    return k === 'delta' ? deltaOf(r) : k === 'name' ? r.name : k === 'side' ? r.side : k === 'rounds' ? a.rounds : k === 'wr' ? a.wins / Math.max(1, a.rounds) : k === 'kd' ? a.kills / Math.max(1, a.deaths) : k === 'kpr' ? a.kills / Math.max(1, a.rounds) : a.kills ? a.headshots / a.kills : null
  })
  const sorted = sort(rows ?? [])
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
            <thead><tr><H k="name" left>Operator</H><H k="side" left>Side</H><H k="delta" title={DELTA_TIP}>Δ win</H><H k="wr">Win %</H><H k="rounds">Rounds</H><H k="kd">K/D</H><H k="kpr">Kills/rd</H><H k="hs">HS %</H></tr></thead>
            <tbody>
              {sorted.map(({ operatorId, name, side, agg }) => (
                <tr key={operatorId}>
                  <td style={{ fontWeight: 600 }}>{name}</td>
                  <td><SideTag side={side} /></td>
                  <DeltaCell d={deltaOf({ side, agg })} />
                  <td className="r num">{pct(agg.wins / agg.rounds)}</td>
                  <td className="r num">{agg.rounds}</td>
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

function GlobalMetaView() {
  const [band, setBand] = useState('')
  const [mapKey, setMapKey] = useState('')
  const [site, setSite] = useState('')
  const [side, setSide] = useState<Side | ''>('')
  const [busy, setBusy] = useState(false)
  const [g, reload] = useData(() => rs().globalMeta({ band: band === '' ? undefined : Number(band), mapKey: mapKey || undefined, site: site || undefined }), [band, mapKey, site])
  type Row = NonNullable<typeof g>['rows'][number]
  const all = g?.rows ?? []
  const avgs = sideAvgs(all)
  const delta = (r: Row) => winDelta(r.wins, r.rounds, avgs[r.side])
  const sideTotal = (s: Side) => all.filter((r) => r.side === s).reduce((n, r) => n + r.rounds, 0)
  const pickOf = (r: Row) => Math.min(1, (r.rounds * 5) / Math.max(1, sideTotal(r.side)))
  const { sort, H } = useSort<Row, 'delta' | 'name' | 'side' | 'wr' | 'rounds' | 'pick' | 'players'>('delta', (r, k) =>
    k === 'delta' ? delta(r) : k === 'name' ? r.name : k === 'side' ? r.side : k === 'wr' ? r.wins / r.rounds : k === 'rounds' ? r.rounds : k === 'pick' ? pickOf(r) : r.players)
  const rows = sort(all.filter((r) => !side || r.side === side))
  const refresh = async () => { setBusy(true); try { await rs().refreshGlobal() } finally { setBusy(false); reload() } }
  const career = g?.scope !== 'replays'
  return (
    <>
      <p className="muted small" style={{ margin: 0 }}>
        Combined from every RainbwStats user who shares. All maps: ranked operator stats this season of every player in their lobbies (by rank band).
        Pick a map for per-site data from replays. Updated every 3 hours.
      </p>
      {g && !g.sharing && <div className="panel small">You're not sharing yet. Turn on <b>Settings → Global database</b> to add your lobbies (no names are sent).</div>}
      <div className="panel row">
        <select value={band} onChange={(e) => setBand(e.target.value)} disabled={!career} aria-label="Rank band">
          <option value="">All ranks</option>
          {BANDS.map((b, i) => <option key={b} value={i}>{b}{g?.yourBand === i ? ' (you)' : ''}</option>)}
        </select>
        <select value={mapKey} onChange={(e) => { setMapKey(e.target.value); setSite('') }} aria-label="Map">
          <option value="">All maps</option>
          {pickerMaps(allMaps()).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
        </select>
        <select value={site} onChange={(e) => setSite(e.target.value)} disabled={!g?.sites.length} aria-label="Site">
          <option value="">All sites</option>
          {g?.sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Seg value={side} options={[{ v: '', label: 'Both' }, { v: 'attack', label: 'Attack' }, { v: 'defense', label: 'Defense' }]} onChange={setSide} />
        <button className="btn" onClick={() => void refresh()} disabled={busy}>{busy ? 'Syncing…' : 'Refresh'}</button>
        <span className="small muted">
          {g?.season} · {career ? `${g?.players ?? 0} players` : `${g?.rounds ?? 0} player-rounds`}
          {g?.generatedAt ? ` · updated ${new Date(g.generatedAt).toLocaleString()}` : ''}
          {g?.lastUpload ? ` · you shared ${g.lastUpload.ops + g.lastUpload.rounds} rows` : ''}
          {g?.lastError ? ` · ${g.lastError}` : ''}
        </span>
      </div>
      <div className="panel">
        {!rows.length ? <div className="empty">{g?.available ? 'No global data for this filter yet. It grows as people share.' : 'Global data not downloaded yet. Check your connection and press Refresh.'}</div> : (
          <table>
            <thead><tr><H k="name" left>Operator</H><H k="side" left>Side</H><H k="delta" title={DELTA_TIP}>Δ win</H><H k="wr">Win %</H><H k="rounds">Rounds</H><H k="pick" left>Pick rate</H>{career && <H k="players">Players</H>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.opKey}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td><td><SideTag side={r.side} /></td>
                  <DeltaCell d={delta(r)} />
                  <td className="r num">{pct(r.wins / r.rounds)}</td>
                  <td className="r num">{r.rounds}</td>
                  <td><Bar value={pickOf(r)} /> <span className="num small">{pct(pickOf(r))}</span></td>
                  {career && <td className="r num">{r.players}</td>}
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
  const [source, setSource] = useState<Source | 'global'>('global')
  return (
    <>
      <div className="panel row">
        <h2 style={{ margin: 0 }}>Operator meta</h2>
        <Seg value={source} options={[{ v: 'global', label: 'Global (all users)' }, { v: 'ubisoft', label: 'Players I\'ve met' }, { v: 'replays', label: 'My replays (map & site)' }]} onChange={setSource} />
      </div>
      {source === 'global' ? <GlobalMetaView /> : source === 'ubisoft' ? (
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
  const avg = total ? measured.reduce((n, r) => n + r.winRate * r.rounds, 0) / total : 0.5
  type Row = NonNullable<typeof rows>[number]
  const deltaOf = (r: Row) => (r.source === 'replays' ? winDelta(r.winRate * r.rounds, r.rounds, avg) : null)
  const measuredOnly = (r: Row, v: number) => (r.source === 'replays' ? v : null)
  const { sort, H } = useSort<Row, 'delta' | 'name' | 'rounds' | 'pick' | 'wr' | 'source'>('delta', (r, k) =>
    k === 'delta' ? deltaOf(r) : k === 'name' ? r.name : k === 'rounds' ? measuredOnly(r, r.rounds) : k === 'pick' ? measuredOnly(r, r.pickRate) : k === 'wr' ? measuredOnly(r, r.winRate) : r.source === 'replays' ? 1 + r.rounds : r.winRate)
  const sorted = sort(rows ?? [])
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
          <thead><tr><H k="name" left>Operator</H><H k="delta" title={DELTA_TIP}>Δ win</H><H k="rounds">Rounds</H><H k="pick" left>Pick rate</H><H k="wr">Win %</H><H k="source" left>Source</H></tr></thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.operatorId}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <DeltaCell d={deltaOf(r)} />
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
