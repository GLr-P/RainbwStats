import { describe, expect, it } from 'vitest'
import { baselineFor, needOf, recommend, type AggMap, type RecInput } from '../src/shared/recommend'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'
import { SITE_PICKS, sitePicksFor } from '../src/shared/data/sitePicks'
import { operatorByKey } from '../src/shared/catalog'
import type { Agg } from '../src/shared/types'
import type { Weights } from '../src/shared/ipc'

const id = (key: string) => operatorByKey(key)!.id
const agg = (rounds: number, wins: number, kills = rounds, deaths = rounds): Agg => ({ rounds, wins, kills, deaths, headshots: 0 })
const aggs = (o: Record<string, Agg>): AggMap => new Map(Object.entries(o).map(([k, v]) => [id(k), v]))
const W = (o: Partial<Weights> = {}): Weights => ({ personal: 1, meta: 1, site: 1, role: 1, comfort: 1, ...o })
const tiers = (map: string, site: string, side: 'attack' | 'defense') => {
  const t = sitePicksFor(map, site)![side]
  return { S: t.S.map(id), A: t.A.map(id), map: SITE_PICKS[map]!.map[side].map(id) }
}

const base = (over: Partial<RecInput> = {}): RecInput => ({
  side: 'attack', mapKey: 'bank', site: null, roster: [], mine: { overall: new Map() }, crowd: {},
  baseline: baselineFor(BUNDLED_DATASET, 'bank'), weights: W(), minRounds: 8, topN: 5, ...over
})
const names = (r: { name: string }[]) => r.map((x) => x.name)

describe('recommend: estimated win chance', () => {
  it('scores are win chances near your base and explain themselves with signed parts', () => {
    const r = recommend(base({ mine: { overall: new Map(), api: aggs({ ash: agg(200, 100), sledge: agg(200, 100) }) } }))
    expect(r.every((x) => x.score >= 15 && x.score <= 85)).toBe(true)
    expect(r[0]!.score).toBeGreaterThanOrEqual(48)
    expect(r[0]!.score).toBeLessThan(65)
    expect(r[0]!.reasons.every((s) => /[+−]\d/.test(s))).toBe(true)
  })

  it('respects roster, side and bans', () => {
    const roster = ['ace', 'thermite', 'sledge', 'mute'].map(id)
    expect(names(recommend(base({ roster, banned: [id('ace')], topN: 10 }))).sort()).toEqual(['Sledge', 'Thermite'])
  })

  it('Clubhouse CCTV on defense: Tubarão is the pick when he is in the roster', () => {
    const roster = ['tubarao', 'kaid', 'bandit', 'smoke', 'valkyrie', 'jager'].map(id)
    const r = recommend(base({ side: 'defense', mapKey: 'clubhouse', site: '2F CCTV Room, 2F Cash Room', roster, specialists: tiers('clubhouse', '2F CCTV Room, 2F Cash Room', 'defense') }))
    expect(r[0]!.name).toBe('Tubarao')
    expect(r[0]!.reasons.join(' ')).toMatch(/Site specialist \(S\)/)
  })

  it('hard breachers rank high only when the team needs one', () => {
    const roster = ['thermite', 'twitch', 'iana', 'buck'].map(id)
    const site = '1F Teller\'s Office, 1F Archives'
    const q = (cover: number) => recommend(base({ roster, site, specialists: tiers('bank', site, 'attack'), teamCover: { hb: cover } }))
    expect(q(0)[0]!.name).toBe('Thermite') // nobody brings hard breach → Thermite
    expect(q(0)[0]!.reasons.join(' ')).toMatch(/Team likely lacks hard breach/)
    const covered = q(0.95)
    expect(covered[0]!.name).not.toBe('Thermite') // a teammate already brings it
    expect(covered.find((x) => x.name === 'Thermite')!.reasons.join(' ')).toMatch(/likely covered/)
  })

  it('the hard breach / anti-breach slider at 0 removes the team-need effect', () => {
    const roster = ['kaid', 'bandit', 'smoke', 'maestro'].map(id)
    const r = recommend(base({ side: 'defense', roster, weights: W({ role: 0, site: 0, meta: 0 }), teamCover: { ah: 0 } }))
    expect(r.every((x) => !x.reasons.join(' ').includes('anti-breach'))).toBe(true)
  })

  it('your record matters: 100+ rounds at 62% beats an untested pick; 2/2 does not', () => {
    const roster = ['ash', 'sledge', 'zofia'].map(id)
    const api = aggs({ ash: agg(120, 74), sledge: agg(2, 2), zofia: agg(120, 54) })
    const r = recommend(base({ roster, mine: { overall: new Map(), api }, weights: W({ site: 0, meta: 0, role: 0, comfort: 0 }) }))
    expect(names(r)).toEqual(['Ash', 'Sledge', 'Zofia'])
    expect(r[0]!.score - r[1]!.score).toBeGreaterThanOrEqual(3)
  })

  it('needOf: unknown teams use a prior; known coverage is used directly', () => {
    expect(needOf(undefined, 'hb')).toBeCloseTo(0.8 ** 4)
    expect(needOf({ hb: 0.9 }, 'hb')).toBeCloseTo(0.1)
  })

  it('never repeats an operator, varies roles, and is deterministic', () => {
    const inp = base({ topN: 5, site: '2F Executive Lounge, 2F CEO Office', specialists: tiers('bank', '2F Executive Lounge, 2F CEO Office', 'attack') })
    const a = recommend(inp)
    expect(a).toEqual(recommend(inp))
    expect(new Set(a.map((x) => x.operatorId)).size).toBe(a.length)
    expect(new Set(a.slice(0, 3).map((x) => operatorByKey(x.name.toLowerCase().replace(/[^a-z0-9]/g, ''))!.roles[0])).size).toBeGreaterThan(1)
  })
})

describe('site unknown: expected fit over the map', () => {
  it('averages site tiers instead of calling everything "not a pick for this site"', () => {
    const mix = Object.values(SITE_PICKS['clubhouse']!.sites).map((t) => ({ S: t.defense.S.map(id), A: t.defense.A.map(id), B: [] as string[] }))
    const r = recommend(base({ side: 'defense', mapKey: 'clubhouse', roster: ['echo', 'tubarao', 'clash'].map(id), specialists: { map: SITE_PICKS['clubhouse']!.map.defense.map(id), mix }, topN: 3 }))
    expect(r.map((x) => x.reasons.join(' ')).join(' ')).not.toMatch(/for this site/)
    expect(r.find((x) => x.name === 'Echo')!.reasons.join(' ')).toMatch(/of 4 sites/)
    expect(r.at(-1)!.name).toBe('Clash')
  })
})
