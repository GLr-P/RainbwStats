// Sample lobby data for --demo screenshots only. Deterministic, clearly fake, never used otherwise.
import type { LobbyService } from './ubi/lobby'
import type { Db } from './db'
import type { PlayerCard } from '../shared/ipc'
import { seasonCodeToId, seasonIdToCode } from '../shared/ranks'

export function demoLobby(): LobbyService {
  const card = (profileId: string, name: string): PlayerCard => {
    const h = [...profileId].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
    const rank = 18 + (h % 16)
    const wins = 12 + (h % 40), losses = 10 + ((h >> 5) % 35), kills = 300 + (h % 400)
    return {
      profileId, name, loaded: true, level: 80 + (h % 300), hoursPlayed: 200 + (h % 1500),
      ranked: { rank, rankPoints: 900 + rank * 100 + (h % 99), maxRank: Math.min(36, rank + (h % 3)), maxRankPoints: 950 + Math.min(36, rank + (h % 3)) * 100 + (h % 50), seasonId: 43 },
      season: { wins, losses, abandons: h % 3, kills, deaths: Math.round(kills / (0.7 + (h % 80) / 100)), board: 'ranked' }
    }
  }
  return { cards: async (ids: string[], names: Record<string, string> = {}) => ({ cards: ids.map((id) => card(id, names[id] ?? '')) }) } as unknown as LobbyService
}

/** Demo profile only: a plausible season of rank checks and operator stats so every page has something to show. */
export function seedDemoHistory(db: Db, me: string, season: string, seasonId: number, now = Date.now()): void {
  let wins = 31, losses = 26, rp = 3180
  const steps = [+24, -21, +26, +22, -19, +25, 0, -23, +27, +21, -20, +24, +23]
  steps.forEach((d, i) => {
    if (d > 0) wins++; else if (d < 0) losses++
    rp += d
    const at = new Date(now - (steps.length - i) * (i < 8 ? 9 : 0.6) * 3600_000).toISOString()
    db.saveRank({ profileId: me, board: 'ranked', seasonId, rank: rp >= 3200 ? 23 : 22, rankPoints: rp, maxRank: 23, maxRankPoints: 3290, wins, losses, abandons: 1, kills: 610, deaths: 548, fetchedAt: at })
  })
  const ops: [string, number, number][] = [['ash', 96, 55], ['sledge', 70, 37], ['zofia', 52, 25], ['thermite', 44, 25], ['rook', 88, 49], ['smoke', 61, 36], ['mira', 40, 19], ['valkyrie', 35, 20]]
  db.saveApiOpStats(me, [season], ops.map(([opKey, rounds, w]) => ({ season, playlist: 'ranked', opKey, rounds, wins: w })), new Date(now).toISOString())
  // Last season: a losing Zofia and a strong Kaid that went unplayed, so the Coach has something to say.
  const prev = seasonIdToCode(seasonCodeToId(season) - 1)
  const prevOps: [string, number, number][] = [['zofia', 60, 22], ['ash', 80, 45], ['kaid', 30, 21], ['rook', 70, 39]]
  db.saveApiOpStats(me, [prev], prevOps.map(([opKey, rounds, w]) => ({ season: prev, playlist: 'ranked', opKey, rounds, wins: w })), new Date(now).toISOString())
}
