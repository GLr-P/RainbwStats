import { describe, expect, it } from 'vitest'
import { SITE_PICKS, sitePicksFor } from '../src/shared/data/sitePicks'
import { SEED_SITES } from '../src/shared/data/maps'
import { operatorByKey } from '../src/shared/catalog'

describe('site tiers', () => {
  it('only names real operators on the right side, with S and A tiers for every seeded site', () => {
    for (const [map, m] of Object.entries(SITE_PICKS)) {
      for (const k of m.map.attack) expect(operatorByKey(k)?.side, `${map}: ${k}`).toBe('attack')
      for (const k of m.map.defense) expect(operatorByKey(k)?.side, `${map}: ${k}`).toBe('defense')
      for (const [site, t] of Object.entries(m.sites)) {
        for (const k of [...t.attack.S, ...t.attack.A]) expect(operatorByKey(k)?.side, `${map}/${site}: ${k}`).toBe('attack')
        for (const k of [...t.defense.S, ...t.defense.A]) expect(operatorByKey(k)?.side, `${map}/${site}: ${k}`).toBe('defense')
        expect(t.attack.S.length && t.attack.A.length && t.defense.S.length && t.defense.A.length, `${map}/${site}`).toBeGreaterThan(0)
      }
      for (const site of SEED_SITES[map] ?? []) expect(sitePicksFor(map, site), `${map}: ${site}`).toBeDefined()
    }
  })

  it('matches replay site names that differ slightly from the curated names', () => {
    expect(sitePicksFor('clubhouse', 'B Church, B Arsenal')).toBe(SITE_PICKS['clubhouse']!.sites['B Church, B Arsenal Room'])
    expect(sitePicksFor('nope', 'x')).toBeUndefined()
    expect(sitePicksFor('clubhouse', '2F CCTV Room, 2F Cash Room')!.defense.S).toContain('tubarao')
  })
})
