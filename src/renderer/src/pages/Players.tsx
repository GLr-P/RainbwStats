import { useState } from 'react'
import type { PlayerLookup } from '../../../shared/ipc'
import { seasonIdToCode } from '../../../shared/ranks'
import { RankBadge, pct, ratio, rs } from '../lib'

export function PlayersPage() {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<PlayerLookup | null>(null)
  const search = async () => {
    if (!q.trim()) return
    setBusy(true)
    setRes(await rs().lookupPlayer(q.trim()))
    setBusy(false)
  }
  const c = res?.card
  const se = c?.season
  const games = se ? se.wins + se.losses : 0
  return (
    <>
      <form className="panel row" onSubmit={(e) => { e.preventDefault(); void search() }}>
        <h2 style={{ margin: 0 }}>Player lookup</h2>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ubisoft username" aria-label="Ubisoft username" autoFocus />
        <button className="btn primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
        {res?.error && <span className="warn small">{res.error}</span>}
      </form>
      {c && (
        <div className="panel">
          <div className="row" style={{ alignItems: 'baseline' }}>
            <div className="live-head"><div className="map" style={{ fontSize: '2rem' }}>{c.name || q}</div></div>
            {c.ranked && <RankBadge rank={c.ranked.rank} rp={c.ranked.rankPoints} />}
            {c.ranked && <span className="muted">peak <RankBadge rank={c.ranked.maxRank} rp={c.ranked.maxRankPoints} /></span>}
          </div>
          <table style={{ marginTop: 12, maxWidth: 640 }}>
            <tbody>
              <tr><td className="muted">Level</td><td className="num">{c.level ?? '–'}</td><td className="muted">PvP hours</td><td className="num">{c.hoursPlayed ?? '–'}</td></tr>
              <tr><td className="muted">Season K/D</td><td className="num">{se ? ratio(se.kills, se.deaths) : '–'}</td><td className="muted">Season win %</td><td className="num">{games ? `${pct(se!.wins / games)} (${se!.wins}–${se!.losses})` : '–'}</td></tr>
              <tr><td className="muted">Matches with you</td><td className="num">{res?.encounters ?? 0}</td><td className="muted">Abandons</td><td className="num">{se?.abandons ?? '–'}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {res && res.pastRanks.length > 0 && (
        <div className="panel">
          <h2>Past seasons <span className="sub">rank at the end of each season (Ubisoft)</span></h2>
          <div className="row" style={{ gap: 6 }}>
            {res.pastRanks.map((r) => <span key={r.season} className="opchip">{r.season} <span style={{ marginLeft: 6 }}><RankBadge rank={r.rank} /></span></span>)}
          </div>
        </div>
      )}
      {res && res.history.length > 0 && (
        <div className="panel">
          <h2>Rank history <span className="sub">builds up every time this player is looked up or seen in your lobby</span></h2>
          <table>
            <thead><tr><th>Season</th><th>Board</th><th>Rank</th><th>Peak</th><th className="r">W–L</th><th className="r">K/D</th></tr></thead>
            <tbody>
              {res.history.map((h) => (
                <tr key={`${h.seasonId}-${h.board}`}>
                  <td>{seasonIdToCode(h.seasonId)}</td><td>{h.board}</td>
                  <td><RankBadge rank={h.rank} rp={h.rankPoints} /></td><td><RankBadge rank={h.maxRank} rp={h.maxRankPoints} /></td>
                  <td className="r num">{h.wins}–{h.losses}</td><td className="r num">{ratio(h.kills, h.deaths)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
