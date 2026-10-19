import { describe, expect, it } from 'vitest'
import { buildSyntheticMatch, type SimPlayer } from '../src/main/live/simulate'
import { predictSide } from '../src/main/live/state'
import { LiveEngine } from '../src/main/live/engine'
import { openDb } from '../src/main/db'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'
import { SEED_SITES } from '../src/shared/data/maps'
import { baselineFor } from '../src/shared/recommend'
import { operatorByKey } from '../src/shared/catalog'
import type { LobbyService } from '../src/main/ubi/lobby'
import type { LiveState } from '../src/shared/ipc'

const p = (n: number, mains: SimPlayer['mains'] = []): SimPlayer => ({ profileId: `0000000${n}-0000-4000-8000-000000000000`, name: `P${n}`, mains })
const spec = (seed: number) => ({
  mapKey: 'clubhouse', mySide: 'attack' as const, me: p(1, [{ opKey: 'ace', side: 'attack' as const, rounds: 500 }]),
  myTeam: [p(2), p(3), p(4), p(5)], enemyTeam: [p(6), p(7), p(8), p(9), p(10)],
  sites: SEED_SITES['clubhouse']!, baseline: baselineFor(BUNDLED_DATASET, 'clubhouse'), seed, now: 0
})

describe('match simulator', () => {
  it('is deterministic per seed and realistic', () => {
    expect(buildSyntheticMatch(spec(7))).toEqual(buildSyntheticMatch(spec(7)))
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rounds = buildSyntheticMatch(spec(seed))
      const wins = [0, 0]
      for (const r of rounds) {
        expect(r.matchId).toMatch(/^sim-/)
        expect(r.players).toHaveLength(10)
        expect(SEED_SITES['clubhouse']).toContain(r.site)
        for (const t of [0, 1] as const) {
          const team = r.players.filter((x) => x.teamIndex === t)
          expect(new Set(team.map((x) => x.operatorId)).size).toBe(5) // no duplicate ops in a team
          expect(team.every((x) => operatorByKey(x.operatorId) === undefined)).toBe(true) // ids, not keys
        }
        const mySide = r.players.find((x) => x.teamIndex === 0)!.side
        expect(mySide).toBe(predictSide('attack', r.round, 6))
        expect(r.players.every((x) => (x.teamIndex === 0 ? x.side === mySide : x.side !== mySide))).toBe(true)
        wins[r.players[0]!.won ? 0 : 1]!++
      }
      const [a, b] = wins as [number, number]
      expect(Math.max(a, b) === 4 && Math.min(a, b) < 3 || Math.max(a, b) === 5).toBe(true)
    }
  })

  it('players lean on their real mains', () => {
    const ace = operatorByKey('ace')!.id
    let attackRounds = 0, aceRounds = 0
    for (const seed of [11, 12, 13, 14, 15]) {
      for (const r of buildSyntheticMatch(spec(seed))) {
        const me = r.players[0]!
        if (me.side === 'attack') { attackRounds++; if (me.operatorId === ace) aceRounds++ }
      }
    }
    expect(aceRounds / attackRounds).toBeGreaterThan(0.6)
  })

  it('plays into the Live page as a simulation without touching the DB', async () => {
    const db = openDb(':memory:')
    const lobby = { cards: async (ids: string[]) => ({ cards: [] }) } as unknown as LobbyService
    const engine = new LiveEngine({ db, settings: () => DEFAULT_SETTINGS, dataset: () => BUNDLED_DATASET, me: () => p(1).profileId }, lobby, () => null)
    const seen: LiveState[] = []
    engine.on('state', (s) => seen.push(s))
    const rounds = buildSyntheticMatch(spec(3))
    expect(await engine.playRounds(rounds, 0)).toBe(true)
    expect(seen.every((s) => s.source === 'simulation')).toBe(true)
    expect(seen.at(-1)!.phase).toBe('ended')
    expect(seen.at(-1)!.siteRecs.length).toBeGreaterThan(0) // seed sites for maps without replays
    expect(db.counts().rounds).toBe(0)
  })
})
