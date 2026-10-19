// Global crowd database contract, shared by the app and the Cloudflare Worker (worker/).
// No names are sent: players are pseudonymous HMACs of their Ubisoft profile id.

/** Rank band: 0 unranked, 1 Copper … 7 Diamond, 8 Champion+. */
export const BANDS = ['Unranked', 'Copper', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Champion'] as const
export const bandOf = (rankId: number): number => (rankId <= 0 ? 0 : rankId >= 36 ? 8 : Math.floor((rankId - 1) / 5) + 1)

/** One player's ranked Career stats on one operator this season (cumulative). */
export interface CrowdOpRow { p: string; season: string; op: string; rounds: number; wins: number; band: number }
/** One player in one replay round. */
export interface CrowdRoundRow { k: string; season: string; type: number; map: string; site: string; side: 'attack' | 'defense'; op: string; won: 0 | 1; band: number }
export interface CrowdUpload { v: 1; ops: CrowdOpRow[]; rounds: CrowdRoundRow[] }

/** Aggregated season data served to every app. */
export interface CrowdMeta {
  season: string
  generatedAt: number
  /** Distinct players with ranked operator stats this season. */
  players: number
  /** [op key, band, rounds, wins, players] */
  ops: [string, number, number, number, number][]
  /** Player-rounds from replays (custom games excluded). */
  rounds: number
  /** [map key, site, side, op key, rounds, wins] */
  sites: [string, string, 'attack' | 'defense', string, number, number][]
}

export const MAX_OPS = 2000
export const MAX_ROUNDS = 3000
const HASH = /^[0-9a-f]{16}$/
const SEASON = /^Y\d{1,2}S[1-4]$/
const KEY = /^[a-z0-9_]{2,24}$/

/** Keeps only well-formed rows (the endpoint is public, so everything is validated). */
export function cleanUpload(body: unknown): CrowdUpload | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (b['v'] !== 1 || !Array.isArray(b['ops']) || !Array.isArray(b['rounds'])) return null
  if (b['ops'].length > MAX_OPS || b['rounds'].length > MAX_ROUNDS) return null
  const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
  const ops = (b['ops'] as Record<string, unknown>[]).filter((r): r is CrowdOpRow & Record<string, unknown> =>
    typeof r === 'object' && r !== null && HASH.test(String(r['p'])) && SEASON.test(String(r['season'])) && KEY.test(String(r['op'])) &&
    int(r['rounds'], 1, 20000) && int(r['wins'], 0, Number(r['rounds'])) && int(r['band'], 0, 8))
    .map((r) => ({ p: r.p, season: r.season, op: r.op, rounds: r.rounds, wins: r.wins, band: r.band }))
  const rounds = (b['rounds'] as Record<string, unknown>[]).filter((r): r is CrowdRoundRow & Record<string, unknown> =>
    typeof r === 'object' && r !== null && HASH.test(String(r['k'])) && SEASON.test(String(r['season'])) && int(r['type'], 0, 99) &&
    KEY.test(String(r['map'])) && typeof r['site'] === 'string' && r['site'].length <= 80 && (r['side'] === 'attack' || r['side'] === 'defense') &&
    KEY.test(String(r['op'])) && (r['won'] === 0 || r['won'] === 1) && int(r['band'], 0, 8))
    .map((r) => ({ k: r.k, season: r.season, type: r.type, map: r.map, site: r.site, side: r.side, op: r.op, won: r.won, band: r.band }))
  return { v: 1, ops, rounds }
}

export function isCrowdMeta(v: unknown): v is CrowdMeta {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return typeof m['season'] === 'string' && typeof m['players'] === 'number' && Array.isArray(m['ops']) && Array.isArray(m['sites'])
}
