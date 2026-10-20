// Recommendation engine: estimates "your chance to win the round with this operator" here.
// Pure, deterministic, explainable. Every component is a win-rate delta (0.04 = +4 points):
//
//   est = yourBase + personal + site + teamNeed + meta + familiarity     (each × its user weight)
//
//   yourBase    your own win rate on this side (all games), the starting point
//   personal    how much better/worse YOU do with this operator (map/site-aware, shrunk to your base)
//   site        curated tiers for this site/map (S/A/map); for hard breach / anti-breach operators
//               the value scales with whether your team actually needs one
//   teamNeed    bonus when your team likely lacks a hard breacher (attack) / anti-breacher (defense),
//               estimated from teammates' picks this match and their mains; small for other roles
//   meta        crowd/season win rates (replays, players you met), else a tempered baseline
//   familiarity a little extra for operators you play a lot
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
  /** Replay-derived stats (map/site detail). `api` = Ubisoft Career stats (all your games, no map). */
  mine: { site?: AggMap; map?: AggMap; overall: AggMap; api?: AggMap }
  crowd: { site?: AggMap; map?: AggMap; overall?: AggMap }
  /** Team-rounds behind the crowd scope (exact pick-rate denominator). */
  crowdTeamRounds?: number
  /** Current-season operator stats of other players seen (Ubisoft Career), this side only. */
  crowdSeason?: AggMap
  crowdSeasonPlayers?: number
  /** operator id → 0..1 prior strength (only used, tempered, when no crowd data exists). */
  baseline: Map<string, number>
  /** operator id → recency-weighted play amount for the user. */
  recent?: Map<string, number>
  weights: Weights
  minRounds: number
  topN: number
  /** Curated tiers (operator ids): S/A for the site when given, and generally strong on the map. */
  specialists?: { S?: string[]; A?: string[]; map?: string[]; B?: string[]; kind?: string; /** per-site tiers, used when the site is not known yet */ mix?: { S: string[]; A: string[]; B: string[] }[]; /** how much evidence backs the site tiers (0–1) */ confidence?: number }
  /** Probability (0..1) that teammates already cover a role this round; missing = unknown. */
  teamCover?: Partial<Record<RoleTag, number>>
  /** How much more likely than usual the enemy brings each role (0–1), from the known enemy lobby. */
  enemyThreat?: Partial<Record<RoleTag, number>>
  /** Official ranked win delta per operator (Ubisoft, Platinum+, aggregated per bomb site). */
  rankedDelta?: Map<string, number>
  /** Share of pro games on this map where the operator was banned. */
  proBans?: Map<string, number>
}

/** The role a team really needs one of, per side. */
export const ESSENTIAL: Record<Side, RoleTag> = { attack: 'hb', defense: 'ah' }
/** Useful roles that deserve a smaller "team lacks it" bonus. */
/** Answers to what the enemy brings (kept to clear-cut ones). */
const COUNTERS: Record<Side, { threat: RoleTag; answer: RoleTag; label: string }[]> = {
  attack: [{ threat: 'ah', answer: 'uc', label: 'their anti-breach' }],
  defense: [{ threat: 'hb', answer: 'ah', label: 'their hard breachers' }, { threat: 'uc', answer: 'ap', label: 'their utility clear' }]
}
const COUNTER = 0.03
const SECONDARY: Record<Side, RoleTag[]> = { attack: ['uc', 'in'], defense: ['ap', 'in'] }
/** Chance a random teammate covers a role (used when nothing is known about the team). */
export const ROLE_PRIOR: Partial<Record<RoleTag, number>> = { hb: 0.2, ah: 0.3, uc: 0.3, ap: 0.15, in: 0.4 }
const ROLE_LABEL: Partial<Record<RoleTag, string>> = { hb: 'hard breach', uc: 'utility clear', in: 'intel', ah: 'anti-breach', ap: 'anti-projectile' }

/** Win-rate deltas (before weights). */
const SITE_S = 0.05, SITE_A = 0.03, SITE_B = 0.015, SITE_MAP = 0.012, SITE_OFF = -0.012
const NEED_ESSENTIAL = 0.05, NEED_SECONDARY = 0.015, DUPLICATE_ESSENTIAL = -0.015
const FAMILIAR = 0.015
/** Points removed per already-picked operator with the same primary role (keeps the top 3 varied). */
const DIVERSITY = 0.012

const sum = (m: AggMap | undefined): Agg => {
  const t = emptyAgg()
  for (const a of m?.values() ?? []) { t.rounds += a.rounds; t.wins += a.wins; t.kills += a.kills; t.deaths += a.deaths; t.headshots += a.headshots }
  return t
}
const get = (m: AggMap | undefined, id: string): Agg => m?.get(id) ?? emptyAgg()
/** Bayesian shrinkage of a rate toward a prior with strength k. */
const shrink = (hits: number, n: number, prior: number, k: number) => (hits + prior * k) / (n + k)
const pct = (x: number) => `${Math.round(x * 100)}%`
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(Math.abs(x) < 0.01 ? 1 : 0)}%`

/** Teammates' role coverage → probability nobody else brings it. */
export const needOf = (cover: Partial<Record<RoleTag, number>> | undefined, role: RoleTag, teammates = 4): number =>
  cover?.[role] !== undefined ? 1 - cover[role]! : (1 - (ROLE_PRIOR[role] ?? 0.25)) ** teammates

export function recommend(inp: RecInput): Recommendation[] {
  const banned = new Set(inp.banned ?? [])
  const pool = (inp.roster.length ? inp.roster.map((id) => operatorById(id)).filter((o) => !!o) : allOperators(inp.side))
    .filter((o) => o.side === inp.side && !banned.has(o.id) && !o.id.startsWith('x:'))
  const w: Partial<Weights> = inp.weights

  // Your base win rate on this side: Ubisoft (all games) when it covers more rounds than replays.
  const replayAll = sum(inp.mine.overall), apiAll = sum(inp.mine.api)
  const myAll = apiAll.rounds > replayAll.rounds ? apiAll : replayAll
  const base = shrink(myAll.wins, myAll.rounds, 0.5, 30)
  // Per-operator round outcomes are very noisy: your record needs ~6× "minRounds" to count fully.
  const k = Math.max(1, inp.minRounds) * 6

  const crowdScope = inp.site && inp.crowd.site ? inp.crowd.site : inp.mapKey && inp.crowd.map ? inp.crowd.map : inp.crowd.overall
  const seasonTotal = sum(inp.crowdSeason).rounds
  const maxRecent = Math.max(1, ...pool.map((o) => inp.recent?.get(o.id) ?? 0))
  const essential = ESSENTIAL[inp.side]
  const essentialNeed = needOf(inp.teamCover, essential)
  const hasSiteTiers = !!(inp.specialists?.S?.length || inp.specialists?.A?.length)
  const hasMapTiers = !!inp.specialists?.map?.length

  const recs = pool.map((op) => {
    const parts: { key: keyof Weights; value: number; reason: string }[] = []

    // Personal: hierarchical shrinkage overall → map → site, all toward your base.
    const o = get(inp.mine.overall, op.id), m = get(inp.mine.map, op.id), s = get(inp.mine.site, op.id), a = get(inp.mine.api, op.id)
    const oWr = a.rounds > o.rounds ? a : o
    const wrO = shrink(oWr.wins, oWr.rounds, base, k)
    const wrM = shrink(m.wins, m.rounds, wrO, k)
    const wrS = shrink(s.wins, s.rounds, wrM, k)
    const wr = inp.site ? wrS : inp.mapKey ? wrM : wrO
    const scope: Recommendation['scope'] = inp.site && s.rounds ? 'site' : inp.mapKey && m.rounds ? 'map' : oWr.rounds ? 'overall' : 'none'
    const shown = scope === 'site' ? s : scope === 'map' ? m : oWr
    if (shown.rounds) {
      const where = scope === 'site' ? 'this site' : scope === 'map' ? 'this map' : 'all your games'
      parts.push({ key: 'personal', value: wr - base, reason: `You: ${pct(shown.wins / shown.rounds)} in ${shown.rounds} rds (${where})` })
    }

    // Site fit. Hard breach / anti-breach value depends on whether the team needs one.
    const isEssential = op.roles.includes(essential)
    const tier: Recommendation['tier'] = inp.specialists?.S?.includes(op.id) ? 'S' : inp.specialists?.A?.includes(op.id) ? 'A'
      : inp.specialists?.B?.includes(op.id) ? 'B' : inp.specialists?.map?.includes(op.id) ? 'map' : null
    const conf = inp.specialists?.confidence ?? 1
    let siteDelta = tier === 'S' ? SITE_S * conf : tier === 'A' ? SITE_A * conf : tier === 'B' ? SITE_B : tier === 'map' ? (hasSiteTiers ? SITE_MAP * 0.5 : SITE_MAP * 2) : hasSiteTiers || hasMapTiers ? SITE_OFF : 0
    if (isEssential && siteDelta > 0) siteDelta *= 0.35 + 0.65 * essentialNeed
    // Site not known yet: expected site fit over the map's sites (strong on 2 of 4 → about half).
    const mix = inp.specialists?.mix
    let mixReason: string | null = null
    if (!hasSiteTiers && mix?.length) {
      const per = mix.map((t) => (t.S.includes(op.id) ? SITE_S : t.A.includes(op.id) ? SITE_A : t.B.includes(op.id) ? SITE_B : SITE_OFF))
      siteDelta = per.reduce((n, v) => n + v, 0) / per.length + (tier === 'map' ? SITE_MAP * 0.5 : 0)
      if (isEssential && siteDelta > 0) siteDelta *= 0.35 + 0.65 * essentialNeed
      const strong = per.filter((v) => v >= SITE_A).length
      mixReason = strong ? `Strong on ${strong} of ${per.length} sites` : per.some((v) => v > 0) ? 'Fits some sites here' : 'Not a pick on this map'
    }
    if (siteDelta !== 0) {
      const reason = tier === 'S' ? 'Site specialist (S)' : tier === 'A' ? 'Strong on this site (A)' : tier === 'B' ? `Fits ${inp.specialists?.kind ?? 'this'} sites` : tier === 'map' ? ((inp.proBans?.get(op.id) ?? 0) >= 0.25 ? `Pro must-ban on this map (${pct(inp.proBans!.get(op.id)!)} of games)` : 'Good on this map') : 'Not a pick for this site'
      parts.push({ key: 'site', value: siteDelta, reason: mixReason ?? reason })
    }

    // Team need: does the team lack what this operator brings?
    if (isEssential) {
      const label = ROLE_LABEL[essential]!
      const v = NEED_ESSENTIAL * essentialNeed + DUPLICATE_ESSENTIAL * (1 - essentialNeed)
      const cap = `${label[0]!.toUpperCase()}${label.slice(1)}`
      const reason = essentialNeed >= 0.65 ? `Team likely lacks ${label}` : essentialNeed <= 0.35 ? `${cap} likely covered` : `Team may need ${label}`
      parts.push({ key: 'role', value: v, reason })
    } else {
      const fills = SECONDARY[inp.side].filter((r) => op.roles.includes(r))
      const best = fills.map((r) => ({ r, need: needOf(inp.teamCover, r) })).sort((x, y) => y.need - x.need)[0]
      if (best && best.need > 0.3) parts.push({ key: 'role', value: NEED_SECONDARY * best.need, reason: `Adds ${ROLE_LABEL[best.r]}` })
    }

    // Counters: the enemy lobby is known and brings more of a threat than usual.
    for (const c of COUNTERS[inp.side]) {
      const t = inp.enemyThreat?.[c.threat] ?? 0
      if (t > 0.1 && op.roles.includes(c.answer)) parts.push({ key: 'role', value: COUNTER * t, reason: `Counters ${c.label}` })
    }

    // Meta: replay crowd (map/site detail) → season crowd (players you met) → tempered baseline.
    const c = get(crowdScope, op.id), sc = get(inp.crowdSeason, op.id)
    const wC = c.rounds / (c.rounds + 60)
    // Players-you-met data only counts fully once it spans ~30 players (a few heavy mains skew it).
    const playersFactor = Math.min(1, (inp.crowdSeasonPlayers ?? 0) / 30)
    const wS = playersFactor * (sc.rounds / (sc.rounds + 200))
    // Official ranked win delta when measured, else a tempered curated baseline.
    const official = inp.rankedDelta?.get(op.id)
    const baseDelta = official ?? ((inp.baseline.get(op.id) ?? 0.55) - 0.55) * 0.06
    // Crowd/season win rates include player-skill selection, so they are tempered (×0.6); the official
    // ranked delta is already a per-site win delta and is used as measured.
    const fallback = official ?? 0.6 * baseDelta
    const metaDelta = wC * 0.6 * (shrink(c.wins, c.rounds, 0.5, 60) - 0.5) + (1 - wC) * (wS * 0.6 * (shrink(sc.wins, sc.rounds, 0.5, 200) - 0.5) + (1 - wS) * fallback)
    const metaReason = c.rounds >= 10 ? `Meta here: ${pct(c.wins / c.rounds)} WR (${c.rounds} rds)`
      : sc.rounds >= 20 && playersFactor >= 0.5 ? `Season meta: ${pct(sc.wins / sc.rounds)} WR · in ${pct(Math.min(1, (sc.rounds * 5) / Math.max(1, seasonTotal)))} of rounds (${inp.crowdSeasonPlayers ?? 0} players)`
      : official !== undefined ? 'Ranked meta (official, Plat+)'
      : 'Baseline strength'
    if (Math.abs(metaDelta) >= 0.002) parts.push({ key: 'meta', value: metaDelta, reason: metaReason })

    // Familiarity.
    const comfort = (inp.recent?.get(op.id) ?? 0) / maxRecent
    if (comfort > 0.15) parts.push({ key: 'comfort', value: FAMILIAR * comfort, reason: comfort >= 0.6 ? 'You play it a lot' : 'You play it' })

    const est = Math.min(0.85, Math.max(0.15, base + parts.reduce((n, p) => n + (w[p.key] ?? 1) * p.value, 0)))
    const reasons = parts
      .map((p) => ({ ...p, eff: (w[p.key] ?? 1) * p.value }))
      .filter((p) => Math.abs(p.eff) >= 0.004 || p.key === 'personal')
      .sort((x, y) => Math.abs(y.eff) - Math.abs(x.eff))
      .slice(0, 3)
      .map((p) => `${p.reason} ${signed(p.eff)}`)
    return {
      operatorId: op.id, name: op.name, score: Math.round(est * 100), est, reasons, personal: shown, scope,
      metaRounds: c.rounds, baseline: c.rounds < 10 && sc.rounds < 20, tier
    }
  })

  const ranked = recs.sort((x, y) => y.est - x.est || x.name.localeCompare(y.name))
  // Role diversity: a later pick repeating an already-picked primary role loses a little.
  const picked: typeof ranked = []
  const roleOf = (id: string) => operatorById(id)?.roles[0]
  while (picked.length < Math.max(1, inp.topN) && picked.length < ranked.length) {
    let best: (typeof ranked)[number] | undefined
    let bestEst = -Infinity
    for (const r of ranked) {
      if (picked.some((p) => p.operatorId === r.operatorId)) continue
      const adjusted = r.est - DIVERSITY * picked.filter((p) => roleOf(p.operatorId) === roleOf(r.operatorId)).length
      if (adjusted > bestEst) { bestEst = adjusted; best = r }
    }
    picked.push(best!)
  }
  return picked.map(({ est: _est, ...r }) => r)
}

/** Baseline priors (by operator id) for a map from a dataset keyed by operator key. */
export function baselineFor(ds: { baseline: Record<string, number>; mapBaseline?: Record<string, Record<string, number>> }, mapKey: string | null): Map<string, number> {
  const merged = { ...ds.baseline, ...(mapKey ? ds.mapBaseline?.[mapKey] : undefined) }
  const out = new Map<string, number>()
  for (const op of allOperators()) if (merged[op.key] !== undefined) out.set(op.id, merged[op.key]!)
  return out
}
