import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listRoundFiles, parseFile } from '../src/main/replay/ingest'
import { normalizeRound } from '../src/main/replay/normalize'
import { decompress, ReplayParseError } from '../src/main/replay/parser'

// Raw replays are personal data and gitignored; these tests run only where they exist.
const LOCAL = 'test/fixtures/local'
const hasLocal = existsSync(LOCAL) && listRoundFiles(LOCAL).length > 0

describe.runIf(hasLocal)('replay parser (local Y11S3 fixture)', () => {
  const files = hasLocal ? listRoundFiles(LOCAL) : []

  it('parses every round with map, site, players and a single winner', () => {
    for (const f of files) {
      const r = normalizeRound(parseFile(f))
      expect(r.season).toBe('Y11S3')
      expect(r.mapKey).toBe('plane')
      expect(r.site).toMatch(/, /)
      expect(r.players.length).toBeGreaterThanOrEqual(5)
      expect(r.players.every((p) => p.profileId.length === 36)).toBe(true)
      const winners = new Set(r.players.filter((p) => p.won).map((p) => p.teamIndex))
      expect(winners.size).toBe(1)
      expect(r.players.every((p) => p.side !== null)).toBe(true)
    }
  })

  it('round 1: recording team attacks, defenders win, known operators', () => {
    const r = normalizeRound(parseFile(files[0]!))
    expect(r.round).toBe(1)
    expect(r.site).toBe('2F Meeting Room, 2F Executive Office')
    const atk = r.players.filter((p) => p.side === 'attack').map((p) => p.operatorId).sort()
    expect(atk).toEqual(['104189664038', '92270642539', '92270644267']) // Iana, Blitz, Dokkaebi
    expect(r.players.find((p) => p.won)?.side).toBe('defense')
  })

  it('parses a round in under 150 ms', { retry: 2 }, () => {
    const t = performance.now()
    parseFile(files[1]!)
    expect(performance.now() - t).toBeLessThan(150)
  })
})

describe('replay parser (synthetic)', () => {
  it('rejects non-replay data', () => {
    expect(() => decompress(Buffer.from('hello world'))).toThrow(ReplayParseError)
  })
})
