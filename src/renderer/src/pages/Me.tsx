// Me: your rank, current session, match history and personal breakdowns in one place.
import { useState } from 'react'
import type { MatchRow, Performance } from '../../../shared/ipc'
import { mapName } from '../../../shared/catalog'
import { rankName } from '../../../shared/ranks'
import type { Side } from '../../../shared/types'
import { RankBadge, SideTag, pct, ratio, rs, useData, useSort } from '../lib'
import { winDelta } from './Stats'

const signedRp = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`
const signedPct = (d: number | null) => (d === null ? '–' : `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}%`)
const when = (iso: string) => {
  const d = new Date(iso), now = new Date()
  const day = d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === new Date(now.getTime() - 86_400_000).toDateString() ? 'Yesterday' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${day} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}
const resultClass = (r: MatchRow['result']) => (r === 'win' ? 'w' : r === 'loss' || r === 'abandon' ? 'l' : 'faint')
const resultLabel = (m: MatchRow) => (m.games ? `${m.games.wins}W ${m.games.losses + m.games.abandons}L` : m.result === 'win' ? 'Win' : m.result === 'loss' ? 'Loss' : m.result === 'abandon' ? 'Abandon' : m.result === 'draw' ? 'Draw' : '–')

function Stat({ label, value, cls, title }: { label: string; value: string; cls?: string; title?: string }) {
  return (
    <div title={title} style={{ minWidth: 70 }}>
      <div className={`num ${cls ?? ''}`} style={{ fontFamily: 'var(--head)', fontWeight: 700, fontSize: '1.6rem', lineHeight: 1.1 }}>{value}</div>
      <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  )
}

function RankCard({ p }: { p: Performance }) {
  const r = p.rank
  return (
    <div className="panel">
      <h2>Rank <span className="sub">{p.season} · ranked</span></h2>
      {!r ? <div className="empty">{p.loggedIn ? 'Your rank appears after the first check (within a minute of starting, then every 10 min while Siege runs).' : 'Sign in to Ubisoft in Settings to track your rank and RP.'}</div> : (
        <>
          <div className="row" style={{ gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: '1.25rem' }}><RankBadge rank={r.rank} /></span>
            <span className="num" style={{ fontFamily: 'var(--head)', fontWeight: 700, fontSize: '1.6rem' }}>{r.rankPoints} RP</span>
            <span className="small muted">Peak {rankName(r.maxRank)} · {r.maxRankPoints} RP</span>
          </div>
          <div className="row" style={{ gap: 22 }}>
            <Stat label="W – L" value={`${r.wins}–${r.losses}`} />
            <Stat label="Win %" value={pct(r.wins / Math.max(1, r.wins + r.losses))} />
            <Stat label="K/D" value={ratio(r.kills, r.deaths)} />
            {r.abandons > 0 && <Stat label="Abandons" value={String(r.abandons)} cls="l" />}
          </div>
          <RpChart points={p.rpHistory} />
          <div className="small faint">Checked {when(r.at)}</div>
        </>
      )}
    </div>
  )
}

/** RP over the season: one line, recessive grid, hover a point for details. */
function RpChart({ points }: { points: Performance['rpHistory'] }) {
  if (points.length < 2) return <div className="small muted" style={{ margin: '12px 0' }}>Your RP graph fills in as games are tracked.</div>
  const W = 600, H = 120, pad = 6
  const rps = points.map((x) => x.rp)
  const lo = Math.min(...rps), hi = Math.max(...rps), span = Math.max(20, hi - lo)
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad)
  const y = (rp: number) => H - pad - ((rp - lo) / span) * (H - 2 * pad)
  const d = points.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt.rp).toFixed(1)}`).join(' ')
  return (
    <div style={{ margin: '14px 0 6px' }}>
      <div className="row small faint" style={{ justifyContent: 'space-between' }}><span>{hi} RP</span><span>RP this season</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 120, display: 'block' }} role="img" aria-label={`RP from ${points[0]!.rp} to ${points[points.length - 1]!.rp}`}>
        <line x1={0} x2={W} y1={y(lo)} y2={y(lo)} stroke="var(--line)" strokeWidth={1} />
        <line x1={0} x2={W} y1={y(hi)} y2={y(hi)} stroke="var(--line)" strokeWidth={1} />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {points.map((pt, i) => (
          <g key={pt.at}>
            <circle cx={x(i)} cy={y(pt.rp)} r={10} fill="transparent"><title>{`${when(pt.at)} · ${pt.rp} RP · ${rankName(pt.rank)}`}</title></circle>
            <circle cx={x(i)} cy={y(pt.rp)} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} pointerEvents="none" />
          </g>
        ))}
      </svg>
      <div className="small faint">{lo} RP</div>
    </div>
  )
}

function SessionCard({ p }: { p: Performance }) {
  const s = p.session
  const form = p.matches.filter((m) => !m.games && m.result !== 'unknown').slice(0, 10)
  return (
    <div className="panel">
      <h2>{s?.active ? 'Current session' : 'Last session'} <span className="sub">{!s ? '' : s.start === s.end ? when(s.start) : `${when(s.start)} → ${new Date(s.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`}</span></h2>
      {!s ? <div className="empty">No games yet. Games show up here from your replays and from ranked results.</div> : (
        <>
          <div className="row" style={{ gap: 22, marginBottom: 12 }}>
            <Stat label="Games" value={String(s.matches)} />
            <Stat label="W – L" value={`${s.wins}–${s.losses}`} cls={s.wins > s.losses ? 'w' : s.losses > s.wins ? 'l' : ''} />
            {s.rpDelta !== null && <Stat label="RP" value={signedRp(s.rpDelta)} cls={s.rpDelta > 0 ? 'w' : s.rpDelta < 0 ? 'l' : ''} />}
            {s.rounds > 0 && <Stat label="Rounds won" value={pct(s.roundWins / s.rounds)} title={`${s.roundWins} of ${s.rounds} rounds (replays)`} />}
            {s.rounds > 0 && <Stat label="K/D" value={ratio(s.kills, s.deaths)} title={`${s.kills} kills, ${s.deaths} deaths (replays)`} />}
          </div>
          {s.ops.length > 0 && (
            <div className="row small" style={{ gap: 6 }}>
              <span className="muted">Played:</span>
              {s.ops.sort((a, b) => b.rounds - a.rounds).map((o) => <span key={o.opKey} className="opchip" title={`${o.wins} of ${o.rounds} rounds won`}>{o.name} <span className="faint" style={{ marginLeft: 4 }}>{o.wins}/{o.rounds}</span></span>)}
            </div>
          )}
        </>
      )}
      {form.length > 0 && (
        <div className="row small" style={{ gap: 4, marginTop: 12 }}>
          <span className="muted" style={{ marginRight: 4 }}>Last {form.length}:</span>
          {form.slice().reverse().map((m) => (
            <span key={m.id} title={`${when(m.at)} · ${m.mapKey ? mapName(m.mapKey) : m.kind} · ${resultLabel(m)}${m.rpDelta !== null ? ` · ${signedRp(m.rpDelta)} RP` : ''}`}
              style={{ width: 22, height: 22, display: 'inline-grid', placeItems: 'center', fontWeight: 700, background: m.result === 'win' ? 'color-mix(in srgb, var(--good) 25%, transparent)' : 'color-mix(in srgb, var(--bad) 25%, transparent)' }}>
              {m.result === 'win' ? 'W' : 'L'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function History({ matches }: { matches: MatchRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="panel">
      <h2>Match history <span className="sub">replays on this PC + ranked results · click a game for rounds</span></h2>
      {!matches.length ? <div className="empty">No games yet.</div> : (
        <table>
          <thead><tr><th>When</th><th>Mode</th><th>Map</th><th>Result</th><th className="r">Score</th><th className="r">RP</th><th className="r">K/D</th><th>Operators</th></tr></thead>
          <tbody>
            {matches.slice(0, 50).flatMap((m) => {
              const rows = [
                <tr key={m.id} onClick={() => m.rounds.length && setOpen(open === m.id ? null : m.id)} style={{ cursor: m.rounds.length ? 'pointer' : 'default', boxShadow: `inset 3px 0 0 ${m.result === 'win' ? 'var(--good)' : m.result === 'loss' || m.result === 'abandon' ? 'var(--bad)' : 'var(--line)'}` }}>
                  <td className="small">{when(m.at)}</td>
                  <td className="small muted">{m.kind}</td>
                  <td style={{ fontWeight: 600 }}>{m.mapKey ? mapName(m.mapKey) : <span className="faint">{m.games ? `${m.games.wins + m.games.losses + m.games.abandons} games` : 'Not recorded'}</span>}</td>
                  <td className={resultClass(m.result)}>{resultLabel(m)}</td>
                  <td className="r num">{m.score ? `${m.score[0]}–${m.score[1]}` : '–'}</td>
                  <td className={`r num ${m.rpDelta === null ? 'faint' : m.rpDelta > 0 ? 'w' : m.rpDelta < 0 ? 'l' : ''}`}>{m.rpDelta === null ? '–' : signedRp(m.rpDelta)}</td>
                  <td className="r num">{m.rounds.length ? `${m.kills}/${m.deaths}` : '–'}</td>
                  <td className="small">{m.ops.join(', ') || <span className="faint">–</span>}</td>
                </tr>
              ]
              if (open === m.id) rows.push(
                <tr key={`${m.id}-rounds`}><td colSpan={8} style={{ background: 'var(--bg)' }}>
                  <div className="row small" style={{ gap: 6 }}>
                    {m.rounds.map((r) => (
                      <span key={r.round} className="opchip" title={r.site} style={{ borderLeft: `3px solid ${r.won ? 'var(--good)' : 'var(--bad)'}` }}>
                        R{r.round} <SideTag side={r.side} /> {r.op} <span className="faint" style={{ marginLeft: 4 }}>{r.kills}K{r.died ? ' · died' : ''}</span>
                      </span>
                    ))}
                  </div>
                </td></tr>
              )
              return rows
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Breakdowns({ p }: { p: Performance }) {
  const sideRate = (s: Side) => (p.sides[s].rounds ? p.sides[s].wins / p.sides[s].rounds : null)
  const avg: Record<Side, number> = { attack: sideRate('attack') ?? 0.5, defense: sideRate('defense') ?? 0.5 }
  type Op = Performance['ops'][number]
  const opDelta = (o: Op) => winDelta(o.wins, o.rounds, avg[o.side])
  const ops = useSort<Op, 'delta' | 'name' | 'wr' | 'rounds'>('delta', (o, k) => (k === 'delta' ? opDelta(o) : k === 'name' ? o.name : k === 'wr' ? o.wins / o.rounds : o.rounds))
  const mapRounds = p.maps.reduce((n, m) => n + m.rounds, 0)
  const mapAvg = mapRounds ? p.maps.reduce((n, m) => n + m.roundWins, 0) / mapRounds : 0.5
  type M = Performance['maps'][number]
  const mapDelta = (m: M) => winDelta(m.roundWins, m.rounds, mapAvg)
  const maps = useSort<M, 'delta' | 'name' | 'games' | 'rounds'>('delta', (m, k) => (k === 'delta' ? mapDelta(m) : k === 'name' ? mapName(m.mapKey) : k === 'games' ? m.matches : m.rounds))
  const D = ({ d }: { d: number | null }) => <td className={`r num ${d === null ? 'faint' : d >= 0 ? 'w' : 'l'}`}>{signedPct(d)}</td>
  return (
    <>
      <div className="panel">
        <h2>Attack vs defense <span className="sub">{p.season} · all playlists (Ubisoft)</span></h2>
        {!p.sides.attack.rounds && !p.sides.defense.rounds ? <div className="empty">Sign in to Ubisoft to see your season split.</div> : (
          <div className="row" style={{ gap: 28 }}>
            {(['attack', 'defense'] as const).map((s) => (
              <div key={s} className="row" style={{ gap: 10 }}>
                <SideTag side={s} lg />
                <Stat label={`${p.sides[s].rounds} rounds`} value={pct(sideRate(s) ?? 0)} />
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="panel">
        <h2>Your operators <span className="sub">{p.season} · sorted by win delta vs your side average</span></h2>
        {!p.ops.length ? <div className="empty">No operator stats for this season yet.</div> : (
          <table>
            <thead><tr><ops.H k="name" left>Operator</ops.H><th>Side</th><ops.H k="delta">Δ win</ops.H><ops.H k="wr">Win %</ops.H><ops.H k="rounds">Rounds</ops.H></tr></thead>
            <tbody>{ops.sort(p.ops).slice(0, 15).map((o) => (
              <tr key={o.opKey}><td style={{ fontWeight: 600 }}>{o.name}</td><td><SideTag side={o.side} /></td><D d={opDelta(o)} /><td className="r num">{pct(o.wins / o.rounds)}</td><td className="r num">{o.rounds}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="panel">
        <h2>Your maps <span className="sub">round win rate from replays</span></h2>
        {!p.maps.length ? <div className="empty">Record matches with Match Replay on to see your maps.</div> : (
          <table>
            <thead><tr><maps.H k="name" left>Map</maps.H><maps.H k="delta">Δ win</maps.H><th className="r">Rounds won</th><maps.H k="games">Games</maps.H><maps.H k="rounds">Rounds</maps.H></tr></thead>
            <tbody>{maps.sort(p.maps).map((m) => (
              <tr key={m.mapKey}><td style={{ fontWeight: 600 }}>{mapName(m.mapKey)}</td><D d={mapDelta(m)} /><td className="r num">{pct(m.roundWins / m.rounds)}</td><td className="r num">{m.wins}–{m.matches - m.wins}</td><td className="r num">{m.rounds}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  )
}

export function MePage() {
  const [p, reload] = useData(() => rs().performance(), [])
  if (!p) return null
  return (
    <>
      <div className="panel row">
        <h2 style={{ margin: 0 }}>{p.me ? p.me.name : 'Me'}</h2>
        <span className="small muted">Your rank, sessions and games. Ranked games are picked up from your rank even without a replay.</span>
        <div className="spacer" />
        <button className="btn" onClick={() => void rs().exportCsv()} disabled={!p.matches.length}>Export CSV</button>
        <button className="btn" onClick={reload}>Refresh</button>
      </div>
      <div className="grid-2">
        <RankCard p={p} />
        <SessionCard p={p} />
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <History matches={p.matches} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}><Breakdowns p={p} /></div>
      </div>
    </>
  )
}
