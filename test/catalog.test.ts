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
