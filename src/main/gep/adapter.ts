// Overwolf live game data (GEP) for Rainbow Six Siege → what the Live page needs, before round 1 ends.
// Pure and testable: feed it info updates / events in ow-electron's shape ({ feature, category?, key, value }).
// Reference: dev.overwolf.com …/supported-games/rainbow-six-siege (game id 10826).
import { MAPS } from '../../shared/data/maps'
import { operatorByKey } from '../../shared/catalog'
import type { Side } from '../../shared/types'

export const R6_GAME_ID = 10826
export const GEP_FEATURES = ['game_info', 'match_info', 'match', 'roster', 'me']

export interface GepPlayer { slot: string; name: string; playerId: string; team: 'blue' | 'orange'; operator: string; isLocal: boolean }
export interface GepSnapshot {
  matchId: string | null
  mapKey: string | null
  phase: string | null
  playlist: string | null
  round: number | null
  /** [your team, enemy] ("blue" is always the local player's team). */
  score: [number, number] | null
  /** Your side this round, from the operators your team picked (null until enough are picked). */
  side: Side | null
  myTeam: GepPlayer[]
  enemyTeam: GepPlayer[]
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/[^a-z0-9]/g, '')
/** GEP map ids ("CLUB HOUSE", "KAFE DOSTOYEVSKY", "NightHaven") → catalog keys. */
export function mapKeyOfGep(id: string): string | null {
  const f = fold(id)
  if (!f) return null
  const hit = MAPS.find((m) => m.key === f || fold(m.name) === f || fold(m.name).startsWith(f) || f.startsWith(fold(m.name)))
  return hit?.key ?? null
}
export const sideOfOperatorName = (name: string): Side | null => operatorByKey(fold(name))?.side ?? null

const parse = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}

export class GepState {
  private s = { matchId: null as string | null, mapKey: null as string | null, phase: null as string | null, playlist: null as string | null, round: null as number | null, score: null as [number, number] | null }
  private roster = new Map<string, GepPlayer>()

  /** Applies one info update. Returns true if anything the app shows changed. */
  info(u: { feature?: string; category?: string; key?: string; value?: unknown }): boolean {
    const key = u.key ?? ''
    const v = parse(u.value)
    const before = JSON.stringify(this.snapshot())
    if (key === 'phase') this.s.phase = String(v ?? '') || null
    else if (key === 'match_id') { if (String(v) !== this.s.matchId) this.newMatch(String(v)) }
    else if (key === 'map_id') this.s.mapKey = mapKeyOfGep(String(v ?? ''))
    else if (key === 'game_mode' && v && typeof v === 'object') this.s.playlist = String((v as Record<string, unknown>)['playlist'] ?? '') || null
    else if (key === 'number' || key === 'round') { const n = Number(typeof v === 'object' && v ? (v as Record<string, unknown>)['number'] : v); if (Number.isFinite(n)) this.s.round = n }
    else if (key === 'score' && v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      this.s.score = [Number(o['blue'] ?? 0), Number(o['orange'] ?? 0)]
    } else if (/^roster_\d+$/.test(key)) {
      if (v === null || v === 'null' || v === '') this.roster.delete(key)
      else if (typeof v === 'object') {
        const o = v as Record<string, unknown>
        const team = String(o['team'] ?? '').toLowerCase() === 'blue' ? 'blue' : 'orange'
        this.roster.set(key, { slot: key, name: String(o['player'] ?? ''), playerId: String(o['player_id'] ?? ''), team, operator: String(o['operator'] ?? ''), isLocal: o['is_local'] === true || o['is_local'] === 'true' })
      }
    }
    return JSON.stringify(this.snapshot()) !== before
  }

  /** Applies one game event (match_start / match_end reset per-match state). */
  event(e: { key?: string; name?: string }): boolean {
    const name = e.key ?? e.name ?? ''
    if (name === 'match_start') { this.newMatch(this.s.matchId ?? ''); return true }
    if (name === 'match_end') { this.s.phase = 'lobby'; return true }
    return false
  }

  private newMatch(id: string): void {
    this.s = { matchId: id || null, mapKey: null, phase: this.s.phase, playlist: null, round: null, score: null }
    this.roster.clear()
  }

  snapshot(): GepSnapshot {
    const players = [...this.roster.values()]
    const myTeam = players.filter((p) => p.team === 'blue')
    const enemyTeam = players.filter((p) => p.team === 'orange')
    // Side: majority of known operator sides on your team (enemy operators count for the opposite side).
    let vote = 0
    for (const p of myTeam) { const s = sideOfOperatorName(p.operator); if (s) vote += s === 'attack' ? 1 : -1 }
    for (const p of enemyTeam) { const s = sideOfOperatorName(p.operator); if (s) vote += s === 'attack' ? -1 : 1 }
    return { ...this.s, side: vote > 0 ? 'attack' : vote < 0 ? 'defense' : null, myTeam, enemyTeam }
  }
}
