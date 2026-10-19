import { describe, expect, it } from 'vitest'
import { parseOperatorStats, UbiClient, type StoredAuth } from '../src/main/ubi/client'
import { OpStatsSync } from '../src/main/ubi/opsync'
import { openDb } from '../src/main/db'
import { STATS_OPERATORS, SEASON_CALENDAR } from '../src/shared/data/statsIds'
import { recommend } from '../src/shared/recommend'
import { baselineFor } from '../src/shared/recommend'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'
import { operatorByKey } from '../src/shared/catalog'

const hexOf = (key: string) => Object.entries(STATS_OPERATORS).find(([, o]) => o.key === key)![0]
const opKeyOf = (hex: string) => STATS_OPERATORS[hex]?.key
const ME = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const k = (kind: 'Played' | 'Won', pl: string, key: string, seasonal = false) =>
  `Round${kind}OperatorConsolePlaylist${seasonal ? 'Seasonal' : ''}.console.false.playlist.${pl}.CLASS.${hexOf(key)}`
const v = (n: number) => ({ value: String(n), startDate: '2024-08-22T00:00:00Z', endDate: null, obj: {} })

const body = (seasonal = false) => ({
  profiles: [
    { profileId: ME, stats: {
      [k('Played', 'MATCHMAKING_PVP_RANKED', 'ace', seasonal)]: v(100), [k('Won', 'MATCHMAKING_PVP_RANKED', 'ace', seasonal)]: v(60),
      [k('Played', 'MATCHMAKING_PVP_CASUAL', 'ace', seasonal)]: v(10), [k('Won', 'MATCHMAKING_PVP_CASUAL', 'ace', seasonal)]: v(4),
      [k('Played', 'MATCHMAKING_PVP_RANKED', 'mute', seasonal)]: v(50), [k('Won', 'MATCHMAKING_PVP_RANKED', 'mute', seasonal)]: v(20),
      'RoundPlayedOperatorConsolePlaylist.console.false.playlist.MATCHMAKING_PVP_RANKED.CLASS.FFFFFFFFFFFFFFFF': v(5),
      'MatchesPlayedConsolePlaylist.console.false.playlist.MATCHMAKING_PVP_RANKED': v(213)
    } },
    { profileId: P2, stats: { [k('Played', 'MATCHMAKING_PVP_RANKED', 'thermite', seasonal)]: v(80), [k('Won', 'MATCHMAKING_PVP_RANKED', 'thermite', seasonal)]: v(50) } }
  ]
})

describe('Ubisoft Career operator stats', () => {
  it('parses per-operator rounds/wins per playlist and drops unknown ids', () => {
    const rows = parseOperatorStats(body(), 'all', opKeyOf)
    expect(rows).toContainEqual({ profileId: ME, season: 'all', playlist: 'ranked', opKey: 'ace', rounds: 100, wins: 60 })
    expect(rows).toContainEqual({ profileId: ME, season: 'all', playlist: 'quick', opKey: 'ace', rounds: 10, wins: 4 })
    expect(rows).toContainEqual({ profileId: P2, season: 'all', playlist: 'ranked', opKey: 'thermite', rounds: 80, wins: 50 })
    expect(rows.length).toBe(4)
    expect(parseOperatorStats(body(true), 'Y11S3', opKeyOf)[0]?.season).toBe('Y11S3')
    expect(parseOperatorStats(null, 'all', opKeyOf)).toEqual([])
  })

  it('syncs your history once per past season, and lobbies in 2 batched requests', async () => {
    const urls: string[] = []
    const f = (async (url: string) => {
      urls.push(String(url))
      if (String(url).endsWith('/sessions')) return new Response(JSON.stringify({ ticket: 't', sessionId: 's', expiration: '2099-01-01T00:00:00Z', profileId: ME }))
      return new Response(JSON.stringify(body(String(url).includes('calendarEntryId'))))
    }) as typeof fetch
    let saved: StoredAuth = {}
    const ubi = new UbiClient({ fetch: f, now: () => Date.parse('2026-10-19T00:00:00Z'), loadAuth: () => saved, saveAuth: (a) => { saved = a }, loadCredentials: () => ({ email: 'a', password: 'b' }) })
    const db = openDb(':memory:')
    const sync = new OpStatsSync(ubi, db, () => 'Y11S3', () => Date.parse('2026-10-19T00:00:00Z'))
    expect(await sync.syncMine(ME)).toBe(true)
    const statsCalls = () => urls.filter((u) => u.includes('/v1/profiles/stats')).length
    const seasonsBefore = Object.keys(SEASON_CALENDAR).length // lifetime + every season incl. current
    const pastRanks = seasonsBefore - 1 // one-time "rank at end of season" per past season
    expect(statsCalls()).toBe(1 + seasonsBefore + pastRanks)
    expect(urls.filter((u) => u.includes('RankingRankSeasonal'))).toHaveLength(pastRanks)
    await sync.syncMine(ME)
    expect(statsCalls()).toBe(1 + seasonsBefore + pastRanks) // all fresh / immutable: no new requests
    const before = statsCalls()
    await sync.syncPlayers([ME, P2, 'name:bot'])
    expect(statsCalls() - before).toBe(2) // lifetime + current season, each one batched request (ME already fresh)
    expect(db.apiOpAggs({ profileId: P2, season: 'all' }).get('thermite')).toMatchObject({ rounds: 80, wins: 50 })
    expect(db.apiPlayerCount('all', ME)).toBe(1)
  })

  it('personalizes picks from Ubisoft stats when there are no replays', () => {
    const id = (key: string) => operatorByKey(key)!.id
    const api = new Map([[id('sledge'), { rounds: 300, wins: 195, kills: 0, deaths: 0, headshots: 0 }], [id('ace'), { rounds: 300, wins: 120, kills: 0, deaths: 0, headshots: 0 }]])
    const r = recommend({
      side: 'attack', mapKey: 'bank', site: null, roster: [id('ace'), id('sledge')], mine: { overall: new Map(), api }, crowd: {},
      baseline: baselineFor(BUNDLED_DATASET, 'bank'), weights: { personal: 1, meta: 0, comfort: 0, role: 0, site: 0 }, minRounds: 8, topN: 2
    })
    expect(r[0]?.name).toBe('Sledge')
    expect(r[0]?.reasons[0]).toMatch(/65% in 300 rds \(all your games\)/)
  })
})
