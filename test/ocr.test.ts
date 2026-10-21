import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detect, similarity } from '../src/main/ocr/matcher'

describe('ocr matcher', () => {
  it('finds map and side in noisy OCR output', () => {
    expect(detect(['ROUND 1', 'CLUBH0USE', 'DEFENSE', 'SELECT YOUR OPERATOR'])).toMatchObject({ mapKey: 'clubhouse', side: 'defense' })
    expect(detect(['THEME PARK', 'ATTACK'])).toMatchObject({ mapKey: 'themepark', side: 'attack' })
    expect(detect(['NIGHTHAVEN LABS'])).toMatchObject({ mapKey: 'nighthaven' })
    expect(detect(['KAFE DOSTOYEVSKY'])).toMatchObject({ mapKey: 'kafe' })
  })
  it('does not hallucinate from unrelated text', () => {
    expect(detect(['PLAY', 'SETTINGS', 'BATTLE PASS', 'SHOP'])).toEqual({})
    expect(detect(['The attack on the bank was great today and long'])).not.toHaveProperty('side')
  })
  it('matches a site half to the full replay site name', () => {
    const sites = () => ['2F Gym, 2F Bedroom', '1F Bar, 1F Stock Room']
    expect(detect(['BANK', 'nope', '1F Stock Roon'], () => [])).toMatchObject({ mapKey: 'bank' })
    expect(detect(['CLUBHOUSE', '1F Stock Roon'], sites).site).toBe('1F Bar, 1F Stock Room')
  })
  it('similarity basics', () => {
    expect(similarity('ABC', 'ABC')).toBe(1)
    expect(similarity('', 'A')).toBe(0)
    expect(similarity('CLUBHOUSE', 'CLUBH0USE')).toBeGreaterThan(0.85)
  })
})

describe('ocr matcher: real-world false positives', () => {
  it('ignores map/side words inside longer lines (code, chat, menus)', () => {
    expect(detect(['border: 1px solid var(--line);', '.panel { border-left: 3px solid }'])).toEqual({})
    expect(detect(['Smoke recommendation (menu text like "DEFENDERS"', 'on attack it recommended'])).toEqual({})
  })
  it('treats a frame showing both ATTACK and DEFENSE labels as ambiguous', () => {
    expect(detect(['CLUBHOUSE', 'ATTACKERS', 'DEFENDERS'])).toEqual({ mapKey: 'clubhouse' })
  })
})

describe('main menu frames', () => {
  it('are recognised so debug captures keep the useful frames', async () => {
    const { isMenu } = await import('../src/main/ocr/detector')
    expect(isMenu(['PLAY', 'OPERATORS', 'BATTLEPASS', 'LOCKER', 'CAREER', 'ESPORTS', 'RANKED', 'BROWSE PLAYLISTS'])).toBe(true)
    expect(isMenu(['VILLA', 'ATTACK', 'ROUND 1', 'SELECT YOUR OPERATOR'])).toBe(false)
  })
})

describe('OCR debug frame retention', () => {
  it('keeps at most 40 frames when OCR errors before it writes sidecar text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rainbwstats-ocr-test-'))
    try {
      // 60 failed frames (.png only), then 20 successful ones (.png + .txt)
      for (let i = 0; i < 80; i++) {
        const stamp = String(i).padStart(13, '0')
        writeFileSync(join(dir, `frame-${stamp}.png`), '')
        if (i >= 60) writeFileSync(join(dir, `frame-${stamp}.txt`), '')
      }
      const { trimDebugFrames } = await import('../src/main/ocr/detector')
      trimDebugFrames(dir)
      const left = readdirSync(dir)
      expect(left.filter((f) => f.endsWith('.png'))).toHaveLength(40)
      expect(left.filter((f) => f.endsWith('.txt'))).toHaveLength(20)
      expect(left.sort()[0]).toBe(`frame-${String(40).padStart(13, '0')}.png`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('side from operator names (operator select)', () => {
  it('uses your side\'s operator names when no ATTACK/DEFENSE label is read', async () => {
    const { detect } = await import('../src/main/ocr/matcher')
    expect(detect(['CLUBHOUSE', 'SMOKE', 'MUTE', 'JAGER', 'BANDIT', 'Select your operator']).side).toBe('defense')
    expect(detect(['ASH', 'THERMITE', 'SLEDGE', 'HIBANA']).side).toBe('attack')
    expect(detect(['BAN AN OPERATOR', 'ASH', 'THERMITE', 'SLEDGE']).side).toBeUndefined() // ban screens show the enemy
    expect(detect(['ASH', 'SMOKE', 'MUTE', 'THERMITE']).side).toBeUndefined() // mixed: not confident
  })
})

describe('ban screen read on 2026-10-19 (Border, round 4, you on attack)', () => {
  const lines = ['YOUR TEAM', '0:13 1', 'ROUND 4', 'SENTRY', 'GADGET KIT', 'ENEMY TEAM', 'BANA DEFENDER', "i Selected Operator can't be used until role swap or overtime.", 'SENTRY', 'RANKED', 'BORDER', 'BOMBSITES', '2F Armory Lockers', '2F Archives', 'IF Ventilation Room', 'IF Workshop', 'IF Bathroom', 'IF Tellers', 'IF Customs Inspections', 'IF Supply Room', 'DIFFICULTY SPEED', 'SPECIALTY: SUPPORT', 'HEALTH']
  const sites = () => ['2F Armory Lockers, 2F Archives', '1F Ventilation Room, 1F Workshop', '1F Bathroom, 1F Tellers', '1F Customs Inspections, 1F Supply Room']
  it('takes no side from a run-together "BAN A DEFENDER" heading', () => {
    const d = detect(lines, sites)
    expect(d.mapKey).toBe('border')
    expect(d).not.toHaveProperty('side')
  })
  it('takes no site from the full bomb-site list', () => {
    expect(detect(lines, sites)).not.toHaveProperty('site')
    expect(detect(['BORDER', 'IF Bathroom'], sites).site).toBe('1F Bathroom, 1F Tellers')
  })
})

describe('frames read on 2026-10-20 (Border, round 1 attack, 4-2 win)', () => {
  it('takes no map from the map vote', () => {
    expect(detect(['YOURTEAM X OO i ENEMYTEAM', 'CPU: I.S', 'VILLA', '44', 'BORDER', 'MAP SELECTION', 'FORTRESS', 'COASTLINE', 'OUTBACK'])).toEqual({})
    expect(detect(['YOUR TEAM', 'x', '00', 'i', 'ENEMY TEAM', 'COASTLINE', 'OUTBACK', 'FPS: 12g'])).toEqual({})
  })
  it('still reads round 1 from the operator lineup (which says "COMMENDATION STREAK")', () => {
    const lines = ['D JACKAL', 'West Vehicle Exit', 'SHOW TEAM LOADOUT&DETAILS', '143', 'GPU:', 'ROUND 1', 'NOMAD', '? RANDOM', 'z', 'HIBANA', 'West Vehicle Exit', 'z', 'DOKKAEBI', 'COMMENDATION STREAK', 'C) Valley', 'RANKED', 'BORDER', 'ASH', 'West Vehicle Exit']
    expect(detect(lines)).toEqual({ mapKey: 'border', side: 'attack' })
  })
  it('takes no side from a ban screen whose "BAN" OCR dropped', () => {
    const d = detect(['YOURTEA< O', 'A DEFENDER', "Selected Operator can't be used until role swap or overtime.", '0:14', 'ROUND 1', 'RANKED O', 'CLUBHOUSE', '144'])
    expect(d).toEqual({ mapKey: 'clubhouse' })
  })
  it('reads "CLUB HOUSE" as Clubhouse, not House', () => {
    expect(detect(['RANKED', 'CLUB HOUSE', 'O nanobothd', 'OURTEAM', 'ENEMY TEAM j']).mapKey).toBe('clubhouse')
    expect(detect(['RANKED', 'HOUSE']).mapKey).toBe('house')
    expect(detect(['MAP SELECTED', 'CLUBHOUSE']).mapKey).toBe('clubhouse')
  })
  it('takes no side from the end-of-match lineup', () => {
    const d = detect(['4-2', 'LESION', 'O GUI[WCE', 'O w.tb', 'TEAMLINEUP', 'RANKED', 'DENARI', 'WAMAI', 'MATCH RECAP', 'Commend again in', 'ELA', 'KAPKAN', 'NEW MATCH WITHSQUAD', 'RANKED', 'BORDER', '44s'])
    expect(d.mapKey).toBe('border')
    expect(d).not.toHaveProperty('side')
  })
})

describe('screens that name another side', () => {
  it('never take a side from round results or ban screens', async () => {
    const { detect } = await import('../src/main/ocr/matcher')
    expect(detect(['ROUND 3', 'DEFENDERS', 'WIN']).side).toBeUndefined()
    expect(detect(['ATTACKERS ELIMINATED', 'ATTACKERS']).side).toBeUndefined()
    expect(detect(['BAN', 'ATTACKERS']).side).toBeUndefined()
    expect(detect(['CLUBHOUSE', 'DEFENSE']).side).toBe('defense') // operator select / loading still works
  })
})
