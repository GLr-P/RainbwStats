import { describe, expect, it } from 'vitest'
import { suggestBans } from '../src/shared/bans'
import { openDb } from '../src/main/db'
import { DEFAULT_SETTINGS } from '../src/main/settings'
import { BUNDLED_DATASET } from '../src/shared/data/dataset'
import { banSuggestions, type Ctx } from '../src/main/services'
import { operatorByKey } from '../src/shared/catalog'
import { rankedPool } from '../src/shared/data/sitePicks'

const base = { side: 'defense' as const, winDelta: {}, rankedBan: {}, proBan: {}, strong: [], yours: [] }
const ops = ['kaid', 'mira', 'rook', 'azami'].map((key) => ({ key, name: key }))

describe('ban suggestions', () => {
  it('ranks by map pro bans, ranked win delta and ban rate, with reasons', () => {
    const r = suggestBans({ ...base, candidates: ops, proBan: { kaid: 0.71, mira: 0.39 }, winDelta: { rook: 0.032, azami: -0.007 }, rankedBan: { azami: 0.3 } })
    // Pro bans on the map outweigh a raw win delta (which helps whichever team picks it).
    expect(r.map((b) => b.opKey)).toEqual(['kaid', 'mira', 'rook'])
    expect(r[0]!.reasons[0]).toBe('Pros ban it 71% here')
  })
  it("doesn't suggest banning what you play unless it is overwhelming", () => {
    const r = suggestBans({ ...base, candidates: ops, proBan: { kaid: 0.71, mira: 0.39 }, yours: ['kaid'] })
    expect(r.map((b) => b.opKey)).toEqual(['mira'])
  })
  it('gives every ranked map a ban per side from the researched data', () => {
    const ctx: Ctx = { db: openDb(':memory:'), settings: () => DEFAULT_SETTINGS, dataset: () => BUNDLED_DATASET, me: () => null }
    for (const map of rankedPool()) {
      const b = banSuggestions(ctx, map)
      expect(b.attack.length, map).toBeGreaterThan(0)
      expect(b.defense.length, map).toBeGreaterThan(0)
      for (const x of b.attack) expect(operatorByKey(x.opKey)?.side).toBe('attack')
      for (const x of b.defense) expect(operatorByKey(x.opKey)?.side).toBe('defense')
    }
  })
})
