// Ban suggestions for a map (the ban phase is before round 1, so the enemy lobby is not known yet:
// suggestions come from what wins on this map, what pros ban here, and what you'd lose yourself).
import type { Side } from './types'

export interface BanCandidate { key: string; name: string }
export interface BanInput {
  side: Side
  candidates: BanCandidate[]
  /** Official ranked win delta (Plat+). */
  winDelta: Record<string, number>
  /** Official ranked ban rate. */
  rankedBan: Record<string, number>
  /** Pro ban rate on this map (share of games). */
  proBan: Record<string, number>
  /** Strong on this map (research). */
  strong: string[]
  /** Global RainbwStats win delta vs side average (already shrunk), when enough players share. */
  crowdDelta?: Record<string, number>
  /** Operators you'd play on this side (banning them costs you a pick). */
  yours: string[]
  /** Known enemy players' mains on this side: op key → the enemy who plays it most (Ubisoft stats). */
  enemy?: Record<string, { player: string; rounds: number; wins: number }>
}
export interface BanSuggestion { opKey: string; name: string; side: Side; score: number; reasons: string[] }

const pct = (x: number) => `${Math.round(x * 100)}%`
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`

export function suggestBans(inp: BanInput, top = 3): BanSuggestion[] {
  const out = inp.candidates.map((op) => {
    const parts: { v: number; why: string }[] = []
    const d = inp.winDelta[op.key]
    // A win delta helps whoever picks it (both teams can), so it counts less than what players
    // actually ban: pro bans on this map, then ranked ban rates.
    if (d !== undefined) parts.push({ v: d * 60, why: `Ranked win delta ${signed(d)}` })
    const pro = inp.proBan[op.key] ?? 0
    if (pro > 0) parts.push({ v: 6 * pro, why: `Pros ban it ${pct(pro)} here` })
    const rb = inp.rankedBan[op.key] ?? 0
    if (rb > 0) parts.push({ v: 6 * rb, why: `Banned in ${pct(rb)} of ranked games` })
    if (inp.strong.includes(op.key) && pro < 0.25) parts.push({ v: 1.5, why: 'Strong on this map' })
    const c = inp.crowdDelta?.[op.key]
    if (c !== undefined) parts.push({ v: 50 * c, why: `RainbwStats players ${signed(c)}` })
    const e = inp.enemy?.[op.key]
    if (e && e.rounds >= 20) {
      // An enemy's main: more weight the more they've played it and the more they win on it.
      const wr = e.wins / e.rounds
      parts.push({ v: Math.min(3, e.rounds / 150) * (1 + Math.max(0, (wr - 0.5) * 10)), why: `${e.player} mains it: ${e.rounds} rds, ${pct(wr)} WR` })
    }
    if (inp.yours.includes(op.key)) parts.push({ v: -4, why: 'You play it (costs you a pick)' })
    const score = parts.reduce((n, p) => n + p.v, 0)
    const reasons = parts.filter((p) => p.v > 0.3 || p.v < 0).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).map((p) => p.why)
    return { opKey: op.key, name: op.name, side: inp.side, score: Math.round(score * 10) / 10, reasons }
  })
  return out.filter((b) => b.score > 1.5).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, top)
}
