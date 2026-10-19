// Fetches everything we show per player in one round-trip per endpoint, with a short-lived cache.
import type { Db } from '../db'
import type { BasicStats, BoardProfile, UbiClient } from './client'
import type { PlayerCard } from '../../shared/ipc'

const TTL_MS = 10 * 60_000

export class LobbyService {
  private cache = new Map<string, { at: number; card: PlayerCard }>()
  private readonly ubi: UbiClient
  private readonly db: Db
  private readonly now: () => number

  constructor(ubi: UbiClient, db: Db, now: () => number = Date.now) {
    this.ubi = ubi
    this.db = db
    this.now = now
  }

  /** Returns cards for all ids; cached ones instantly, the rest in one batch. Never throws. */
  async cards(ids: string[], names: Record<string, string> = {}): Promise<{ cards: PlayerCard[]; error?: string }> {
    const real = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))]
    const fresh = real.filter((id) => (this.cache.get(id)?.at ?? 0) + TTL_MS > this.now())
    const todo = real.filter((id) => !fresh.includes(id))
    let error: string | undefined
    if (todo.length && this.ubi.canAuth) {
      try {
        const [boards, stats] = await Promise.all([this.ubi.fullProfiles(todo), this.ubi.basicStats(todo).catch(() => [] as BasicStats[])])
        const fetchedAt = new Date(this.now()).toISOString()
        for (const id of todo) {
          const mine = boards.filter((b) => b.profileId === id)
          for (const b of mine) this.db.saveRank({ ...b, fetchedAt })
          this.cache.set(id, { at: this.now(), card: toCard(id, names[id] ?? '', mine, stats.find((x) => x.profileId === id)) })
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
    } else if (todo.length) error = 'Not logged in to Ubisoft: ranks unavailable'
    const cards = ids.map((id) => {
      const c = this.cache.get(id)?.card
      return c ? { ...c, name: names[id] || c.name } : toCard(id, names[id] ?? '', [], undefined)
    })
    return { cards, error }
  }
}

function toCard(profileId: string, name: string, boards: BoardProfile[], stats?: BasicStats): PlayerCard {
  const pick = (board: string) => boards.find((b) => b.board === board)
  const ranked = pick('ranked')
  const any = ranked ?? pick('standard') ?? boards[0]
  return {
    profileId,
    name,
    loaded: boards.length > 0,
    level: stats?.level ?? null,
    hoursPlayed: stats ? Math.round(stats.pvpSeconds / 3600) : null,
    ranked: ranked ? { rank: ranked.rank, rankPoints: ranked.rankPoints, maxRank: ranked.maxRank, maxRankPoints: ranked.maxRankPoints, seasonId: ranked.seasonId } : null,
    season: any ? { wins: any.wins, losses: any.losses, abandons: any.abandons, kills: any.kills, deaths: any.deaths, board: any.board } : null
  }
}
