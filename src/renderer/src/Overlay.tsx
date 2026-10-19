// Compact always-on-top window (Settings → Overlay, or the tray menu): the live essentials at a glance.
import { useEffect } from 'react'
import { applyCatalogOverrides, mapName } from '../../shared/catalog'
import { RankBadge, SideTag, rs, useLive, useSettings } from './lib'

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const name = { fontFamily: 'var(--head)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em' } as const

export function Overlay() {
  const live = useLive()
  const [settings, update] = useSettings()
  useEffect(() => { void rs().catalog().then(applyCatalogOverrides) }, [])
  if (!settings) return null
  const s = live
  const inMatch = s && (s.phase === 'match' || s.phase === 'loading' || (s.phase === 'ended' && s.matchId))
  const opacity = (d: number) => void update({ overlayOpacity: Math.round(Math.min(1, Math.max(0.3, settings.overlayOpacity + d)) * 100) / 100 })
  return (
    <div className="overlay">
      <div className="row" style={{ ...drag, gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--line)', cursor: 'move' }}>
        {inMatch && s.mapKey ? <>
          <span style={{ ...name, fontSize: '1.1rem' }}>{mapName(s.mapKey)}</span>
          {s.phase !== 'ended' && <SideTag side={s.side} />}
          <span className="small muted">{s.phase === 'ended' ? 'Ended' : s.phase === 'loading' ? 'R1' : `R${s.nextRound}`}</span>
          {s.rounds.length > 0 && <span className="num" style={{ fontWeight: 700 }}><span className="w">{s.score[0]}</span>–<span className="l">{s.score[1]}</span></span>}
        </> : <span className="small muted" style={name}>RainbwStats</span>}
        <div className="spacer" />
        <span style={noDrag} className="row">
          <button className="ov-btn" title="More transparent" onClick={() => opacity(-0.1)}>−</button>
          <button className="ov-btn" title="Less transparent" onClick={() => opacity(0.1)}>+</button>
          <button className="ov-btn" title="Close overlay" onClick={() => void update({ overlay: false })}>×</button>
        </span>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!inMatch || !s ? <div className="small muted">Waiting for a match. Picks, bans and the enemy team show up here.</div> : <>
          {s.bans && s.rounds.length === 0 && (
            <div>
              <div className="ov-h">Ban</div>
              {(['attack', 'defense'] as const).map((side) => (
                <div key={side} className="row small" style={{ gap: 6 }}><SideTag side={side} /><span style={name}>{s.bans![side].slice(0, 2).map((b) => b.name).join(' · ') || '–'}</span></div>
              ))}
            </div>
          )}
          {s.phase !== 'ended' && (
            <div>
              <div className="ov-h">Pick {s.site ? `· ${s.site}` : ''}</div>
              {s.recommendations.slice(0, 3).map((r, i) => (
                <div key={r.operatorId} className="row" style={{ gap: 8 }} title={r.reasons.join(' · ')}>
                  <span className="faint num" style={{ width: 14 }}>{i + 1}</span>
                  <span style={{ ...name, fontSize: i === 0 ? '1.15rem' : '1rem' }}>{r.name}</span>
                  <span className="faint num small">{r.score}%</span>
                </div>
              ))}
              {s.otherSide && s.otherSide.recs.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>If <SideTag side={s.otherSide.side} />: {s.otherSide.recs.map((r) => r.name).join(' · ')}</div>}
            </div>
          )}
          {s.enemyTeam.length > 0 && (
            <div>
              <div className="ov-h">Enemy</div>
              {s.enemyTeam.map((p) => (
                <div key={p.profileId} className="row small" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  {p.card?.ranked && p.card.ranked.rank > 0 && <RankBadge rank={p.card.ranked.rank} />}
                  <span className="faint" style={{ whiteSpace: 'nowrap' }}>{p.mains.slice(0, 2).map((m) => m.name).join(', ')}</span>
                </div>
              ))}
            </div>
          )}
        </>}
      </div>
    </div>
  )
}
