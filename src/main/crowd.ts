// Global crowd database client: opt-in upload of pseudonymous stats, and download of the
// aggregated season meta (download works for everyone, sharing or not).
import { createHmac } from 'node:crypto'
import type { Db } from './db'
import { bandOf, isCrowdMeta, MAX_OPS, MAX_ROUNDS, type CrowdMeta, type CrowdOpRow, type CrowdRoundRow, type CrowdUpload } from '../shared/crowd'
import { operatorById } from '../shared/catalog'

/** Public, fixed salt: ids are pseudonymous (unlinkable to names without knowing the profile id). */
const SALT = 'rainbwstats-crowd-v1'
export const pseudonym = (s: string): string => createHmac('sha256', SALT).update(s).digest('hex').slice(0, 16)

const REFRESH_MS = 3 * 3600_000

export interface CrowdBatch { body: CrowdUpload; players: { profileId: string; season: string; fetchedAt: string }[]; matches: string[] }

/** Builds the next upload from local data that hasn't been shared yet (bounded in size). */
export function nextBatch(db: Db, season: string): CrowdBatch {
  const ops: CrowdOpRow[] = []
  const players: CrowdBatch['players'] = []
  const byPlayer = new Map<string, ReturnType<Db['crowdPendingOps']>>()
  for (const r of db.crowdPendingOps(season)) byPlayer.set(r.profileId, [...(byPlayer.get(r.profileId) ?? []), r])
  for (const [profileId, rows] of byPlayer) {
    if (ops.length + rows.length > MAX_OPS) break
    const p = pseudonym(profileId)
    for (const r of rows) ops.push({ p, season, op: r.opKey, rounds: r.rounds, wins: Math.min(r.wins, r.rounds), band: bandOf(r.rank) })
    players.push({ profileId, season, fetchedAt: rows[0]!.fetchedAt })
  }
  const rounds: CrowdRoundRow[] = []
  const matches: string[] = []
  const byMatch = new Map<string, ReturnType<Db['crowdPendingRounds']>>()
  for (const r of db.crowdPendingRounds()) byMatch.set(r.matchId, [...(byMatch.get(r.matchId) ?? []), r])
  for (const [matchId, rows] of byMatch) {
    if (rounds.length + rows.length > MAX_ROUNDS) break
    for (const r of rows) {
      const op = operatorById(r.operatorId)
      if (!op || op.id.startsWith('x:')) continue // unknown/placeholder operators are not shared
      // Keys must be the same whoever in the lobby uploads the match, or it counts twice. A name-only
      // player (no profile id in this replay) may have an id in a teammate's copy, and a match without
      // an id can't be told apart from others: skip both.
      if (!matchId || r.profileId.startsWith('name:')) continue
      rounds.push({ k: pseudonym(`${matchId}|${r.round}|${r.profileId}`), season: r.season, type: r.type, map: r.mapKey, site: r.site, side: r.side, op: op.key, won: r.won ? 1 : 0, band: bandOf(r.rank) })
    }
    matches.push(matchId)
  }
  return { body: { v: 1, ops, rounds }, players, matches }
}

export class CrowdSync {
  lastError: string | null = null
  lastUpload: { at: number; ops: number; rounds: number } | null = null
  private busy = false
  private readonly db: Db
  private readonly o: { url: () => string; season: () => string; enabled: () => boolean; fetch?: typeof fetch; now?: () => number }

  constructor(db: Db, o: CrowdSync['o']) { this.db = db; this.o = o }

  private get f(): typeof fetch { return this.o.fetch ?? fetch }
  private now(): number { return (this.o.now ?? Date.now)() }

  private memo: CrowdMeta | null | undefined
  /** The cached season meta (null until the first download). */
  meta(): CrowdMeta | null {
    if (this.memo === undefined) this.memo = this.db.getJson<{ at: number; data: CrowdMeta }>('crowd.meta')?.data ?? null
    return this.memo && this.memo.season === this.o.season() ? this.memo : null
  }

  /** Sends everything pending (several batches if needed). Returns false on failure. */
  async upload(): Promise<boolean> {
    if (!this.o.enabled()) return true
    for (let i = 0; i < 10; i++) {
      const b = nextBatch(this.db, this.o.season())
      if (!b.body.ops.length && !b.body.rounds.length) {
        if (b.matches.length) this.db.markCrowdSent([], b.matches) // matches with only unknown operators
        return true
      }
      const res = await this.f(`${this.o.url()}/v1/ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b.body), signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`upload failed (${res.status})`)
      this.db.markCrowdSent(b.players, b.matches)
      this.lastUpload = { at: this.now(), ops: b.body.ops.length, rounds: b.body.rounds.length }
    }
    return true
  }

  /** Refreshes the season meta when older than 3 h (or forced). Returns true when it changed. */
  async download(force = false): Promise<boolean> {
    const cached = this.db.getJson<{ at: number; data: CrowdMeta }>('crowd.meta')
    const season = this.o.season()
    if (!force && cached && cached.data.season === season && this.now() - cached.at < REFRESH_MS) return false
    const res = await this.f(`${this.o.url()}/v1/meta?season=${encodeURIComponent(season)}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`download failed (${res.status})`)
    const data: unknown = await res.json()
    if (!isCrowdMeta(data)) throw new Error('bad crowd data')
    this.db.setJson('crowd.meta', { at: this.now(), data })
    this.memo = data
    return cached?.data.generatedAt !== data.generatedAt
  }

  /** Upload (if sharing) then download if stale. Never throws; errors land in lastError. */
  async tick(force = false): Promise<boolean> {
    if (this.busy) return false
    this.busy = true
    try {
      await this.upload()
      const changed = await this.download(force)
      this.lastError = null
      return changed
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      return false
    } finally { this.busy = false }
  }
}
