import { describe, expect, it } from 'vitest'
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
