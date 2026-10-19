// Sample lobby data for --demo screenshots only. Deterministic, clearly fake, never used otherwise.
import type { LobbyService } from './ubi/lobby'
import type { PlayerCard } from '../shared/ipc'

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
