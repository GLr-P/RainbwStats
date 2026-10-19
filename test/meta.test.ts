import { describe, expect, it } from 'vitest'
import { meta } from '../src/shared/data/meta'
import { operatorByKey, allMaps } from '../src/shared/catalog'
import { pickerMaps, rankedPool, seedSitesFor, siteTiersFor } from '../src/shared/data/sitePicks'
import { recommend, baselineFor } from '../src/shared/recommend'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'

describe('researched meta (Y11S3)', () => {
  const m = meta()
  it('covers the whole ranked pool with replay-format, floor-tagged sites', () => {
    expect(rankedPool()).toHaveLength(15)
    for (const key of rankedPool()) {
      expect(m.maps[key], key).toBeDefined()
      expect(seedSitesFor(key).length, key).toBeGreaterThanOrEqual(4)
      for (const s of m.maps[key]!.sites) expect(s.name, key).toMatch(/^(B|\dF) .+, (B|\dF) .+$/)
    }
  })
  it('only names real operators on the right side', () => {
    for (const [key, map] of Object.entries(m.maps)) {
      for (const side of ['attack', 'defense'] as const) {
        for (const k of map.strong[side]) expect(operatorByKey(k)?.side, `${key}: ${k}`).toBe(side)
        for (const s of map.sites) for (const k of [...s[side].S, ...s[side].A]) expect(operatorByKey(k)?.side, `${key}/${s.name}: ${k}`).toBe(side)
      }
    }
    for (const side of ['attack', 'defense'] as const) for (const k of Object.keys(m.ranked.winDelta[side])) expect(operatorByKey(k)?.side, k).toBe(side)
  })
  it('uses research where it exists (with expert overrides) and curated judgment where it is thin', () => {
    const cctv = siteTiersFor('clubhouse', '2F CCTV Room, 2F Cash Room', 'defense')!
    expect(cctv.source).toBe('research')
    expect(cctv.S).toContain('smoke')
    expect(cctv.A).toContain('tubarao')
    const thin = siteTiersFor('outback', '1F Green Bedroom, 1F Red Bedroom', 'attack')
    expect(thin?.source ?? 'curated').toBe('curated')
  })
  it('map pickers show the ranked pool only', () => {
    expect(pickerMaps(allMaps()).map((x) => x.key).sort()).toEqual([...rankedPool()].sort())
  })
  it('explains the official ranked win delta when no crowd data exists', () => {
    const rook = operatorByKey('rook')!.id
    const r = recommend({
      side: 'defense', mapKey: null, site: null, roster: [rook], mine: { overall: new Map() }, crowd: {},
      baseline: baselineFor(BUNDLED_DATASET, null), weights: { personal: 1, meta: 1, site: 1, role: 1, comfort: 1 }, minRounds: 8, topN: 1,
      rankedDelta: new Map([[rook, 0.032]])
    })
    expect(r[0]!.reasons.join(' ')).toMatch(/Ranked meta \(official, Plat\+\) \+3%/)
  })
})
