import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { CrowdSync, nextBatch, pseudonym } from '../src/main/crowd'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import { globalMeta, globalOps, recsFor, type Ctx } from '../src/main/services'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'
import { bandOf, cleanUpload, type CrowdMeta } from '../src/shared/crowd'
import { operatorByKey } from '../src/shared/catalog'
import type { RoundRecord } from '../src/shared/types'

const rounds = JSON.parse(readFileSync('test/fixtures/rounds-sample.json', 'utf8')) as RoundRecord[]
const ME = '11111111-1111-1111-1111-111111111111', OTHER = '22222222-2222-2222-2222-222222222222'

function seeded() {
  const db = openDb(':memory:')
  // A ranked (non-custom) copy of the sample match so it counts for the meta.
  for (const r of rounds) db.saveRound({ ...r, matchType: 2 })
  db.saveApiOpStats(OTHER, ['Y11S3'], [
    { season: 'Y11S3', playlist: 'ranked', opKey: 'ash', rounds: 40, wins: 22 },
    { season: 'Y11S3', playlist: 'unranked', opKey: 'ash', rounds: 99, wins: 50 }, // not shared (ranked only)
    { season: 'Y11S3', playlist: 'ranked', opKey: 'rook', rounds: 30, wins: 18 }
  ], '2026-10-19T10:00:00.000Z')
  db.saveRank({ profileId: OTHER, board: 'ranked', seasonId: 43, rank: 23, rankPoints: 3300, maxRank: 23, maxRankPoints: 3300, wins: 10, losses: 8, abandons: 0, kills: 100, deaths: 90, fetchedAt: '2026-10-19T10:00:00.000Z' })
  return db
}

describe('global crowd database', () => {
  it('maps rank ids to bands', () => {
    expect([0, 1, 5, 6, 23, 35, 36, 37].map(bandOf)).toEqual([0, 1, 1, 2, 5, 7, 8, 8])
  })

  it('validates uploads and drops malformed rows', () => {
    const ok = { p: 'a'.repeat(16), season: 'Y11S3', op: 'ash', rounds: 10, wins: 4, band: 5 }
    const out = cleanUpload({ v: 1, ops: [ok, { ...ok, wins: 11 }, { ...ok, p: 'Bob' }, { ...ok, op: 'DROP TABLE' }], rounds: [{ k: 'b'.repeat(16), season: 'Y11S3', type: 2, map: 'bank', site: 'B CCTV Room, B Lockers', side: 'defense', op: 'rook', won: 1, band: 5 }] })
    expect(out?.ops).toEqual([ok])
    expect(out?.rounds).toHaveLength(1)
    expect(cleanUpload({ v: 2, ops: [], rounds: [] })).toBeNull()
    expect(cleanUpload('junk')).toBeNull()
  })

  it('builds pseudonymous batches without names and never sends twice', () => {
    const db = seeded()
    const b = nextBatch(db, 'Y11S3')
    expect(b.body.ops.map((o) => [o.op, o.rounds, o.band]).sort()).toEqual([['ash', 40, 5], ['rook', 30, 5]])
    expect(b.body.ops[0]!.p).toBe(pseudonym(OTHER))
    expect(b.body.rounds.length).toBeGreaterThan(0)
    expect(cleanUpload(JSON.parse(JSON.stringify(b.body)))!.rounds.length).toBe(b.body.rounds.length) // server accepts all of it
    const text = JSON.stringify(b.body)
    for (const name of new Set(rounds.flatMap((r) => r.players.map((p) => p.username)))) expect(text).not.toContain(name)
    expect(text).not.toContain(OTHER)
    db.markCrowdSent(b.players, b.matches)
    const again = nextBatch(db, 'Y11S3')
    expect(again.body.ops).toHaveLength(0)
    expect(again.body.rounds).toHaveLength(0)
    // A refetch of that player's stats makes them pending again.
    db.saveApiOpStats(OTHER, ['Y11S3'], [{ season: 'Y11S3', playlist: 'ranked', opKey: 'ash', rounds: 45, wins: 25 }], '2026-10-19T13:00:00.000Z')
    expect(nextBatch(db, 'Y11S3').body.ops).toEqual([{ p: pseudonym(OTHER), season: 'Y11S3', op: 'ash', rounds: 45, wins: 25, band: 5 }])
  })

  it('uploads only when sharing, downloads for everyone', async () => {
    const db = seeded()
    const posts: unknown[] = []
    const meta: CrowdMeta = { season: 'Y11S3', generatedAt: 1, players: 40, ops: [['ash', 5, 400, 220, 40]], rounds: 0, sites: [] }
    const fakeFetch = (async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') { posts.push(JSON.parse(init.body!)); return new Response('{"ok":true}') }
      return new Response(JSON.stringify(meta))
    }) as unknown as typeof fetch
    let share = false
    const sync = new CrowdSync(db, { url: () => 'https://x', season: () => 'Y11S3', enabled: () => share, fetch: fakeFetch })
    expect(await sync.tick()).toBe(true)
    expect(posts).toHaveLength(0)
    expect(sync.meta()?.players).toBe(40)
    share = true
    await sync.tick()
    expect(posts).toHaveLength(1)
    await sync.tick()
    expect(posts).toHaveLength(1) // nothing new
  })

  it('feeds recommendations and the Global view', () => {
    const db = seeded()
    const ash = operatorByKey('ash')!.id
    const g: CrowdMeta = {
      season: 'Y11S3', generatedAt: 1, players: 300,
      ops: [['ash', 5, 30000, 18000, 300], ['sledge', 5, 30000, 12000, 300], ['ash', 3, 100, 40, 10]],
      rounds: 2000, sites: [['bank', 'B CCTV Room, B Lockers', 'attack', 'ash', 1000, 650]]
    }
    const ctx: Ctx = { db, settings: () => DEFAULT_SETTINGS, dataset: () => BUNDLED_DATASET, me: () => ME, crowd: () => g }
    expect(globalOps(g, 5).get('ash')).toEqual({ rounds: 30000, wins: 18000, players: 300 })
    expect(globalOps(g).get('ash')?.rounds).toBe(30100)
    const recs = recsFor(ctx, { mapKey: 'bank', side: 'attack', site: 'B CCTV Room, B Lockers', topN: 40, anyOperator: true })
    expect(recs.find((r) => r.operatorId === ash)?.reasons.join(' ')).toMatch(/Meta here: 65% WR \(1000 rds\)/)
    const view = globalMeta(ctx, { band: 5 }, { sharing: false, lastError: null, lastUpload: null })
    expect(view.scope).toBe('career')
    expect(view.players).toBe(300)
    expect(view.rows.find((r) => r.opKey === 'ash')?.rounds).toBe(30000)
    const site = globalMeta(ctx, { mapKey: 'bank' }, { sharing: false, lastError: null, lastUpload: null })
    expect(site.scope).toBe('replays')
    expect(site.sites).toEqual(['B CCTV Room, B Lockers'])
  })
})
