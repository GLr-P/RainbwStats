// Pure construction of LiveState from stored rounds. No I/O beyond the Ctx queries.
import type { Ctx } from '../services'
import { recsFor, siteRecsFor } from '../services'
import type { LivePhase, LivePlayer, LiveState, PlayerCard, RoundSummary } from '../../shared/ipc'
import type { RoundRecord, Side } from '../../shared/types'

export const emptyLive = (gameRunning = false): LiveState => ({
  phase: gameRunning ? 'game' : 'idle', gameRunning, matchId: null, mapKey: null, side: null, site: null, nextRound: 1,
  score: [0, 0], myTeam: [], enemyTeam: [], recommendations: [], siteRecs: [], rounds: [], source: null, lobbyError: null,
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
      const lp = byId.get(p.profileId) ?? { profileId: p.profileId, name: p.username, isMe: p.profileId === me, card: null, ops: [], kills: 0, deaths: 0, mine: true }
      lp.name = p.username
      lp.mine = p.teamIndex === t
      lp.ops.push({ round: r.round, operatorId: p.operatorId, side: p.side, won: p.won })
      lp.kills += p.kills
      lp.deaths += p.died ? 1 : 0
      byId.set(p.profileId, lp)
    }
  }
  const players = [...byId.values()].map(({ mine, ...p }) => ({ ...p, card: o.cards?.get(p.profileId) ?? null, mine }))
  const order = (a: LivePlayer, b: LivePlayer) => +b.isMe - +a.isMe || (b.card?.ranked?.rankPoints ?? 0) - (a.card?.ranked?.rankPoints ?? 0)
  const strip = ({ mine: _m, ...p }: LivePlayer & { mine: boolean }) => p

  const firstSide = summaries[0]?.side ?? 'attack'
  const nextRound = last.round + 1
  const over = matchOver(score, o.roundsPerMatch, o.overtimeRounds)
  const side = o.override?.side ?? predictSide(firstSide, nextRound, o.roundsPerMatch)
  const mapKey = o.override?.mapKey ?? last.mapKey
  const site = o.override?.site ?? null
  const teammateOps: string[] = [] // picks for the upcoming round are unknown until it is recorded

  return {
    phase: o.phase ?? (over ? 'ended' : 'match'),
    gameRunning: o.gameRunning,
    matchId: last.matchId,
    mapKey, side, site, nextRound, score,
    myTeam: players.filter((p) => p.mine).sort(order).map(strip),
    enemyTeam: players.filter((p) => !p.mine).sort(order).map(strip),
    recommendations: recsFor(ctx, { mapKey, side, site, teammateOps }),
    siteRecs: site ? [] : siteRecsFor(ctx, mapKey, side),
    rounds: summaries,
    source: o.override ? 'ocr' : 'replay',
    lobbyError: o.lobbyError ?? null,
    updatedAt: new Date().toISOString()
  }
}

/** State before any round of the match is recorded (round 1, from OCR or a manual preview). */
function overrideOnly(ctx: Ctx, o: BuildOpts): Partial<LiveState> {
  const mapKey = o.override?.mapKey
  const side = o.override?.side
  if (!mapKey || !side) return {}
  const site = o.override?.site ?? null
  return {
    phase: o.phase ?? 'loading', mapKey, side, site,
    recommendations: recsFor(ctx, { mapKey, side, site }),
    siteRecs: site ? [] : siteRecsFor(ctx, mapKey, side),
    source: o.phase === 'idle' ? 'preview' : 'ocr'
  }
}
