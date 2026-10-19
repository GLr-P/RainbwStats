import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import type { RoundRecord } from '../src/shared/types'

const rounds = JSON.parse(readFileSync('test/fixtures/rounds-sample.json', 'utf8')) as RoundRecord[]
const me = rounds[0]!.recordingProfileId

describe('db', () => {
  it('stores rounds idempotently', () => {
    const db = openDb(':memory:')
    for (const r of rounds) db.saveRound(r)
    for (const r of rounds) db.saveRound(r)
    expect(db.counts()).toEqual({ rounds: 6, matches: 1, players: 6 })
  })

  it('aggregates per operator for one player and for everyone', () => {
    const db = openDb(':memory:')
    for (const r of rounds) db.saveRound(r)
    const mine = db.opAggs({ profileId: me })
    expect([...mine.values()].reduce((n, a) => n + a.rounds, 0)).toBe(6)
    const all = db.opAggs({ mapKey: 'plane', side: 'defense' })
    const total = [...all.values()].reduce((n, a) => n + a.rounds, 0)
    expect(total).toBe(rounds.flatMap((r) => r.players).filter((p) => p.side === 'defense').length)
    expect(db.sites('plane').length).toBe(3)
  })

  it('round-trips a match and rank history', () => {
    const db = openDb(':memory:')
    for (const r of rounds) db.saveRound(r)
    expect(db.roundsOfMatch('fixture-match-1')).toEqual(rounds)
    const snap = { profileId: me, board: 'ranked', seasonId: 43, rank: 20, rankPoints: 3100, maxRank: 21, maxRankPoints: 3250, wins: 10, losses: 8, abandons: 0, kills: 100, deaths: 90 }
    db.saveRank({ ...snap, fetchedAt: '2026-10-01T00:00:00Z' })
    db.saveRank({ ...snap, rankPoints: 3200, fetchedAt: '2026-10-02T00:00:00Z' })
    expect(db.rankHistory(me)).toEqual([{ ...snap, rankPoints: 3200, fetchedAt: '2026-10-02T00:00:00Z' }])
  })
})
