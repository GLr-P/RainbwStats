// Recommendation engine: pure, deterministic, explainable. See PLAN.md §2 "Recommendation model".
import { allOperators, operatorById } from './catalog'
import type { RoleTag } from './data/operators'
import type { Recommendation, Weights } from './ipc'
import { emptyAgg, type Agg, type Side } from './types'

export type AggMap = Map<string, Agg>

export interface RecInput {
  side: Side
  mapKey: string | null
  site: string | null
  /** Operator ids the user is willing to play; empty = whole side. */
  roster: string[]
  banned?: string[]
  teammateOps?: string[]
  mine: { site?: AggMap; map?: AggMap; overall: AggMap }
  crowd: { site?: AggMap; map?: AggMap; overall?: AggMap }
  /** Team-rounds behind the crowd scope (exact pick-rate denominator); estimated when absent. */
  crowdTeamRounds?: number
  /** operator id → 0..1 prior strength (map-specific when available). */
  baseline: Map<string, number>
  /** operator id → recency-weighted play count for the user. */
  recent?: Map<string, number>
  weights: Weights
  minRounds: number
  topN: number
}

const ESSENTIAL: Record<Side, RoleTag[]> = { attack: ['hb', 'uc', 'in'], defense: ['ah', 'ap', 'in'] }
const ROLE_LABEL: Partial<Record<RoleTag, string>> = { hb: 'hard breach', uc: 'utility clear', in: 'intel', ah: 'anti hard-breach', ap: 'anti-projectile' }
/** Crowd rounds at which crowd data and baseline weigh equally. */
const CROWD_K = 40

const sum = (m: AggMap | undefined): Agg => {
  const t = emptyAgg()
  for (const a of m?.values() ?? []) { t.rounds += a.rounds; t.wins += a.wins; t.kills += a.kills; t.deaths += a.deaths; t.headshots += a.headshots }
  return t
}
const get = (m: AggMap | undefined, id: string): Agg => m?.get(id) ?? emptyAgg()
/** Bayesian shrinkage of a rate toward a prior with strength k. */
const shrink = (hits: number, n: number, prior: number, k: number) => (hits + prior * k) / (n + k)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const pct = (x: number) => `${Math.round(x * 100)}%`

export function recommend(inp: RecInput): Recommendation[] {
  const banned = new Set(inp.banned ?? [])
  const pool = (inp.roster.length ? inp.roster.map((id) => operatorById(id)).filter((o) => !!o) : allOperators(inp.side))
    .filter((o) => o.side === inp.side && !banned.has(o.id))

  // Priors from the user's own overall performance on this side.
  const myAll = sum(inp.mine.overall)
  const priorWr = shrink(myAll.wins, myAll.rounds, 0.5, 20)
  const priorKpr = shrink(myAll.kills, myAll.rounds, 0.7, 20)
  const k = Math.max(1, inp.minRounds)

  // Crowd totals give pick-rate denominators (player-rounds on this side).
  const crowdScope = inp.site && inp.crowd.site ? inp.crowd.site : inp.mapKey && inp.crowd.map ? inp.crowd.map : inp.crowd.overall
  const crowdTotal = sum(crowdScope).rounds
  const sideOps = allOperators(inp.side).length || 1

  const teamRoles = new Set((inp.teammateOps ?? []).flatMap((id) => operatorById(id)?.roles ?? []))
  const maxRecent = Math.max(1, ...pool.map((o) => inp.recent?.get(o.id) ?? 0))

  const recs = pool.map((op): Recommendation & { parts: number[] } => {
    // Personal: hierarchical shrinkage overall → map → site.
    const o = get(inp.mine.overall, op.id), m = get(inp.mine.map, op.id), s = get(inp.mine.site, op.id)
    const wrO = shrink(o.wins, o.rounds, priorWr, k), kprO = shrink(o.kills, o.rounds, priorKpr, k)
    const wrM = shrink(m.wins, m.rounds, wrO, k), kprM = shrink(m.kills, m.rounds, kprO, k)
    const wrS = shrink(s.wins, s.rounds, wrM, k), kprS = shrink(s.kills, s.rounds, kprM, k)
    const [wr, kpr] = inp.site ? [wrS, kprS] : inp.mapKey ? [wrM, kprM] : [wrO, kprO]
    const scope: Recommendation['scope'] = inp.site && s.rounds ? 'site' : inp.mapKey && m.rounds ? 'map' : o.rounds ? 'overall' : 'none'
    const shown = scope === 'site' ? s : scope === 'map' ? m : o
    // Rank by a lower confidence bound so tiny samples don't win on luck.
    const nEff = inp.site ? s.rounds + 0.5 * m.rounds + 0.25 * o.rounds : inp.mapKey ? m.rounds + 0.5 * o.rounds : o.rounds
    const wrLcb = wr - 0.5 * Math.sqrt((wr * (1 - wr)) / (nEff + k))
    // Relative to an op with no data (same penalty, prior mean) so "no data" scores a neutral 0.5.
    const priorLcb = priorWr - 0.5 * Math.sqrt((priorWr * (1 - priorWr)) / k)
    const personal = clamp01(0.5 + (wrLcb - priorLcb) * 2.5 + (kpr - priorKpr) * 0.5)

    // Meta: crowd win-rate delta + pick share, blended with baseline by sample size.
    const c = get(crowdScope, op.id)
    const base = inp.baseline.get(op.id) ?? 0.5
    const crowdWr = shrink(c.wins, c.rounds, 0.5, 30)
    // Pick rate ≈ share of team-rounds featuring the op (5 player slots per team-round).
    const pickRate = inp.crowdTeamRounds ? Math.min(1, c.rounds / inp.crowdTeamRounds) : crowdTotal ? Math.min(1, (c.rounds * 5) / crowdTotal) : 0
    const relPick = crowdTotal ? (c.rounds / crowdTotal) * sideOps : 1
    const pickTerm = Math.max(-0.15, Math.min(0.15, 0.05 * Math.log2(Math.max(relPick, 1 / 64))))
    const crowdScore = clamp01(0.5 + (crowdWr - 0.5) * 3 + pickTerm)
    const wCrowd = c.rounds / (c.rounds + CROWD_K)
    const meta = wCrowd * crowdScore + (1 - wCrowd) * base

    // Comfort: how much the user actually plays it (recency-weighted).
    const comfort = (inp.recent?.get(op.id) ?? 0) / maxRecent

    // Team fit: fills an essential role the known teammates lack (mild prior when unknown).
    const missing = ESSENTIAL[inp.side].filter((r) => !teamRoles.has(r))
    const fills = op.roles.filter((r) => missing.includes(r))
    const teamfit = inp.teammateOps?.length ? (fills.length ? 1 : 0.3) : fills.length ? 0.65 : 0.45

    const w = inp.weights
    const parts = [personal, meta, comfort, teamfit]
    const wsum = w.personal + w.meta + w.comfort + w.teamfit || 1
    const score = Math.round(((w.personal * personal + w.meta * meta + w.comfort * comfort + w.teamfit * teamfit) / wsum) * 100)

    const reasons: string[] = []
    const where = scope === 'site' ? 'this site' : scope === 'map' ? 'this map' : 'overall'
    if (shown.rounds) reasons.push(`You: ${pct(shown.wins / shown.rounds)} WR, ${(shown.kills / Math.max(1, shown.deaths)).toFixed(2)} K/D in ${shown.rounds} rds (${where})`)
    if (c.rounds >= 5) reasons.push(`Meta: ${pct(c.wins / c.rounds)} WR · ${pct(pickRate)} pick (${c.rounds} rds)`)
    else reasons.push(`Baseline strength ${pct(base)}`)
    if (comfort >= 0.6) reasons.push('One of your most played')
    if (inp.teammateOps?.length && fills.length) reasons.push(`Team lacks ${fills.map((r) => ROLE_LABEL[r] ?? r).join(' + ')}`)

    return { operatorId: op.id, name: op.name, score, reasons, personal: shown, scope, metaRounds: c.rounds, baseline: c.rounds < 5, parts }
  })

  return recs
    .sort((a, b) => b.score - a.score || b.parts[1]! - a.parts[1]! || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, inp.topN))
    .map(({ parts: _parts, ...r }) => r)
}

/** Baseline priors (by operator id) for a map from a dataset keyed by operator key. */
export function baselineFor(ds: { baseline: Record<string, number>; mapBaseline?: Record<string, Record<string, number>> }, mapKey: string | null): Map<string, number> {
  const merged = { ...ds.baseline, ...(mapKey ? ds.mapBaseline?.[mapKey] : undefined) }
  const out = new Map<string, number>()
  for (const op of allOperators()) if (merged[op.key] !== undefined) out.set(op.id, merged[op.key]!)
  return out
}
