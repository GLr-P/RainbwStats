// Builds a realistic, fully synthetic match for the simulator. Never stored in the DB.
// Players pick from their real mains when known (Ubisoft stats), else from the operator pool
// weighted by baseline strength; no duplicate operators within a team in a round.
import { allOperators, operatorByKey } from '../../shared/catalog'
import type { RoundPlayer, RoundRecord, Side } from '../../shared/types'
import { predictSide } from './state'

export interface SimPlayer { profileId: string; name: string; mains: { opKey: string; side: Side; rounds: number }[] }

export interface SimSpec {
  mapKey: string
  mySide: Side // side in round 1
  me: SimPlayer
  myTeam: SimPlayer[] // teammates (without me)
  enemyTeam: SimPlayer[]
  sites: string[]
  baseline: Map<string, number> // operator id → strength
  roundsPerMatch?: number
  seed?: number
  now?: number
}

/** Small deterministic RNG (mulberry32) so tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rand: () => number): T | undefined {
  const total = items.reduce((n, t) => n + Math.max(0, weight(t)), 0)
  if (total <= 0) return items[Math.floor(rand() * items.length)]
  let r = rand() * total
  for (const t of items) { r -= Math.max(0, weight(t)); if (r <= 0) return t }
  return items[items.length - 1]
}

export function buildSyntheticMatch(spec: SimSpec): RoundRecord[] {
  const rand = rng(spec.seed ?? Date.now())
  const rpm = spec.roundsPerMatch ?? 6
  const half = rpm / 2
  const matchId = `sim-${Math.floor(rand() * 1e9).toString(36)}`
  const mine = [spec.me, ...spec.myTeam]
  const rounds: RoundRecord[] = []
  const score = [0, 0]
  const start = spec.now ?? Date.now()
  for (let n = 1; n <= rpm + 6; n++) {
    const mySide = predictSide(spec.mySide, n, rpm)
    const site = spec.sites.length ? spec.sites[Math.floor(rand() * spec.sites.length)]! : ''
    // Slight edge to defense, like real Siege.
    const iWon = rand() < (mySide === 'defense' ? 0.53 : 0.47)
    const players: RoundPlayer[] = []
    for (const [team, members, side] of [[0, mine, mySide], [1, spec.enemyTeam, mySide === 'attack' ? 'defense' : 'attack']] as const) {
      const used = new Set<string>()
      const won = team === 0 ? iWon : !iWon
      for (const p of members) {
        const fromMains = p.mains.filter((m) => m.side === side && !used.has(m.opKey) && operatorByKey(m.opKey))
        const pick = rand() < 0.8 && fromMains.length
          ? operatorByKey(weightedPick(fromMains, (m) => m.rounds, rand)!.opKey)!
          : weightedPick(allOperators(side).filter((o) => !used.has(o.key) && !o.id.startsWith('x:')), (o) => (spec.baseline.get(o.id) ?? 0.5) ** 3, rand)!
        used.add(pick.key)
        const kills = Math.floor(rand() * (won ? 3 : 2))
        players.push({
          profileId: p.profileId, username: p.name, teamIndex: team as 0 | 1, side, operatorId: pick.id, won,
          kills, died: won ? rand() < 0.35 : rand() < 0.85, headshots: Math.floor(kills * rand())
        })
      }
    }
    rounds.push({
      matchId, round: n, playedAt: new Date(start + n * 180_000).toISOString(), gameVersion: 'SIMULATED', season: 'SIM',
      matchType: 2, mapKey: spec.mapKey, site, recordingProfileId: spec.me.profileId, players
    })
    score[iWon ? 0 : 1]!++
    const [a, b] = score as [number, number]
    const over = Math.min(a, b) < half ? Math.max(a, b) >= half + 1 : Math.max(a, b) >= half + 2
    if (over) break
  }
  return rounds
}
