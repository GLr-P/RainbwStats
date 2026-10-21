// Coach: turns your own numbers into a few plain-language tips (what to change, what to keep doing).
// Pure and unit-tested. Every tip carries its evidence; small samples are shrunk toward the
// players-at-your-rank average so a lucky 5-round streak never becomes advice.
import type { MatchRow } from './ipc'
import type { Side } from './types'

export interface CoachOp { opKey: string; name: string; side: Side; rounds: number; wins: number }
export interface CoachTip {
  id: string
  kind: 'side' | 'drop' | 'play' | 'survive' | 'map' | 'site' | 'tilt' | 'fatigue'
  title: string
  detail: string
  /** Higher = more rounds at stake; tips are sorted by it. */
  weight: number
  /** The side it's about (for in-match reminders), and the map for map/site tips. */
  side?: Side
  mapKey?: string
  /** One-click follow-up: add the operator to, or remove it from, your roster. */
  action?: { side: Side; opKey: string; add: boolean }
}
export interface CoachInput {
  season: string
  prevSeason: string
  /** Your operators this season and last season. */
  ops: CoachOp[]
  prevOps: CoachOp[]
  /** Win rate per operator for players at your rank (crowd data), if known. */
  peers: Map<string, { rounds: number; wins: number }>
  /** "Gold players", "players" when no rank. */
  peerLabel: string
  matches: MatchRow[]
  maps: { mapKey: string; matches: number; wins: number; rounds: number; roundWins: number }[]
  mapName: (key: string) => string
  /** Recorded (non-custom) rounds: you, and your teammates in the same rounds. */
  vsTeam?: { me: Duel; mates: Duel }
}
/** Player-rounds: how many, deaths, deaths without a kill, kills. */
export interface Duel { rounds: number; died: number; blank: number; kills: number }

const PRIOR = 20 // rounds of "average player" mixed into every operator rate
const pct = (x: number) => `${Math.round(x * 100)}%`
const SIDE: Record<Side, string> = { attack: 'attack', defense: 'defense' }

function sideRates(ops: CoachOp[]): Record<Side, { rounds: number; wins: number }> {
  const s = { attack: { rounds: 0, wins: 0 }, defense: { rounds: 0, wins: 0 } }
  for (const o of ops) { s[o.side].rounds += o.rounds; s[o.side].wins += o.wins }
  return s
}

export function coach(inp: CoachInput): CoachTip[] {
  const tips: CoachTip[] = []
  const both = inp.prevSeason ? `${inp.prevSeason} and ${inp.season}` : inp.season

  // 1. Weak side: the biggest, steadiest leak usually shows up as one side lagging the other.
  const now = sideRates(inp.ops), before = sideRates(inp.prevOps)
  if (now.attack.rounds >= 30 && now.defense.rounds >= 30) {
    const a = now.attack.wins / now.attack.rounds, d = now.defense.wins / now.defense.rounds
    const weak: Side = a < d ? 'attack' : 'defense', strong: Side = weak === 'attack' ? 'defense' : 'attack'
    const gap = Math.abs(a - d)
    if (gap >= 0.05) {
      const pa = before[weak].rounds >= 30 && before[strong].rounds >= 30 ? before[weak].wins / before[weak].rounds : null
      const pd = pa === null ? null : before[strong].wins / before[strong].rounds
      const again = pa !== null && pd !== null && pa < pd
      tips.push({
        id: 'side', kind: 'side', side: weak, weight: gap * Math.sqrt(now[weak].rounds) * 4,
        title: `${weak === 'attack' ? 'Attack' : 'Defense'} is where you lose rounds`,
        detail: `You win ${pct(now[weak].wins / now[weak].rounds)} of ${SIDE[weak]} rounds and ${pct(now[strong].wins / now[strong].rounds)} on ${SIDE[strong]} this season` +
          (again ? `, and it was the same last season (${pct(pa)} vs ${pct(pd)}).` : '.') +
          (weak === 'attack'
            ? ' Attack rounds are usually lost before the plant: drone more, push together with a teammate, and play for the plant instead of chasing kills.'
            : ' Defense rounds are usually lost by being caught out of position: reinforce early, hold one angle at a time, and fall back to site when you lose intel.')
      })
    }
  }

  // 2. Operators: compare each one with players at your rank, over this and last season together.
  const merged = new Map<string, CoachOp & { now: number }>()
  for (const [list, cur] of [[inp.prevOps, 0], [inp.ops, 1]] as const) {
    for (const o of list) {
      const m = merged.get(o.opKey) ?? { ...o, rounds: 0, wins: 0, now: 0 }
      m.rounds += o.rounds; m.wins += o.wins; if (cur) m.now += o.rounds
      merged.set(o.opKey, m)
    }
  }
  const peerRate = (key: string) => {
    const p = inp.peers.get(key)
    return p && p.rounds >= 50 ? p.wins / p.rounds : 0.5
  }
  const rated = [...merged.values()].map((o) => {
    const peer = peerRate(o.opKey)
    const shrunk = (o.wins + peer * PRIOR) / (o.rounds + PRIOR)
    return { ...o, peer, delta: shrunk - peer }
  })
  const sideNow = (s: Side) => Math.max(1, now[s].rounds)
  const strong = rated.filter((o) => o.rounds >= 10 && o.delta >= 0.04).sort((x, y) => y.delta * Math.sqrt(y.rounds) - x.delta * Math.sqrt(x.rounds))

  // Why an operator goes badly, from recorded rounds: dying before getting a kill, against your other operators.
  const recorded = inp.matches.filter((m) => m.kind !== 'Custom').flatMap((m) => m.rounds)
  const why = (o: CoachOp): string => {
    const mine = recorded.filter((r) => r.opKey === o.opKey), rest = recorded.filter((r) => r.opKey !== o.opKey && r.side === o.side)
    if (mine.length < 10 || rest.length < 10) return ''
    const blank = (rs: typeof recorded) => rs.filter((r) => r.died && r.kills === 0).length / rs.length
    return blank(mine) >= blank(rest) + 0.1
      ? ` In your recorded rounds with ${o.name} you die without a kill ${pct(blank(mine))} of the time (${pct(blank(rest))} on your other ${o.side} operators), so you may be taking fights this operator isn't built for.`
      : ''
  }

  for (const o of rated.filter((o) => o.rounds >= 15 && o.delta <= -0.04).sort((x, y) => x.delta * Math.sqrt(x.rounds) - y.delta * Math.sqrt(y.rounds)).slice(0, 2)) {
    const alt = strong.filter((s) => s.side === o.side).slice(0, 2).map((s) => s.name)
    tips.push({
      id: `drop:${o.opKey}`, kind: 'drop', side: o.side, weight: -o.delta * Math.sqrt(o.rounds) * 4, action: { side: o.side, opKey: o.opKey, add: false },
      title: `Pick ${o.name} less`,
      detail: `You win ${pct(o.wins / o.rounds)} of ${o.rounds} rounds with ${o.name} (${both}); ${inp.peerLabel} win ${pct(o.peer)} with them.` + why(o) +
        (alt.length ? ` You do much better on ${alt.join(' and ')}.` : '')
    })
  }

  for (const o of strong.filter((o) => o.now / sideNow(o.side) < 0.06).slice(0, 2)) {
    tips.push({
      id: `play:${o.opKey}`, kind: 'play', side: o.side, weight: o.delta * Math.sqrt(o.rounds) * 3, action: { side: o.side, opKey: o.opKey, add: true },
      title: `Bring back ${o.name}`,
      detail: `You win ${pct(o.wins / o.rounds)} of ${o.rounds} rounds with ${o.name} (${inp.peerLabel}: ${pct(o.peer)}), but you've ${o.now ? `only played them ${o.now} rounds` : 'not played them'} this season.`
    })
  }

  // 3. Survival (replays), against your own teammates in the same rounds. (Comparing your team's win rate
  // when you live vs die says nothing: won rounds always have survivors.)
  const t = inp.vsTeam
  if (t && t.me.rounds >= 20 && t.mates.rounds >= 60) {
    const r = (d: Duel, n: number) => n / d.rounds
    const blankGap = r(t.me, t.me.blank) - r(t.mates, t.mates.blank), deathGap = r(t.me, t.me.died) - r(t.mates, t.mates.died)
    const kpr = (d: Duel) => (d.kills / d.rounds).toFixed(2)
    if (blankGap >= 0.08) {
      tips.push({
        id: 'survive', kind: 'survive', weight: blankGap * Math.sqrt(t.me.rounds) * 4,
        title: 'You die before getting a kill more than your teammates',
        detail: `You die without a kill in ${pct(r(t.me, t.me.blank))} of rounds; your teammates in the same games: ${pct(r(t.mates, t.mates.blank))}. Take fewer early duels: let a teammate swing first so you can trade, and use utility or a drone before you peek.`
      })
    } else if (deathGap >= 0.1) {
      tips.push({
        id: 'survive', kind: 'survive', weight: deathGap * Math.sqrt(t.me.rounds) * 3,
        title: 'You die more often than your teammates',
        detail: `You die in ${pct(r(t.me, t.me.died))} of rounds and your teammates in ${pct(r(t.mates, t.mates.died))} (same games), with ${kpr(t.me)} kills per round against their ${kpr(t.mates)}. Trade your life for more: stay near a teammate and don't take the second fight while hurt.`
      })
    }
  }

  // 4. Maps (replays): one clearly bad map is worth banning.
  const ok = inp.maps.filter((m) => m.matches >= 2 && m.rounds >= 12)
  const total = ok.reduce((n, m) => n + m.rounds, 0), totalWins = ok.reduce((n, m) => n + m.roundWins, 0)
  if (ok.length >= 3 && total) {
    const avg = totalWins / total
    const worst = ok.map((m) => ({ m, d: (m.roundWins + avg * 10) / (m.rounds + 10) - avg })).sort((a, b) => a.d - b.d)[0]!
    if (worst.d <= -0.08) {
      tips.push({
        id: `map:${worst.m.mapKey}`, kind: 'map', mapKey: worst.m.mapKey, weight: -worst.d * Math.sqrt(worst.m.rounds) * 3,
        title: `Ban ${inp.mapName(worst.m.mapKey)} when you can`,
        detail: `You win ${pct(worst.m.roundWins / worst.m.rounds)} of rounds on ${inp.mapName(worst.m.mapKey)} (${worst.m.wins}–${worst.m.matches - worst.m.wins} in games) against ${pct(avg)} on your other maps.`
      })
    }
  }

  // 5. Defense sites (replays): one site you keep losing is a setup to learn.
  const def = inp.matches.filter((m) => m.kind !== 'Custom' && m.mapKey).flatMap((m) => m.rounds.filter((r) => r.side === 'defense' && r.site).map((r) => ({ ...r, mapKey: m.mapKey! })))
  if (def.length >= 20) {
    const avg = def.filter((r) => r.won).length / def.length
    const bySite = new Map<string, { mapKey: string; site: string; rounds: number; wins: number }>()
    for (const r of def) {
      const k = `${r.mapKey}|${r.site}`
      const a = bySite.get(k) ?? { mapKey: r.mapKey, site: r.site, rounds: 0, wins: 0 }
      a.rounds++; a.wins += +r.won
      bySite.set(k, a)
    }
    const worst = [...bySite.values()].filter((s) => s.rounds >= 6).map((s) => ({ s, d: (s.wins + avg * 6) / (s.rounds + 6) - avg })).sort((a, b) => a.d - b.d)[0]
    if (worst && worst.d <= -0.12) {
      tips.push({
        id: `site:${worst.s.mapKey}|${worst.s.site}`, kind: 'site', side: 'defense', mapKey: worst.s.mapKey, weight: -worst.d * Math.sqrt(worst.s.rounds) * 3,
        title: `Learn the ${worst.s.site} setup on ${inp.mapName(worst.s.mapKey)}`,
        detail: `You win ${pct(worst.s.wins / worst.s.rounds)} of ${worst.s.rounds} defense rounds there, against ${pct(avg)} on your other defense sites. The Maps tab shows which operators win on that site.`
      })
    }
  }

  // 6. Tilt: how you do right after two losses in a row (same sitting, under 3 h apart).
  const games = inp.matches.filter((m) => !m.games && (m.result === 'win' || m.result === 'loss')).slice().reverse()
  if (games.length >= 15) {
    let after = 0, afterWins = 0
    for (let i = 2; i < games.length; i++) {
      const [a, b, c] = [games[i - 2]!, games[i - 1]!, games[i]!]
      if (Date.parse(c.at) - Date.parse(a.at) > 3 * 3600_000) continue
      if (a.result === 'loss' && b.result === 'loss') { after++; afterWins += +(c.result === 'win') }
    }
    const overall = games.filter((g) => g.result === 'win').length / games.length
    if (after >= 6 && afterWins / after <= overall - 0.1) {
      tips.push({
        id: 'tilt', kind: 'tilt', weight: (overall - afterWins / after) * Math.sqrt(after) * 3,
        title: 'Take a break after two losses',
        detail: `After losing two games in a row you win ${pct(afterWins / after)} of the next game (${after} times), against ${pct(overall)} overall.`
      })
    }
  }

  // 7. Fatigue: long sittings. Game 1–3 of a sitting against game 4 onwards.
  if (games.length >= 16) {
    const early = { n: 0, w: 0 }, late = { n: 0, w: 0 }
    let idx = 0
    for (let i = 0; i < games.length; i++) {
      idx = i > 0 && Date.parse(games[i]!.at) - Date.parse(games[i - 1]!.at) <= 3 * 3600_000 ? idx + 1 : 1
      const b = idx <= 3 ? early : late
      b.n++; b.w += +(games[i]!.result === 'win')
    }
    if (early.n >= 8 && late.n >= 8 && late.w / late.n <= early.w / early.n - 0.12) {
      tips.push({
        id: 'fatigue', kind: 'fatigue', weight: (early.w / early.n - late.w / late.n) * Math.sqrt(late.n) * 3,
        title: 'Stop after three games',
        detail: `You win ${pct(early.w / early.n)} of the first three games of a sitting and ${pct(late.w / late.n)} from the fourth game on (${late.n} games).`
      })
    }
  }

  return tips.sort((a, b) => b.weight - a.weight).slice(0, 6)
}
