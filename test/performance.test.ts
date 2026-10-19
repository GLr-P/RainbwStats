import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openDb, type RankSnapshot } from '../src/main/db'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'
import { mergeHistory, performance, replayMatch, sessionOf } from '../src/main/performance'
import type { Ctx } from '../src/main/services'
import type { MatchRow } from '../src/shared/ipc'
import type { RoundRecord } from '../src/shared/types'

const rounds = JSON.parse(readFileSync('test/fixtures/rounds-sample.json', 'utf8')) as RoundRecord[]
const me = rounds[0]!.recordingProfileId
const snap = (at: string, wins: number, losses: number, rp: number, abandons = 0): RankSnapshot => ({
  profileId: me, board: 'ranked', seasonId: 43, rank: 21, rankPoints: rp, maxRank: 22, maxRankPoints: 3400, wins, losses, abandons, kills: 0, deaths: 0, fetchedAt: at
})
const ranked = (m: MatchRow, at: string): MatchRow => ({ ...m, kind: 'Ranked', at })

describe('performance / match history', () => {
  it('summarises a replay match from your point of view', () => {
    const m = replayMatch(rounds, me)!
    expect(m.score).toEqual([2, 4])
    expect(m.result).toBe('loss')
    expect(m.rounds).toHaveLength(6)
    expect(m.ops.length).toBeGreaterThan(0)
    expect(m.rounds[0]!.opKey).toBeTruthy()
  })

  it('attaches RP to the replay game in the window, and adds ranked games without replays', () => {
    const base = replayMatch(rounds, me)!
    const history = mergeHistory([ranked(base, '2026-10-20T15:20:00Z')], [
      snap('2026-10-20T14:00:00Z', 10, 8, 3000),
      snap('2026-10-20T14:50:00Z', 10, 8, 3000), // unchanged: collapsed
      snap('2026-10-20T15:30:00Z', 10, 9, 2978), // the replay game: a loss, −22
      snap('2026-10-20T16:10:00Z', 11, 9, 3001), // a game without a replay: win +23
      snap('2026-10-20T19:00:00Z', 13, 10, 3040) // three games between checks
    ])
    expect(history.map((m) => [m.source, m.result, m.rpDelta])).toEqual([
      ['rank', 'unknown', 39], ['rank', 'win', 23], ['both', 'loss', -22]
    ])
    expect(history[0]!.games).toEqual({ wins: 2, losses: 1, abandons: 0 })
    const s = sessionOf(history, Date.parse('2026-10-20T19:30:00Z'))!
    expect(s.active).toBe(true)
    expect([s.matches, s.wins, s.losses, s.rpDelta]).toEqual([5, 3, 2, 40])
    expect(s.rounds).toBe(6)
    // A 3h+ gap starts a new session.
    expect(sessionOf(history, Date.parse('2026-10-21T09:00:00Z'))!.active).toBe(false)
  })

  it('builds the whole page from the database', () => {
    const db = openDb(':memory:')
    for (const r of rounds) db.saveRound(r)
    db.saveRank(snap('2026-10-20T14:00:00Z', 10, 8, 3000))
    db.saveRank(snap('2026-10-20T16:10:00Z', 11, 8, 3023))
    db.saveApiOpStats(me, ['Y11S3'], [{ season: 'Y11S3', playlist: 'ranked', opKey: 'ash', rounds: 40, wins: 25 }, { season: 'Y11S3', playlist: 'ranked', opKey: 'rook', rounds: 30, wins: 12 }], '2026-10-20T14:00:00Z')
    const ctx: Ctx = { db, settings: () => DEFAULT_SETTINGS, dataset: () => BUNDLED_DATASET, me: () => me }
    const p = performance(ctx, true, Date.parse('2026-10-20T17:00:00Z'))
    expect(p.rank?.rankPoints).toBe(3023)
    expect(p.rpHistory.map((x) => x.rp)).toEqual([3000, 3023])
    expect(p.matches.some((m) => m.source === 'rank' && m.rpDelta === 23)).toBe(true)
    expect(p.sides.attack).toEqual({ rounds: 40, wins: 25 })
    expect(p.maps[0]?.mapKey).toBe('plane')
    expect(p.session?.active).toBe(true)
  })
})
