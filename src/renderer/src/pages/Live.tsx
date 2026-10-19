import { useState } from 'react'
import type { AppStatus, LivePlayer, LiveState, Recommendation, Settings } from '../../../shared/ipc'
import { allMaps, mapName } from '../../../shared/catalog'
import type { Side } from '../../../shared/types'
import { OpChip, RankBadge, Meter, SideTag, Seg, pct, ratio, rs, useData } from '../lib'

export function LivePage({ live, settings, status }: { live: LiveState | null; settings: Settings; status: AppStatus | undefined }) {
  const [preview, setPreview] = useState<LiveState | null>(null)
  if (!live) return null
  const inMatch = live.phase === 'match' || live.phase === 'loading' || (live.phase === 'ended' && live.matchId)
  const s = inMatch ? live : preview ?? live
  const p = settings.panels

  return (
    <>
      {inMatch || preview ? <Header s={s} /> : <Waiting live={live} status={status} />}
      {!inMatch && <PreviewPicker onPreview={setPreview} active={!!preview} />}
      {(inMatch || preview) && (
        <>
          <div className="grid-2">
            <div className="row" style={{ alignItems: 'stretch', flexDirection: 'column', gap: 'var(--gap)' }}>
              {p.recommendations && <Picks s={s} />}
              {p.siteBreakdown && s.siteRecs.length > 0 && <SiteBreakdown s={s} />}
            </div>
            {p.teams && inMatch && <Teams s={s} />}
          </div>
          {p.timeline && inMatch && s.rounds.length > 0 && <Timeline s={s} />}
        </>
      )}
    </>
  )
}

function Header({ s }: { s: LiveState }) {
  const phase = s.phase === 'ended' ? 'Match ended' : s.phase === 'loading' ? 'Round 1' : `Round ${s.nextRound}`
  return (
    <div className="panel live-head">
      <div className="map">{s.mapKey ? mapName(s.mapKey) : 'Unknown map'}</div>
      {s.phase !== 'ended' && <SideTag side={s.side} lg />}
      {s.site && <div className="meta">{s.site}</div>}
      <div className="meta">{phase}</div>
      {s.rounds.length > 0 && (
        <div className="score num"><span className="w">{s.score[0]}</span><span className="faint"> – </span><span className="l">{s.score[1]}</span></div>
      )}
      <div className="spacer" />
      {s.source === 'preview' ? <span className="badge">Preview</span> : s.phase !== 'ended' ? <span className="badge live">● Live · {s.source}</span> : <span className="badge">Last match</span>}
      {s.rounds.length > 0 && s.phase !== 'ended' && <span className="badge" title="Next side is predicted from the round format">next side predicted</span>}
    </div>
  )
}

function Picks({ s }: { s: LiveState }) {
  const where = s.site ? 'this site' : s.mapKey ? mapName(s.mapKey) : 'overall'
  return (
    <div className="panel">
      <h2>{s.phase === 'ended' ? 'Picks for this map' : 'Your picks'} <SideTag side={s.side} /> <span className="sub">{where} · from your roster</span></h2>
      {s.recommendations.length === 0 ? <div className="empty">No operators in your roster for this side. Open Roster to choose some.</div> : (
        <div className="picks">
          {s.recommendations.map((r, i) => <Pick key={r.operatorId} r={r} i={i} />)}
        </div>
      )}
    </div>
  )
}

function Pick({ r, i }: { r: Recommendation; i: number }) {
  return (
    <div className="pick">
      <div className="rank">{i + 1}</div>
      <div className="name">{r.name}</div>
      <div className="score num" title="Fit score 0–100">{r.score}</div>
      <Meter value={r.score} />
      <div className="why">{r.reasons.map((x) => <span key={x}>{x}</span>)}</div>
    </div>
  )
}

function SiteBreakdown({ s }: { s: LiveState }) {
  return (
    <div className="panel">
      <h2>By site <span className="sub">top picks per bomb site (sites learned from your replays)</span></h2>
      <div className="sites">
        {s.siteRecs.map((x) => (
          <div className="site" key={x.site}>
            <div className="t" title={x.site}>{x.site}</div>
            <ol>{x.recs.map((r) => <li key={r.operatorId}>{r.name}<span>{r.score}</span></li>)}</ol>
          </div>
        ))}
      </div>
    </div>
  )
}

function Teams({ s }: { s: LiveState }) {
  return (
    <div className="panel">
      <h2>Lobby {s.lobbyError && <span className="sub warn">{s.lobbyError}</span>}</h2>
      <TeamTable title="Your team" players={s.myTeam} />
      <div style={{ height: 10 }} />
      <TeamTable title="Enemy team" players={s.enemyTeam} />
    </div>
  )
}

function TeamTable({ title, players }: { title: string; players: LivePlayer[] }) {
  return (
    <>
      <div className="team-h"><h3 style={{ fontSize: '0.95rem' }}>{title}</h3></div>
      <table>
        <thead><tr><th>Player</th><th>Rank</th><th className="r">Peak</th><th className="r">K/D</th><th className="r">Win %</th><th className="r">Lvl</th><th>This match</th></tr></thead>
        <tbody>
          {players.map((p) => {
            const c = p.card
            const se = c?.season
            const games = se ? se.wins + se.losses : 0
            return (
              <tr key={p.profileId} className={p.isMe ? 'me' : ''}>
                <td style={{ fontWeight: 600 }}>{p.name}</td>
                <td>{c?.ranked ? <RankBadge rank={c.ranked.rank} rp={c.ranked.rankPoints} /> : <span className="faint">{c?.loaded === false ? '–' : '…'}</span>}</td>
                <td className="r num faint">{c?.ranked ? c.ranked.maxRankPoints : ''}</td>
                <td className="r num">{se ? ratio(se.kills, se.deaths) : '–'}</td>
                <td className="r num">{games ? pct(se!.wins / games) : '–'}</td>
                <td className="r num">{c?.level ?? '–'}</td>
                <td><div className="opchips">{p.ops.map((o) => <OpChip key={o.round} id={o.operatorId} title={`R${o.round} ${o.won ? 'won' : 'lost'}`} />)}</div></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function Timeline({ s }: { s: LiveState }) {
  return (
    <div className="panel">
      <h2>Rounds</h2>
      <div className="timeline">
        {s.rounds.map((r) => (
          <div key={r.round} className={`rnd ${r.side ?? ''}`}>
            <div className="h"><span>R{r.round} {r.side === 'attack' ? 'ATK' : r.side === 'defense' ? 'DEF' : ''}</span><span className={r.won ? 'w' : 'l'}>{r.won ? 'W' : 'L'}</span></div>
            <div className="s" title={r.site}>{r.site || '—'}</div>
            {r.myOp && <OpChip id={r.myOp} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function Waiting({ live, status }: { live: LiveState; status: AppStatus | undefined }) {
  const st = status
  const Item = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => <li><span className={ok ? 'ok' : 'no'}>{ok ? '✓' : '✗'}</span><span>{children}</span></li>
  return (
    <div className="panel">
      <div className="waiting">{live.gameRunning ? 'Siege is running · waiting for a match' : 'Waiting for Siege'}</div>
      <p className="muted">This page fills in automatically when a match starts. Leave it open on your second screen.</p>
      {st && (
        <ul className="checklist">
          <Item ok={st.replayRootExists}>Replay folder {st.replayRoot ? <code className="faint">{st.replayRoot}</code> : 'not found: set your game folder in Settings'}</Item>
          <Item ok={st.rounds > 0}>{st.rounds > 0 ? `${st.rounds} rounds from ${st.matches} matches recorded` : 'No replays yet: enable Options → General → Match Replay in Siege'}</Item>
          <Item ok={st.loggedIn}>{st.loggedIn ? 'Ubisoft account connected (lobby ranks)' : 'Log in to Ubisoft in Settings for lobby ranks (optional)'}</Item>
          <Item ok={live.gameRunning}>{live.gameRunning ? 'Game detected' : 'Game not running'}</Item>
        </ul>
      )}
    </div>
  )
}

function PreviewPicker({ onPreview, active }: { onPreview: (s: LiveState | null) => void; active: boolean }) {
  const [map, setMap] = useState('')
  const [side, setSide] = useState<Side>('attack')
  const [site, setSite] = useState('')
  const [sites] = useData(() => (map ? rs().sites(map) : Promise.resolve([])), [map])
  const run = async (m = map, sd = side, st = site) => onPreview(m ? await rs().preview(m, sd, st || null) : null)
  return (
    <div className="panel row">
      <h2 style={{ margin: 0 }}>Preview</h2>
      <select value={map} onChange={(e) => { setMap(e.target.value); setSite(''); void run(e.target.value, side, '') }} aria-label="Map">
        <option value="">Pick a map…</option>
        {allMaps().map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
      </select>
      <Seg value={side} options={[{ v: 'attack', label: 'Attack' }, { v: 'defense', label: 'Defense' }]} onChange={(v) => { setSide(v); void run(map, v, site) }} />
      <select value={site} onChange={(e) => { setSite(e.target.value); void run(map, side, e.target.value) }} aria-label="Site" disabled={!sites?.length}>
        <option value="">All sites</option>
        {sites?.map((x) => <option key={x.site} value={x.site}>{x.site}</option>)}
      </select>
      {active && <button className="btn" onClick={() => { setMap(''); onPreview(null) }}>Clear</button>}
    </div>
  )
}
