import { describe, expect, it } from 'vitest'
import { coach, type CoachInput, type CoachOp } from '../src/shared/coach'
import type { MatchRow } from '../src/shared/ipc'

const op = (opKey: string, side: CoachOp['side'], rounds: number, wins: number): CoachOp => ({ opKey, name: opKey[0]!.toUpperCase() + opKey.slice(1), side, rounds, wins })
const peers = new Map([['kali', { rounds: 800, wins: 400 }], ['fuze', { rounds: 900, wins: 450 }], ['smoke', { rounds: 800, wins: 400 }], ['azami', { rounds: 900, wins: 450 }], ['glaz', { rounds: 400, wins: 200 }]])
const base = (over: Partial<CoachInput> = {}): CoachInput => ({
  season: 'Y11S3', prevSeason: 'Y11S2', ops: [], prevOps: [], peers, peerLabel: 'Gold players', matches: [], maps: [], mapName: (k) => k, ...over
})

describe('coach', () => {
  it('says nothing without enough data', () => {
    expect(coach(base({ ops: [op('kali', 'attack', 5, 1), op('azami', 'defense', 5, 4)] }))).toEqual([])
  })

  it('flags the weaker side, a losing operator with a better same-side pick, and a strong operator gone unplayed', () => {
    const tips = coach(base({
      ops: [op('kali', 'attack', 40, 15), op('fuze', 'attack', 40, 20), op('azami', 'defense', 60, 33)],
      prevOps: [op('kali', 'attack', 50, 23), op('glaz', 'attack', 25, 17), op('fuze', 'attack', 60, 30), op('smoke', 'defense', 20, 15), op('azami', 'defense', 60, 33)]
    }))
    const ids = tips.map((t) => t.id)
    expect(ids).toContain('side')
    expect(tips.find((t) => t.id === 'side')!.title).toMatch(/^Attack/)
    const drop = tips.find((t) => t.id === 'drop:kali')!
    expect(drop.detail).toContain('42% of 90 rounds')
    expect(drop.detail).toContain('Glaz')
    expect(ids).toContain('play:smoke')
    // Played and average: no tip either way.
    expect(ids.some((i) => i.endsWith(':fuze') || i.endsWith(':azami'))).toBe(false)
  })

  it('does not turn a short lucky run into advice', () => {
    const tips = coach(base({ prevOps: [op('glaz', 'attack', 6, 6)], ops: [op('kali', 'attack', 8, 1)] }))
    expect(tips).toEqual([])
  })

  it('offers roster actions: remove a losing operator, add a strong one', () => {
    const tips = coach(base({
      ops: [op('kali', 'attack', 40, 15), op('fuze', 'attack', 40, 20), op('azami', 'defense', 60, 33)],
      prevOps: [op('kali', 'attack', 50, 23), op('glaz', 'attack', 25, 17), op('smoke', 'defense', 20, 15)]
    }))
    expect(tips.find((t) => t.id === 'drop:kali')!.action).toEqual({ side: 'attack', opKey: 'kali', add: false })
    expect(tips.find((t) => t.id === 'play:smoke')!.action).toEqual({ side: 'defense', opKey: 'smoke', add: true })
  })

  it('finds a defense site you keep losing and long sittings that go badly', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1) + h * 3600_000).toISOString()
    const r = (site: string, won: boolean) => ({ round: 1, side: 'defense' as const, site, op: 'Smoke', opKey: 'smoke', won, kills: 1, died: false })
    // 4 sittings of 6 games: the first three won, the rest lost. Every game has 2 rounds at Lockers (lost) and 2 at Tellers (won).
    const matches: MatchRow[] = Array.from({ length: 24 }, (_, i) => ({
      id: `m${i}`, at: at(Math.floor(i / 6) * 24 + (i % 6) * 0.5), kind: 'Ranked', source: 'replay', mapKey: 'border', result: i % 6 < 3 ? 'win' : 'loss',
      score: [2, 2], rpDelta: null, rankAfter: null, kills: 4, deaths: 0, headshots: 0, ops: ['Smoke'],
      rounds: [r('Lockers', false), r('Lockers', false), r('Tellers', true), r('Tellers', true)]
    }) as MatchRow).reverse()
    const tips = coach(base({ matches, mapName: (k) => k[0]!.toUpperCase() + k.slice(1) }))
    const site = tips.find((t) => t.kind === 'site')!
    expect(site.title).toBe('Learn the Lockers setup on Border')
    expect(site.detail).toContain('0% of 48 defense rounds')
    expect(tips.find((t) => t.id === 'fatigue')!.detail).toContain('100% of the first three games of a sitting and 0% from the fourth game on (12 games)')
  })

  it('uses replays for survival, the worst map and tilt', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 1) + h * 3600_000).toISOString()
    const round = (won: boolean, died: boolean, kills = 0) => ({ round: 1, side: 'attack' as const, site: '', op: 'Fuze', opKey: 'fuze', won, kills, died })
    // 21 games in 7-game sittings: W W W L L L L. Each game after two losses is lost (6 times); 43% overall.
    const matches: MatchRow[] = Array.from({ length: 21 }, (_, i) => {
      const result = i % 7 < 3 ? 'win' : 'loss'
      const rounds = Array.from({ length: 6 }, (_, j) => (j < 2 ? round(true, false, 1) : round(false, true)))
      return { id: `m${i}`, at: at(Math.floor(i / 7) * 24 + (i % 7) * 0.4), kind: 'Ranked', source: 'replay', mapKey: 'border', result, score: [2, 4], rpDelta: null, rankAfter: null, kills: 2, deaths: 4, headshots: 0, ops: ['Fuze'], rounds } as MatchRow
    }).reverse()
    const maps = [
      { mapKey: 'border', matches: 4, wins: 0, rounds: 24, roundWins: 4 },
      { mapKey: 'bank', matches: 4, wins: 3, rounds: 24, roundWins: 14 },
      { mapKey: 'clubhouse', matches: 4, wins: 3, rounds: 24, roundWins: 14 }
    ]
    const tips = coach(base({ matches, maps }))
    const ids = tips.map((t) => t.id)
    expect(tips.find((t) => t.id === 'survive')!.detail).toContain('100% of rounds when you survive and 0% when you die')
    expect(ids).toContain('map:border')
    expect(tips.find((t) => t.id === 'tilt')!.detail).toContain('you win 0% of the next game (6 times), against 43% overall')
  })
})
