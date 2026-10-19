import { describe, expect, it } from 'vitest'
import { baselineFor, recommend, type AggMap, type RecInput } from '../src/shared/recommend'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'
import { operatorByKey } from '../src/shared/catalog'
import type { Agg } from '../src/shared/types'

const id = (key: string) => operatorByKey(key)!.id
const agg = (rounds: number, wins: number, kills = rounds, deaths = rounds): Agg => ({ rounds, wins, kills, deaths, headshots: 0 })
const aggs = (o: Record<string, Agg>): AggMap => new Map(Object.entries(o).map(([k, v]) => [id(k), v]))

const base = (over: Partial<RecInput> = {}): RecInput => ({
  side: 'attack', mapKey: 'bank', site: null, roster: [], mine: { overall: new Map() }, crowd: {},
  baseline: baselineFor(BUNDLED_DATASET, 'bank'), weights: { personal: 0.4, meta: 0.35, comfort: 0.15, teamfit: 0.1, site: 0 },
  minRounds: 8, topN: 5, ...over
})

describe('recommend', () => {
  it('cold start: ranks by baseline and says so', () => {
    const r = recommend(base())
    expect(r[0]?.name).toBe('Ace')
    expect(r.every((x) => x.baseline && x.scope === 'none')).toBe(true)
    expect(r[0]?.reasons.join(' ')).toMatch(/Baseline/)
  })

  it('respects roster, side and bans', () => {
    const roster = ['ace', 'thermite', 'sledge', 'mute'].map(id)
    const r = recommend(base({ roster, banned: [id('ace')], topN: 10 }))
    expect(r.map((x) => x.name).sort()).toEqual(['Sledge', 'Thermite'])
  })

  it('site-specific performance lifts an operator on that site', () => {
    const mine = { overall: aggs({ ash: agg(40, 20), sledge: agg(40, 20) }), map: aggs({ ash: agg(10, 5), sledge: agg(10, 5) }), site: aggs({ sledge: agg(12, 11, 20, 6) }) }
    const roster = [id('ash'), id('sledge')]
    expect(recommend(base({ roster, mine, site: 'B Lockers' }))[0]?.name).toBe('Sledge')
    expect(recommend(base({ roster, mine, site: 'B Lockers' }))[0]?.scope).toBe('site')
  })

  it('shrinks tiny samples: 2/2 does not beat 30 rounds at 70%', () => {
    const mine = { overall: aggs({ ash: agg(2, 2), sledge: agg(30, 21) }) }
    const r = recommend(base({ roster: [id('ash'), id('sledge')], mine, weights: { personal: 1, meta: 0, comfort: 0, teamfit: 0, site: 0 } }))
    expect(r[0]?.name).toBe('Sledge')
  })

  it('uses crowd data over baseline once it has samples', () => {
    const crowd = { map: aggs({ ace: agg(200, 70), sledge: agg(200, 140) }) }
    const r = recommend(base({ roster: [id('ace'), id('sledge')], crowd, weights: { personal: 0, meta: 1, comfort: 0, teamfit: 0, site: 0 } }))
    expect(r[0]?.name).toBe('Sledge')
    expect(r[0]?.baseline).toBe(false)
  })

  it('team fit: suggests a hard breacher when teammates have none', () => {
    const r = recommend(base({ roster: [id('thermite'), id('glaz')], teammateOps: [id('sledge'), id('ash')], weights: { personal: 0, meta: 0, comfort: 0, teamfit: 1, site: 0 } }))
    expect(r[0]?.name).toBe('Thermite')
    expect(r[0]?.reasons.join(' ')).toMatch(/hard breach/)
  })

  it('is deterministic and bounded', () => {
    const inp = base({ topN: 40 })
    const a = recommend(inp), b = recommend(inp)
    expect(a).toEqual(b)
    expect(a.every((x) => x.score >= 0 && x.score <= 100)).toBe(true)
    expect(a.every((x) => operatorByKey(x.name.toLowerCase().replace(/[^a-z0-9]/g, ''))?.side === 'attack')).toBe(true)
  })
})

describe('role diversity', () => {
  it('never repeats an operator and avoids stacking one role', () => {
    const r = recommend(base({ topN: 5, weights: { personal: 0, meta: 1, comfort: 0, teamfit: 0, site: 0 } }))
    expect(new Set(r.map((x) => x.operatorId)).size).toBe(r.length)
    const roles = r.slice(0, 3).map((x) => operatorByKey(x.name.toLowerCase().replace(/[^a-z0-9]/g, ''))!.roles[0])
    expect(new Set(roles).size).toBeGreaterThan(1) // not three hard breachers
  })
})
