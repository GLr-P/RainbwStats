// Pure construction of LiveState from stored rounds. No I/O beyond the Ctx queries.
import type { Ctx } from '../services'
import { banSuggestions, mainsOf, outsideRosterPick, recsFor, siteRecsFor, type Teammate } from '../services'
import type { LivePhase, LivePlayer, LiveState, PlayerCard, RoundSummary } from '../../shared/ipc'
import type { RoundRecord, Side } from '../../shared/types'
import { seasonCodeToId } from '../../shared/ranks'

/** Best end-of-season rank over the last 3 past seasons. */
function pastBestOf(ctx: Ctx, profileId: string): LivePlayer['pastBest'] {
  const recent = ctx.db.seasonRanks(profileId).filter((r) => r.rank > 0 && r.rank <= 40).sort((a, b) => seasonCodeToId(b.season) - seasonCodeToId(a.season)).slice(0, 3)
  return recent.reduce<LivePlayer['pastBest']>((best, r) => (!best || r.rank > best.rank ? r : best), null)
}

export const emptyLive = (gameRunning = false): LiveState => ({
  phase: gameRunning ? 'game' : 'idle', gameRunning, matchId: null, mapKey: null, side: null, site: null, nextRound: 1,
  score: [0, 0], myTeam: [], enemyTeam: [], recommendations: [], otherSide: null, outsideRoster: null, siteRecs: [], rounds: [], bans: null, source: null, lobbyError: null,
  updatedAt: new Date().toISOString()
})

const flip = (s: Side): Side => (s === 'attack' ? 'defense' : 'attack')

/** Side for round `next` (1-based): swap at half of regulation, alternate each overtime round. */
export function predictSide(firstSide: Side, next: number, roundsPerMatch: number): Side {
  const half = Math.max(1, Math.floor(roundsPerMatch / 2))
  if (next <= half) return firstSide
  if (next <= half * 2) return flip(firstSide)
  return (next - half * 2) % 2 === 1 ? firstSide : flip(firstSide)
}

/** When sides swap, learned from your recorded matches: per round number, how often the side changed
 *  from the previous round. Real (non-custom) matches are used when there are any. */
export function learnSwaps(seqs: { matchId: string; type: number; round: number; side: Side }[], type?: number): Map<number, { swaps: number; n: number }> {
  // Same match type first (playlists can use different formats), then any real match, then anything.
  const same = type === undefined ? [] : seqs.filter((x) => x.type === type)
  const real = seqs.filter((x) => x.type !== 3 && x.type !== 4)
  const use = same.length ? same : real.length ? real : seqs
  const out = new Map<number, { swaps: number; n: number }>()
  for (let i = 1; i < use.length; i++) {
    const a = use[i - 1]!, b = use[i]!
    if (a.matchId !== b.matchId || b.round !== a.round + 1) continue
    const c = out.get(b.round) ?? { swaps: 0, n: 0 }
    c.n++; c.swaps += +(a.side !== b.side)
    out.set(b.round, c)
  }
  return out
}

/** Next round's side. Evidence, strongest first: this match's own swaps so far (a format that swaps
 *  every round shows it by round 2), your past matches of the same type, then the format rule. */
export function nextSide(history: (Side | null)[], next: number, roundsPerMatch: number, learned: Map<number, { swaps: number; n: number }>): Side {
  const first = history.find((x) => x) ?? 'attack'
  const prev = history[history.length - 1] ?? null
  if (!prev) return predictSide(first, next, roundsPerMatch)
  // This match vs. the format rule: if it already broke the rule, the rule is wrong for this match.
  let broke = false, allSwapped = history.length >= 2
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1], b = history[i]
    if (!a || !b) { allSwapped = false; continue }
    const ruleSwap = predictSide(first, i + 1, roundsPerMatch) !== predictSide(first, i, roundsPerMatch)
    if ((a !== b) !== ruleSwap) broke = true
    if (a === b) allSwapped = false
  }
  if (broke && allSwapped) return flip(prev) // swaps every round
  const l = learned.get(next)
  if (l && l.n >= 3) return l.swaps / l.n >= 0.5 ? flip(prev) : prev
  if (broke) return flip(prev) // rule already wrong once and no history: alternating is the likelier format
  return predictSide(first, next, roundsPerMatch)
}

/** True when a team has clinched (regulation or overtime). */
export function matchOver(score: [number, number], roundsPerMatch: number, overtimeRounds: number): boolean {
  const half = Math.floor(roundsPerMatch / 2)
  const [a, b] = score
  if (Math.min(a, b) < half) return Math.max(a, b) >= half + 1
  return Math.max(a, b) >= half + Math.ceil((overtimeRounds + 1) / 2)
}

export interface BuildOpts {
  phase?: LivePhase
  gameRunning: boolean
  roundsPerMatch: number
  overtimeRounds: number
  cards?: Map<string, PlayerCard>
  lobbyError?: string | null
  /** OCR/manual overrides for the upcoming round. */
  override?: { mapKey?: string; side?: Side; site?: string | null }
}

export function buildLive(ctx: Ctx, rounds: RoundRecord[], o: BuildOpts): LiveState {
  if (!rounds.length) return { ...emptyLive(o.gameRunning), ...overrideOnly(ctx, o) }
  const last = rounds[rounds.length - 1]!
  const me = ctx.me() ?? last.recordingProfileId
  const myTeamIn = (r: RoundRecord) => r.players.find((p) => p.profileId === me || p.profileId === r.recordingProfileId)?.teamIndex ?? 0

  const summaries: RoundSummary[] = rounds.map((r) => {
    const t = myTeamIn(r)
    const mine = r.players.find((p) => p.teamIndex === t && (p.profileId === me || p.profileId === r.recordingProfileId))
    const anyMine = r.players.find((p) => p.teamIndex === t)
    return { round: r.round, side: anyMine?.side ?? null, site: r.site, won: !!anyMine?.won, myOp: mine?.operatorId ?? null }
  })
  const score: [number, number] = [summaries.filter((s) => s.won).length, summaries.filter((s) => !s.won).length]

  // Players: union over rounds; team relative to me in their latest round.
  const byId = new Map<string, LivePlayer & { mine: boolean }>()
  for (const r of rounds) {
    const t = myTeamIn(r)
    for (const p of r.players) {
      const lp = byId.get(p.profileId) ?? { profileId: p.profileId, name: p.username, isMe: p.profileId === me, card: null, ops: [] as LivePlayer['ops'], mains: [], pastBest: null, kills: 0, deaths: 0, mine: true }
      lp.name = p.username
      lp.mine = p.teamIndex === t
      lp.ops.push({ round: r.round, operatorId: p.operatorId, side: p.side, won: p.won })
      lp.kills += p.kills
      lp.deaths += p.died ? 1 : 0
      byId.set(p.profileId, lp)
    }
  }
  const players = [...byId.values()].map(({ mine, ...p }) => ({ ...p, card: o.cards?.get(p.profileId) ?? null, mains: mainsOf(ctx, p.profileId), pastBest: pastBestOf(ctx, p.profileId), mine }))
  const order = (a: LivePlayer, b: LivePlayer) => +b.isMe - +a.isMe || (b.card?.ranked?.rankPoints ?? 0) - (a.card?.ranked?.rankPoints ?? 0)
  const strip = ({ mine: _m, ...p }: LivePlayer & { mine: boolean }) => p

  const firstSide = summaries[0]?.side ?? 'attack'
  const nextRound = last.round + 1
  const over = matchOver(score, o.roundsPerMatch, o.overtimeRounds)
  const side = o.override?.side ?? nextSide(summaries.map((x) => x.side), nextRound, o.roundsPerMatch, learnSwaps(ctx.db.sideSequences(), last.matchType))
  const mapKey = o.override?.mapKey ?? last.mapKey
  const site = o.override?.site ?? null
  // Teammates (not me) with their picks so far: used to judge whether the team needs a hard breacher etc.
  const teammates = players.filter((p) => p.mine && !p.isMe).map((p) => ({ profileId: p.profileId, ops: p.ops }))
  const enemies = players.filter((p) => !p.mine).map((p) => ({ profileId: p.profileId, ops: p.ops }))
  const recs = recsFor(ctx, { mapKey, side, site, teammates, enemies })

  return {
    phase: o.phase ?? (over ? 'ended' : 'match'),
    gameRunning: o.gameRunning,
    matchId: last.matchId,
    mapKey, side, site, nextRound, score,
    myTeam: players.filter((p) => p.mine).sort(order).map(strip),
    enemyTeam: players.filter((p) => !p.mine).sort(order).map(strip),
    recommendations: recs,
    outsideRoster: outsideRosterPick(ctx, { mapKey, side, site, teammates }, recs[0]),
    otherSide: otherSidePicks(ctx, mapKey, side, teammates),
    siteRecs: siteRecsFor(ctx, mapKey, side, 3, teammates), // always shown (the current site is highlighted)
    rounds: summaries,
    // Siege X: a ban phase every round. Once the lobby is known, the enemy's best mains count too.
    bans: over ? null : banSuggestions(ctx, mapKey, 3, players.filter((p) => !p.mine).map((p) => ({ profileId: p.profileId, name: p.name }))),
    source: o.override ? 'ocr' : 'replay',
    lobbyError: o.lobbyError ?? null,
    updatedAt: new Date().toISOString()
  }
}

/** State before any round of the match is recorded (round 1, from OCR or a manual preview). */
function overrideOnly(ctx: Ctx, o: BuildOpts): Partial<LiveState> {
  const mapKey = o.override?.mapKey
  if (!mapKey) return {}
  // Map known but side not yet (e.g. loading screen): attack picks first, defense as "if you're on".
  const side = o.override?.side ?? null
  const shown: Side = side ?? 'attack'
  const site = o.override?.site ?? null
  const first = recsFor(ctx, { mapKey, side: shown, site })
  return {
    phase: o.phase ?? 'loading', mapKey, side, site,
    recommendations: first,
    outsideRoster: side ? outsideRosterPick(ctx, { mapKey, side, site }, first[0]) : null,
    otherSide: otherSidePicks(ctx, mapKey, shown),
    siteRecs: siteRecsFor(ctx, mapKey, shown),
    bans: banSuggestions(ctx, mapKey),
    source: o.phase === 'idle' ? 'preview' : 'ocr'
  }
}

function otherSidePicks(ctx: Ctx, mapKey: string, side: Side, teammates: Teammate[] = []): LiveState['otherSide'] {
  const other: Side = side === 'attack' ? 'defense' : 'attack'
  return { side: other, recs: recsFor(ctx, { mapKey, side: other, site: null, topN: 3, teammates }) }
}

/** How often nextSide would have been right on your recorded matches (each match predicted using only
 *  its earlier rounds and your *other* matches). Custom games are left out. */
export function sidePredictionAccuracy(seqs: { matchId: string; type: number; round: number; side: Side }[], roundsPerMatch = 6): { correct: number; total: number } {
  const byMatch = new Map<string, { type: number; sides: (Side | null)[] }>()
  for (const x of seqs) {
    if (x.type === 3 || x.type === 4) continue
    const m = byMatch.get(x.matchId) ?? { type: x.type, sides: [] }
    m.sides[x.round - 1] = x.side
    byMatch.set(x.matchId, m)
  }
  let correct = 0, total = 0
  for (const [id, m] of byMatch) {
    const learned = learnSwaps(seqs.filter((x) => x.matchId !== id), m.type)
    for (let r = 2; r <= m.sides.length; r++) {
      const actual = m.sides[r - 1]
      const history = m.sides.slice(0, r - 1).map((x) => x ?? null)
      if (!actual || !history[history.length - 1]) continue
      total++
      if (nextSide(history, r, roundsPerMatch, learned) === actual) correct++
    }
  }
  return { correct, total }
}
