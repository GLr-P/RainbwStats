import { describe, expect, it } from 'vitest'
import { applyCatalogOverrides, mapKeyForWorldId, mapName, operatorById, operatorName, seasonOf, sideOfOperator } from '../src/shared/catalog'
import { OPERATORS } from '../src/shared/data/operators'
import { steamLibraries } from '../src/main/replay/locate'

describe('catalog', () => {
  it('has unique operator ids and keys', () => {
    expect(new Set(OPERATORS.map((o) => o.id)).size).toBe(OPERATORS.length)
    expect(new Set(OPERATORS.map((o) => o.key)).size).toBe(OPERATORS.length)
  })
  it('never throws on unknown ids', () => {
    expect(operatorName('123')).toBe('Unknown(123)')
    expect(sideOfOperator('123')).toBeNull()
    expect(mapKeyForWorldId('999')).toBe('unknown:999')
    expect(mapName('unknown:999')).toBe('Unknown map 999')
    expect(sideOfOperator('359656345734')).toBeNull() // Recruit
  })
  it('applies remote overrides for new season operators', () => {
    applyCatalogOverrides({ operators: [{ id: '555000000001', name: 'Noor', side: 'defense', roles: ['an'] }], maps: [{ key: 'casino', name: 'Calypso Casino', ids: ['777'] }] })
    expect(operatorById('555000000001')?.name).toBe('Noor')
    expect(mapKeyForWorldId('777')).toBe('casino')
  })
  it('extracts season codes', () => {
    expect(seasonOf('Y11S3_Alpha04')).toBe('Y11S3')
    expect(seasonOf('weird')).toBe('unknown')
  })
  it('parses steam library folders', () => {
    const vdf = '"libraryfolders"\n{\n "0"\n {\n  "path"  "C:\\\\Program Files (x86)\\\\Steam"\n }\n "1" { "path" "D:\\\\SteamLibrary" }\n}'
    expect(steamLibraries(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'])
  })
})

import { openDb } from '../src/main/db'
import { learnOperators } from '../src/main/replay/ingest'
import type { ReplayRound } from '../src/main/replay/parser'

describe('operator learning', () => {
  it('learns unknown operator names from the replay header', () => {
    const db = openDb(':memory:')
    const team = { name: '', score: 0, startingScore: 0, won: false, winCondition: 'Unknown' as const }
    const r = {
      teams: [{ ...team, role: 'defense' }, { ...team, role: 'attack' }],
      players: [{ operatorId: '999000111', roleName: 'SOLID SNAKE', teamIndex: 0 }, { operatorId: '92270642344', roleName: 'SLEDGE', teamIndex: 1 }]
    } as unknown as ReplayRound
    expect(learnOperators(db, r)).toBe(true)
    expect(operatorById('999000111')).toMatchObject({ name: 'Solid Snake', side: 'defense' })
    expect(learnOperators(db, r)).toBe(false)
  })
})
