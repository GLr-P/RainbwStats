import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'
import { buildLive, matchOver, predictSide } from '../src/main/live/state'
import { LiveEngine } from '../src/main/live/engine'
import { listRoundFiles } from '../src/main/replay/ingest'
import type { Ctx } from '../src/main/services'
import type { LobbyService } from '../src/main/ubi/lobby'
import type { LiveState } from '../src/shared/ipc'
import type { RoundRecord } from '../src/shared/types'

const rounds = JSON.parse(readFileSync('test/fixtures/rounds-sample.json', 'utf8')) as RoundRecord[]
const ctxFor = (db = openDb(':memory:'), me: string | null = null): Ctx => ({ db, settings: () => DEFAULT_SETTINGS, dataset: () => BUNDLED_DATASET, me: () => me ?? db.mostCommonRecorder() })

describe('live state', () => {
  it('predicts sides: swap at half, alternate in overtime', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => predictSide('attack', n, 6))).toEqual(['attack', 'attack', 'attack', 'defense', 'defense', 'defense', 'attack', 'defense'])
  })
  it('detects match end in regulation and overtime', () => {
    expect(matchOver([4, 2], 6, 3)).toBe(true)
    expect(matchOver([3, 2], 6, 3)).toBe(false)
    expect(matchOver([4, 3], 6, 3)).toBe(false) // overtime: needs 5
    expect(matchOver([5, 3], 6, 3)).toBe(true)
  })
  it('builds the full picture from recorded rounds', () => {
    const db = openDb(':memory:')
    for (const r of rounds) db.saveRound(r)
    const s = buildLive(ctxFor(db), rounds, { gameRunning: true, roundsPerMatch: 6, overtimeRounds: 3 })
    expect(s.score).toEqual([2, 4])
    expect(s.phase).toBe('ended')
    expect(s.mapKey).toBe('plane')
    expect(s.myTeam.length).toBe(3)
    expect(s.enemyTeam.length).toBe(3)
    expect(s.myTeam[0]?.isMe).toBe(true)
    expect(s.myTeam[0]?.ops.length).toBe(6)
    expect(s.rounds.map((r) => r.won)).toEqual([false, false, false, true, true, false])
    expect(s.recommendations.length).toBe(3)
    expect(s.siteRecs.length).toBe(3)
  })
  it('mid-match: predicts next side and recommends for it', () => {
    const db = openDb(':memory:')
    for (const r of rounds.slice(0, 3)) db.saveRound(r)
    const s = buildLive(ctxFor(db), rounds.slice(0, 3), { gameRunning: true, roundsPerMatch: 6, overtimeRounds: 3 })
    expect(s.phase).toBe('match')
    expect(s.nextRound).toBe(4)
    expect(s.side).toBe('defense')
    expect(s.recommendations.every((r) => r.reasons.length > 0)).toBe(true)
  })
})

const LOCAL = 'test/fixtures/local'
const hasLocal = existsSync(LOCAL) && listRoundFiles(LOCAL).length > 0

describe.runIf(hasLocal)('live engine (simulated replay drops)', () => {
  it('updates state within budget for each new round file', { retry: 2 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'rs-live-'))
    const matchDir = join(root, 'Match-2026-09-05_22-06-37-27632')
    mkdirSync(matchDir)
    const db = openDb(':memory:')
    const lobby = { cards: async (ids: string[]) => ({ cards: ids.map((id) => ({ profileId: id, name: '', loaded: false, level: null, hoursPlayed: null, ranked: null, season: null })) }) } as unknown as LobbyService
    const engine = new LiveEngine(ctxFor(db), lobby, () => root)
    engine.start()
    await new Promise((r) => setTimeout(r, 300))
    const times: number[] = []
    for (const f of listRoundFiles(LOCAL).slice(0, 3)) {
      const t0 = performance.now()
      const got = new Promise<LiveState>((resolve) => {
        const on = (s: LiveState) => { if (s.rounds.length && s.nextRound === times.length + 2) { engine.off('state', on); resolve(s) } }
        engine.on('state', on)
      })
      copyFileSync(f, join(matchDir, basename(f)))
      const s = await got
      times.push(performance.now() - t0)
      expect(s.mapKey).toBe('plane')
    }
    engine.stop()
    expect(engine.state.score).toEqual([0, 3])
    expect(Math.max(...times)).toBeLessThan(600) // 120 ms debounce + parse + build; budget 300 ms excluding fs-event latency
    console.log('file → state ms:', times.map((t) => t.toFixed(0)).join(', '))
  })
})

describe('match simulation', () => {
  it('steps loading → match per round → ended, with lobby cards', async () => {
    const db = openDb(':memory:')
    for (const r of rounds) db.saveRound(r)
    const lobby = { cards: async (ids: string[]) => ({ cards: ids.map((id) => ({ profileId: id, name: '', loaded: true, level: 1, hoursPlayed: 1, ranked: null, season: null })) }) } as unknown as LobbyService
    const engine = new LiveEngine(ctxFor(db), lobby, () => null)
    const seen: string[] = []
    engine.on('state', (s) => seen.push(`${s.phase}:${s.rounds.length}`))
    expect(await engine.simulate(0)).toBe(true)
    expect(seen[0]).toBe('loading:0')
    expect(seen).toContain('match:1')
    expect(seen.at(-1)).toBe('ended:6')
    expect(engine.state.myTeam[0]?.card?.loaded).toBe(true)
    expect(engine.state.mapKey).toBe('plane')
  })
})

describe('learned side swaps', () => {
  it('learns when sides swap from recorded matches and uses it for the next round', async () => {
    const { learnSwaps, nextSide } = await import('../src/main/live/state')
    // A format that swaps every 2 rounds (not the "half time" rule), seen in 3 ranked matches.
    const seq = (id: string) => ['attack', 'attack', 'defense', 'defense', 'attack', 'attack'].map((side, i) => ({ matchId: id, type: 2, round: i + 1, side: side as 'attack' | 'defense' }))
    const learned = learnSwaps([...seq('a'), ...seq('b'), ...seq('c'), ...seq('custom').map((x) => ({ ...x, type: 4, side: 'attack' as const }))])
    expect(learned.get(3)).toEqual({ swaps: 3, n: 3 })
    expect(nextSide(['attack', 'attack'], 3, 6, learned)).toBe('defense')
    expect(nextSide(['attack', 'attack', 'defense', 'defense'], 5, 6, learned)).toBe('attack') // the half-time rule would say defense
    expect(nextSide(['attack', 'attack', 'attack'], 4, 6, new Map())).toBe('defense') // no history: format rule
  })
  it('notices a match that swaps every round, from the match itself', async () => {
    const { nextSide } = await import('../src/main/live/state')
    expect(nextSide(['attack'], 2, 6, new Map())).toBe('attack') // rule: same side until round 4
    expect(nextSide(['attack', 'defense'], 3, 6, new Map())).toBe('attack') // swapped after round 1 → alternating
    expect(nextSide(['attack', 'defense', 'attack'], 4, 6, new Map())).toBe('defense')
    expect(nextSide(['defense', 'defense', 'defense', 'attack', 'attack'], 6, 6, new Map())).toBe('attack') // normal half-time match
  })
  it('learns per match type', async () => {
    const { learnSwaps } = await import('../src/main/live/state')
    const m = (id: string, type: number, sides: string[]) => sides.map((side, i) => ({ matchId: id, type, round: i + 1, side: side as 'attack' | 'defense' }))
    const seqs = [...m('r1', 2, ['attack', 'attack', 'defense']), ...m('q1', 12, ['attack', 'defense', 'attack'])]
    expect(learnSwaps(seqs, 12).get(2)).toEqual({ swaps: 1, n: 1 })
    expect(learnSwaps(seqs, 2).get(2)).toEqual({ swaps: 0, n: 1 })
  })
})

describe('next match after one that never looked finished', () => {
  const unfinished = async () => {
    const db = openDb(':memory:')
    for (const r of rounds.slice(0, 3)) db.saveRound(r) // 2 rounds won by the enemy, 1 by us: not over by the 6-round rule
    const lobby = { cards: async () => ({ cards: [] }) } as unknown as LobbyService
    const engine = new LiveEngine(ctxFor(db), lobby, () => null)
    ;(engine as unknown as { gameRunning: boolean }).gameRunning = true
    await (engine as unknown as { showMatch(id: string, live: boolean): Promise<void> }).showMatch(rounds[0]!.matchId, true)
    expect(engine.state.phase).toBe('match')
    return engine
  }
  it('ends it when the main menu is seen, so round 1 of the next match shows', async () => {
    const engine = await unfinished()
    engine.sawMenu()
    expect(engine.state.phase).toBe('ended')
    engine.setDetected({ mapKey: 'bank', side: 'attack' }, false)
    expect(engine.state).toMatchObject({ mapKey: 'bank', side: 'attack', phase: 'loading' })
  })
  it('ends it when a different map is read well after the last round', async () => {
    const engine = await unfinished()
    ;(engine as unknown as { lastRoundAt: number }).lastRoundAt = Date.now()
    engine.setDetected({ mapKey: 'bank' }, false) // last round "just now": treated as a misread
    expect(engine.state.mapKey).toBe('plane')
    ;(engine as unknown as { lastRoundAt: number }).lastRoundAt = Date.now() - 5 * 60_000
    engine.setDetected({ mapKey: 'bank', side: 'defense' }, false)
    expect(engine.state).toMatchObject({ mapKey: 'bank', side: 'defense' })
  })
})

describe('side during a match', () => {
  it('comes from the recorded rounds, not from screen reading', async () => {
    const db = openDb(':memory:')
    for (const r of rounds.slice(0, 3)) db.saveRound(r)
    const engine = new LiveEngine(ctxFor(db), { cards: async () => ({ cards: [] }) } as unknown as LobbyService, () => null)
    ;(engine as unknown as { gameRunning: boolean }).gameRunning = true
    await (engine as unknown as { showMatch(id: string, live: boolean): Promise<void> }).showMatch(rounds[0]!.matchId, true)
    const predicted = engine.state.side
    ;(engine as unknown as { lastRoundAt: number }).lastRoundAt = Date.now()
    engine.setDetected({ side: predicted === 'attack' ? 'defense' : 'attack', site: null }, false)
    expect(engine.state.side).toBe(predicted)
  })
})

describe('side prediction self-check', () => {
  it('scores predictions on recorded matches (alternating and half-time formats)', async () => {
    const { sidePredictionAccuracy } = await import('../src/main/live/state')
    const m = (id: string, sides: string[], type = 2) => sides.map((side, i) => ({ matchId: id, type, round: i + 1, side: side as 'attack' | 'defense' }))
    const half = ['attack', 'attack', 'attack', 'defense', 'defense', 'defense']
    expect(sidePredictionAccuracy([...m('a', half), ...m('b', half), ...m('c', half), ...m('d', half)])).toEqual({ correct: 20, total: 20 })
    const alt = ['attack', 'defense', 'attack', 'defense', 'attack', 'defense']
    const r = sidePredictionAccuracy([...m('a', alt, 12), ...m('b', alt, 12), ...m('c', alt, 12), ...m('d', alt, 12)])
    expect(r.correct / r.total).toBeGreaterThan(0.9)
  })
})

describe('ranked side rule', () => {
  it('3 rounds per side, swap, overtime swaps every round, whatever the header or history says', async () => {
    const { sideFor, RANKED_TYPE } = await import('../src/main/live/state')
    const misleading = () => new Map([[2, { swaps: 9, n: 9 }], [3, { swaps: 9, n: 9 }]]) // "swaps every round" history
    const seq = (first: 'attack' | 'defense', upTo: number) => {
      const out: string[] = []
      for (let r = 1; r <= upTo; r++) out.push(sideFor(RANKED_TYPE, out.length ? [first] : [first], r, 12, misleading)) // header says 12
      return out
    }
    expect(seq('attack', 9)).toEqual(['attack', 'attack', 'attack', 'defense', 'defense', 'defense', 'attack', 'defense', 'attack'])
    expect(seq('defense', 6)).toEqual(['defense', 'defense', 'defense', 'attack', 'attack', 'attack'])
  })
})
