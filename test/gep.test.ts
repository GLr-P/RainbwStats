import { describe, expect, it } from 'vitest'
import { GepState, mapKeyOfGep } from '../src/main/gep/adapter'

const roster = (slot: number, player: string, team: 'Blue' | 'Orange', operator: string, local = false) =>
  ({ feature: 'roster', category: 'roster', key: `roster_${slot}`, value: JSON.stringify({ player, is_anonymous: false, player_id: `id-${player}`, is_local: local, team, operator, kills: 0, deaths: 0 }) })

describe('Overwolf GEP adapter', () => {
  it('maps every documented GEP map id we have in the catalog', () => {
    expect(mapKeyOfGep('CLUB HOUSE')).toBe('clubhouse')
    expect(mapKeyOfGep('KAFE DOSTOYEVSKY')).toBe('kafe')
    expect(mapKeyOfGep('NightHaven')).toBe('nighthaven')
    expect(mapKeyOfGep('VILLA')).toBe('villa')
    expect(mapKeyOfGep('OUTBACK')).toBe('outback')
    expect(mapKeyOfGep('')).toBeNull()
  })

  it('knows map, side and both teams during operator select (before round 1 ends)', () => {
    const g = new GepState()
    g.info({ feature: 'match_info', key: 'match_id', value: 'M1' })
    g.info({ feature: 'match_info', key: 'map_id', value: 'CLUB HOUSE' })
    g.info({ feature: 'game_info', key: 'phase', value: 'operator_select' })
    g.info({ feature: 'match_info', key: 'game_mode', value: JSON.stringify({ playlist: 'RANKED', game_type: 'ESSENTIALS', mode_name: 'BOMB' }) })
    expect(g.snapshot().side).toBeNull() // nobody picked yet
    g.info(roster(0, 'Me', 'Blue', 'SMOKE', true))
    g.info(roster(1, 'Mate', 'Blue', 'NØKK')) // attacker name with Ø, but the majority decides
    g.info(roster(2, 'Mate2', 'Blue', 'MUTE'))
    g.info(roster(5, 'Enemy', 'Orange', 'THERMITE'))
    g.info({ feature: 'match', key: 'number', value: '1' })
    g.info({ feature: 'match', key: 'score', value: JSON.stringify({ blue: '0', orange: '0' }) })
    const s = g.snapshot()
    expect(s).toMatchObject({ matchId: 'M1', mapKey: 'clubhouse', phase: 'operator_select', playlist: 'RANKED', round: 1, score: [0, 0], side: 'defense' })
    expect(s.myTeam.map((p) => p.name)).toEqual(['Me', 'Mate', 'Mate2'])
    expect(s.enemyTeam[0]?.playerId).toBe('id-Enemy')
  })

  it('handles leavers and resets on a new match', () => {
    const g = new GepState()
    g.info({ key: 'match_id', value: 'A' })
    g.info(roster(0, 'Me', 'Blue', 'ASH', true))
    g.info({ key: 'roster_0', value: null })
    expect(g.snapshot().myTeam).toHaveLength(0)
    g.info(roster(0, 'Me', 'Blue', 'ASH', true))
    g.info({ key: 'match_id', value: 'B' })
    expect(g.snapshot()).toMatchObject({ matchId: 'B', mapKey: null, myTeam: [] })
  })
})
