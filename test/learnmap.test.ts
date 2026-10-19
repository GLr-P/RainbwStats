import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { applyLearned, learnMap } from '../src/main/replay/ingest'
import { mapForSite } from '../src/shared/data/sitePicks'
import { mapKeyForWorldId } from '../src/shared/catalog'
import type { RoundRecord } from '../src/shared/types'

describe('unknown map ids (reworked maps)', () => {
  it('recognises maps from their site room names', () => {
    expect(mapForSite('2F Aviator Room, 2F Games Room')).toBe('villa')
    expect(mapForSite('B Art Storage, B Old Office')).toBe('villa')
    expect(mapForSite('1F Green Bedroom, 1F Red Bedroom')).toBe('outback')
    expect(mapForSite('2F CCTV Room, 2F Cash Room')).toBe('clubhouse')
    expect(mapForSite('')).toBeNull()
  })

  it('learns the new id, fixes stored rounds and survives restarts', () => {
    const db = openDb(':memory:')
    const r = JSON.parse(readFileSync('test/fixtures/rounds-sample.json', 'utf8'))[0] as RoundRecord
    db.saveRound({ ...r, matchId: 'm1', mapKey: 'unknown:999000111', site: 'B Art Storage, B Old Office' })
    applyLearned(db) // startup repair
    expect(mapKeyForWorldId('999000111')).toBe('villa')
    expect(db.roundsOfMatch('m1')[0]!.mapKey).toBe('villa')
    expect(learnMap(db, '999000111', 'B Art Storage, B Old Office')).toBeNull() // already known
  })
})
