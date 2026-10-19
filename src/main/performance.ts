// "Me" tab: rank, current/last session, match history and personal breakdowns.
// Match history merges two sources: replays on this PC (map, rounds, K/D) and ranked W/L changes between
// rank snapshots (RP gained/lost per game, works for games played anywhere).
import type { RankSnapshot } from './db'
import type { MatchRow, Performance, SessionStats } from '../shared/ipc'
import type { RoundRecord, Side } from '../shared/types'
import { operatorById, operatorByKey } from '../shared/catalog'
import { seasonCodeToId } from '../shared/ranks'
import { currentSeason, type Ctx } from './services'

const HOUR = 3600_000
const SESSION_GAP = 3 * HOUR
// Replay match types (r6-dissect): 1 quick, 2 ranked, 3/4 custom, 8 standard.
const KIND: Record<number, string> = { 1: 'Quick', 2: 'Ranked', 3: 'Custom', 4: 'Custom', 8: 'Standard' }
const kindOf = (t: number) => KIND[t] ?? 'Match'

/** Builds a history row from a replay match (null if the user isn't in it). */
export function replayMatch(rounds: RoundRecord[], me: string): MatchRow | null {
  const first = rounds[0]
  if (!first) return null
  const mine = (r: RoundRecord) => r.players.find((p) => p.profileId === me) ?? r.players.find((p) => p.profileId === r.recordingProfileId)
  const rows = rounds.map((r) => ({ r, p: mine(r) })).filter((x) => !!x.p)
  if (!rows.length) return null
  const wins = rows.filter((x) => x.p!.won).length, losses = rows.length - wins
  const ops: string[] = []
  for (const x of rows) { const n = operatorById(x.p!.operatorId)?.name ?? x.p!.operatorId; if (!ops.includes(n)) ops.push(n) }
  return {
    id: first.matchId, at: rounds[rounds.length - 1]!.playedAt, kind: kindOf(first.matchType), source: 'replay', mapKey: first.mapKey,
    result: wins > losses ? 'win' : losses > wins ? 'loss' : 'draw', score: [wins, losses], rpDelta: null, rankAfter: null,
    kills: rows.reduce((n, x) => n + x.p!.kills, 0), deaths: rows.filter((x) => x.p!.died).length, headshots: rows.reduce((n, x) => n + x.p!.headshots, 0), ops,
    rounds: rows.map(({ r, p }) => {
      const op = operatorById(p!.operatorId)
      return { round: r.round, side: p!.side, site: r.site, op: op?.name ?? p!.operatorId, opKey: op?.key ?? null, won: p!.won, kills: p!.kills, died: p!.died }
    })
  }
}

/** Collapses snapshots that didn't change (same W/L/abandons/RP). */
export function changes(snaps: RankSnapshot[]): RankSnapshot[] {
  const out: RankSnapshot[] = []
  for (const s of snaps) {
    const p = out[out.length - 1]
    if (!p || p.wins !== s.wins || p.losses !== s.losses || p.abandons !== s.abandons || p.rankPoints !== s.rankPoints) out.push(s)
  }
  return out
}

/** Merges replay matches with ranked games inferred from W/L changes between snapshots. Newest first. */
export function mergeHistory(replays: MatchRow[], snaps: RankSnapshot[]): MatchRow[] {
  const out = replays.map((m) => ({ ...m }))
  const s = changes(snaps)
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!, b = s[i]!
    const dW = b.wins - a.wins, dL = b.losses - a.losses, dA = b.abandons - a.abandons
    const games = dW + dL + dA
    if (games <= 0) continue
    const rp = b.rankPoints - a.rankPoints
    // Snapshots are also taken mid-match, so a game's last round can be slightly before the "before" snapshot.
    const from = Date.parse(a.fetchedAt) - 10 * 60_000, to = Date.parse(b.fetchedAt)
    const inWindow = out.filter((m) => m.source === 'replay' && m.kind === 'Ranked' && Date.parse(m.at) > from && Date.parse(m.at) <= to)
    if (games === 1) {
      const result: MatchRow['result'] = dW ? 'win' : dL ? 'loss' : 'abandon'
      const match = inWindow.length === 1 ? inWindow[0]! : null
      if (match) Object.assign(match, { source: 'both', rpDelta: rp, rankAfter: b.rank, result })
      else out.push({ id: `rank:${b.fetchedAt}`, at: b.fetchedAt, kind: 'Ranked', source: 'rank', mapKey: null, result, score: null, rpDelta: rp, rankAfter: b.rank, kills: 0, deaths: 0, headshots: 0, ops: [], rounds: [] })
    } else if (inWindow.length < games) {
      // Several games between two checks: one summary row (replays in the window stay as they are).
      out.push({ id: `rank:${b.fetchedAt}`, at: b.fetchedAt, kind: 'Ranked', source: 'rank', mapKey: null, result: 'unknown', score: null, rpDelta: rp, rankAfter: b.rank,
        games: { wins: dW, losses: dL, abandons: dA }, kills: 0, deaths: 0, headshots: 0, ops: [], rounds: [] })
    }
  }
  return out.sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
}

/** The latest run of games with less than 3 h between them. */
export function sessionOf(matches: MatchRow[], now: number): SessionStats | null {
  const first = matches[0]
  if (!first) return null
  const run = [first]
  for (let i = 1; i < matches.length; i++) {
    if (Date.parse(run[run.length - 1]!.at) - Date.parse(matches[i]!.at) > SESSION_GAP) break
    run.push(matches[i]!)
  }
  const ops = new Map<string, { opKey: string; name: string; side: Side; rounds: number; wins: number }>()
  for (const m of run) for (const r of m.rounds) {
    const key = r.opKey ?? r.op
    const a = ops.get(key) ?? { opKey: key, name: r.op, side: (r.opKey ? operatorByKey(r.opKey)?.side : null) ?? r.side ?? 'attack', rounds: 0, wins: 0 }
    a.rounds++; a.wins += +r.won
    ops.set(key, a)
  }
  const sum = (f: (m: MatchRow) => number) => run.reduce((n, m) => n + f(m), 0)
  const rps = run.filter((m) => m.rpDelta !== null)
  return {
    active: now - Date.parse(first.at) < SESSION_GAP, start: run[run.length - 1]!.at, end: first.at,
    matches: sum((m) => (m.games ? m.games.wins + m.games.losses + m.games.abandons : 1)),
    wins: sum((m) => (m.games ? m.games.wins : +(m.result === 'win'))),
    losses: sum((m) => (m.games ? m.games.losses + m.games.abandons : +(m.result === 'loss' || m.result === 'abandon'))),
    rpDelta: rps.length ? rps.reduce((n, m) => n + m.rpDelta!, 0) : null,
    rounds: sum((m) => m.rounds.length), roundWins: sum((m) => m.rounds.filter((r) => r.won).length),
    kills: sum((m) => m.kills), deaths: sum((m) => m.deaths),
    ops: [...ops.values()]
  }
}

export function performance(ctx: Ctx, loggedIn: boolean, now = Date.now()): Performance {
  const season = currentSeason(ctx)
  const me = ctx.me()
  const empty: Performance = { me: null, season, rank: null, rpHistory: [], session: null, matches: [], sides: { attack: { rounds: 0, wins: 0 }, defense: { rounds: 0, wins: 0 } }, ops: [], maps: [], loggedIn }
  if (!me) return empty
  const snaps = ctx.db.rankSnapshots(me, 'ranked', seasonCodeToId(season))
  const replays = ctx.db.recentMatches(60).map((m) => replayMatch(ctx.db.roundsOfMatch(m.matchId), me)).filter((m): m is MatchRow => !!m)
  const matches = mergeHistory(replays, snaps)
  const last = snaps[snaps.length - 1]
  const ops = [...ctx.db.apiOpAggs({ profileId: me, season })].flatMap(([key, a]) => {
    const op = operatorByKey(key)
    return op && a.rounds ? [{ opKey: key, name: op.name, side: op.side, rounds: a.rounds, wins: a.wins }] : []
  })
  const sides = { attack: { rounds: 0, wins: 0 }, defense: { rounds: 0, wins: 0 } }
  for (const o of ops) { sides[o.side].rounds += o.rounds; sides[o.side].wins += o.wins }
  // Map breakdown from replays; custom games only count when there is nothing else.
  const real = replays.filter((m) => m.kind !== 'Custom')
  const maps = new Map<string, Performance['maps'][number]>()
  for (const m of real.length ? real : replays) {
    const a = maps.get(m.mapKey!) ?? { mapKey: m.mapKey!, matches: 0, wins: 0, rounds: 0, roundWins: 0 }
    a.matches++; a.wins += +(m.result === 'win'); a.rounds += m.rounds.length; a.roundWins += m.rounds.filter((r) => r.won).length
    maps.set(m.mapKey!, a)
  }
  return {
    me: { profileId: me, name: ctx.db.playerName(me) ?? 'You' }, season,
    rank: last ? { rank: last.rank, rankPoints: last.rankPoints, maxRank: last.maxRank, maxRankPoints: last.maxRankPoints, wins: last.wins, losses: last.losses, abandons: last.abandons, kills: last.kills, deaths: last.deaths, at: last.fetchedAt } : null,
    rpHistory: changes(snaps).map((s) => ({ at: s.fetchedAt, rp: s.rankPoints, rank: s.rank })),
    session: sessionOf(matches, now), matches, sides, ops, maps: [...maps.values()], loggedIn
  }
}
