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
  it('updates state within budget for each new round file', async () => {
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
