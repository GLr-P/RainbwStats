import { describe, expect, it } from 'vitest'
import { SITE_PICKS, sitePicksFor } from '../src/shared/data/sitePicks'
import { SEED_SITES } from '../src/shared/data/maps'
import { operatorByKey } from '../src/shared/catalog'
import { recommend, baselineFor } from '../src/shared/recommend'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'

describe('site specialists', () => {
  it('only names real operators on the right side, for every seeded site', () => {
    for (const [map, m] of Object.entries(SITE_PICKS)) {
      for (const picks of [m.map, ...Object.values(m.sites)]) {
        for (const k of picks.attack) expect(operatorByKey(k)?.side, `${map}: ${k}`).toBe('attack')
        for (const k of picks.defense) expect(operatorByKey(k)?.side, `${map}: ${k}`).toBe('defense')
      }
      for (const site of SEED_SITES[map] ?? []) expect(sitePicksFor(map, site), `${map}: ${site}`).toBeDefined()
    }
  })

  it('matches replay site names that differ slightly from the curated names', () => {
    expect(sitePicksFor('clubhouse', 'B Church, B Arsenal')).toBe(SITE_PICKS['clubhouse']!.sites['B Church, B Arsenal Room'])
    expect(sitePicksFor('nope', 'x')).toBeUndefined()
  })

  it('makes recommendations differ between sites even for a player with strong mains', () => {
    const id = (k: string) => operatorByKey(k)!.id
    // Strong personal record on Azami/Smoke/Aruni (the reported "same 3 everywhere" case).
    const api = new Map([['azami', 48, 30], ['smoke', 21, 16], ['aruni', 53, 30]].map(([k, r, w]) => [id(k as string), { rounds: r as number, wins: w as number, kills: 0, deaths: 0, headshots: 0 }]))
    const top = (site: string) => recommend({
      side: 'defense', mapKey: 'clubhouse', site, roster: [], mine: { overall: new Map(), api }, crowd: {},
      baseline: baselineFor(BUNDLED_DATASET, 'clubhouse'), weights: { personal: 0.35, meta: 0.2, comfort: 0.1, teamfit: 0.1, site: 0.25 },
      specialists: { map: SITE_PICKS['clubhouse']!.map.defense.map(id), site: sitePicksFor('clubhouse', site)!.defense.map(id) }, minRounds: 8, topN: 3
    }).map((r) => r.name)
    const sets = SEED_SITES['clubhouse']!.map(top)
    expect(new Set(sets.map((s) => s.join())).size).toBeGreaterThan(2) // different top 3 on most sites
    expect(sets.flat()).toContain('Echo') // basement specialist shows up
  })
})
