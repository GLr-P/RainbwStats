// Keeps Ubisoft Career operator stats in the local DB, politely:
//  - you: lifetime + every past season once (past seasons never change) + current season hourly
//  - lobby players: lifetime + current season, at most once per 12 h per player, batched (2 requests/match)
import type { Db } from '../db'
import type { UbiClient } from './client'
import { STATS_OPERATORS, SEASON_CALENDAR } from '../../shared/data/statsIds'
import { seasonCodeToId } from '../../shared/ranks'

const HOUR = 3600_000
const opKeyOf = (hex: string) => STATS_OPERATORS[hex]?.key

export class OpStatsSync {
  private chain: Promise<unknown> = Promise.resolve()
  private readonly ubi: UbiClient
  private readonly db: Db
  private readonly currentSeason: () => string
  private readonly now: () => number
  lastError: string | null = null

  constructor(ubi: UbiClient, db: Db, currentSeason: () => string, now: () => number = Date.now) {
    this.ubi = ubi
    this.db = db
    this.currentSeason = currentSeason
    this.now = now
  }

  private stale(id: string, season: string, ttlMs: number): boolean {
    const at = this.db.apiFetchedAt(id, season)
    return !at || this.now() - Date.parse(at) > ttlMs
  }

  /** Fetches one season (or lifetime) for many players and stores it. */
  private async fetch(ids: string[], season: string): Promise<void> {
    if (!ids.length) return
    const cal = season === 'all' ? undefined : SEASON_CALENDAR[season]
    if (season !== 'all' && !cal) return
    const rows = await this.ubi.operatorStats(ids, opKeyOf, cal ? { code: season, calendarId: cal } : undefined)
    const at = new Date(this.now()).toISOString()
    for (const id of ids) this.db.saveApiOpStats(id, [season], rows.filter((r) => r.profileId === id), at)
  }

  /** Runs syncs one at a time (a lobby sync waits for a history sync instead of being dropped). */
  private guarded(fn: () => Promise<void>): Promise<boolean> {
    if (!this.ubi.canAuth) return Promise.resolve(false)
    const run = this.chain.then(async () => {
      try { await fn(); this.lastError = null; return true } catch (e) {
        this.lastError = e instanceof Error ? e.message : String(e)
        return false
      }
    })
    this.chain = run
    return run
  }

  /** Your full operator history: lifetime, current season, and each past season once. */
  syncMine(me: string): Promise<boolean> {
    return this.guarded(async () => {
      const current = this.currentSeason()
      if (this.stale(me, 'all', HOUR)) await this.fetch([me], 'all')
      if (this.stale(me, current, HOUR)) await this.fetch([me], current)
      const past = Object.keys(SEASON_CALENDAR).filter((s) => s !== current && seasonCodeToId(s) < seasonCodeToId(current))
      for (const s of past.sort((a, b) => seasonCodeToId(b) - seasonCodeToId(a))) {
        if (!this.db.apiFetchedAt(me, s)) await this.fetch([me], s) // immutable: fetch once
      }
    })
  }

  /** Lobby players: lifetime + current season, batched, cached 12 h. */
  syncPlayers(ids: string[]): Promise<boolean> {
    return this.guarded(async () => {
      const current = this.currentSeason()
      const real = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id))
      await this.fetch(real.filter((id) => this.stale(id, 'all', 12 * HOUR)), 'all')
      await this.fetch(real.filter((id) => this.stale(id, current, 12 * HOUR)), current)
    })
  }
}
