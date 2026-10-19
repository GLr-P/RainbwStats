// Query layer shared by IPC handlers and the live engine.
import type { Db } from './db'
import type { Dataset } from '../shared/data/dataset'
import type { ApiOps, GlobalFilter, GlobalMeta, GuideOp, LivePlayer, MapBans, MapGuide, MetaRow, OpStatRow, Recommendation, Settings } from '../shared/ipc'
import { baselineFor, recommend, ROLE_PRIOR, type AggMap } from '../shared/recommend'
import { allOperators, operatorById, operatorByKey, operatorName, sideOfOperator } from '../shared/catalog'
import type { RoleTag } from '../shared/data/operators'
import { KIND_FIT, mapStrongFor, proBansFor, seedSitesFor, siteKindFor, siteTiersFor } from '../shared/data/sitePicks'
import { meta } from '../shared/data/meta'
import type { Agg, Side } from '../shared/types'
import { bandOf, type CrowdMeta } from '../shared/crowd'
import { suggestBans } from '../shared/bans'

export interface Ctx {
  db: Db
  settings: () => Settings
  dataset: () => Dataset
  /** The user's Ubisoft profile id (login, else most common replay recorder). */
  me: () => string | null
  /** Downloaded global crowd meta for the current season (null = none yet). */
  crowd?: () => CrowdMeta | null
}

type OpCount = { rounds: number; wins: number; players: number }
/** Global ranked Career stats per operator key (one rank band, or all). */
export function globalOps(g: CrowdMeta | null, band?: number): Map<string, OpCount> {
  const out = new Map<string, OpCount>()
  for (const [op, b, rounds, wins, n] of g?.ops ?? []) {
    if (band !== undefined && b !== band) continue
    const a = out.get(op) ?? { rounds: 0, wins: 0, players: 0 }
    out.set(op, { rounds: a.rounds + rounds, wins: a.wins + wins, players: a.players + n })
  }
  return out
}
/** Global replay rounds per operator key for a side / map / site. */
export function globalSites(g: CrowdMeta | null, f: { side?: Side; mapKey?: string; site?: string }): Map<string, OpCount> {
  const out = new Map<string, OpCount>()
  for (const [map, site, side, op, rounds, wins] of g?.sites ?? []) {
    if ((f.side && side !== f.side) || (f.mapKey && map !== f.mapKey) || (f.site && site !== f.site)) continue
    const a = out.get(op) ?? { rounds: 0, wins: 0, players: 0 }
    out.set(op, { rounds: a.rounds + rounds, wins: a.wins + wins, players: 0 })
  }
  return out
}
const toAggMap = (m: Map<string, OpCount>, side: Side): AggMap => new Map([...m].flatMap(([k, a]): [string, Agg][] => {
  const op = operatorByKey(k)
  return op && op.side === side ? [[op.id, { rounds: a.rounds, wins: a.wins, kills: 0, deaths: 0, headshots: 0 }]] : []
}))
const total = (m: AggMap | undefined) => [...(m ?? new Map<string, Agg>()).values()].reduce((n, a) => n + a.rounds, 0)
/** The larger sample of two (global data includes what you shared, so they are not summed). */
const bigger = (a: AggMap, b: AggMap): AggMap => (total(b) > total(a) ? b : a)
/** Players in a band = most players on any operator in it. */
const bandPlayers = (g: CrowdMeta | null, band: number) => Math.max(0, ...(g?.ops ?? []).filter((x) => x[1] === band).map((x) => x[4]))
/** Your rank band, when the global data has enough players in it (else null = all ranks). */
export function yourBand(ctx: Ctx, g: CrowdMeta | null, minPlayers = 30): number | null {
  const me = ctx.me()
  const rank = me ? ctx.db.latestRank(me) : null
  if (!rank) return null
  const band = bandOf(rank)
  return bandPlayers(g, band) >= minPlayers ? band : null
}

const DAY = 86_400_000

export function recentWeights(ctx: Ctx, side: Side, now = Date.now()): Map<string, number> {
  const me = ctx.me()
  const out = new Map<string, number>()
  if (!me) return out
  for (const r of ctx.db.recentOps(me, side)) {
    const age = Math.max(0, now - Date.parse(r.at)) / DAY
    out.set(r.op, (out.get(r.op) ?? 0) + Math.exp(-age / 30))
  }
  return out
}

/** Ubisoft Career aggregates (by operator key) → AggMap by operator id for one side. */
function apiAggMap(ctx: Ctx, side: Side, f: { profileId?: string; excludeProfileId?: string; season: string }): { map: AggMap; players: number } {
  const map: AggMap = new Map()
  let players = 0
  for (const [key, a] of ctx.db.apiOpAggs(f)) {
    const op = operatorByKey(key)
    if (!op || op.side !== side) continue
    map.set(op.id, { rounds: a.rounds, wins: a.wins, kills: 0, deaths: 0, headshots: 0 })
    players = Math.max(players, a.players)
  }
  return { map, players: f.excludeProfileId !== undefined ? ctx.db.apiPlayerCount(f.season, f.excludeProfileId) : players }
}

export const currentSeason = (ctx: Ctx): string => ctx.dataset().season

/** A player's most played operators (current season, falling back to lifetime). */
export function mainsOf(ctx: Ctx, profileId: string, top = 3): LivePlayer['mains'] {
  const pick = (season: string) => [...ctx.db.apiOpAggs({ profileId, season })]
    .map(([key, a]) => ({ op: operatorByKey(key), ...a }))
    .filter((x) => x.op && x.rounds > 0)
    .sort((a, b) => b.rounds - a.rounds)
    .slice(0, top)
    .map((x) => ({ opKey: x.op!.key, name: x.op!.name, side: x.op!.side, rounds: x.rounds, wins: x.wins }))
  const season = pick(currentSeason(ctx))
  return season.length ? season : pick('all')
}

/** Ubisoft Career operator table for the Operators/Meta pages. */
export function apiOps(ctx: Ctx, f: { who: 'me' | 'others'; season: string; playlist?: string }, lastError: string | null): ApiOps {
  const me = ctx.me() ?? ''
  const aggs = ctx.db.apiOpAggs({ season: f.season, playlist: f.playlist, ...(f.who === 'me' ? { profileId: me } : { excludeProfileId: me }) })
  const rows = [...aggs].map(([key, a]) => {
    const op = operatorByKey(key)
    return op ? { opKey: key, name: op.name, side: op.side, ...a } : null
  }).filter((x): x is ApiOps['rows'][number] => !!x).sort((a, b) => b.rounds - a.rounds)
  const seasons = [...new Set(['all', currentSeason(ctx), ...ctx.db.apiSeasons(me)])]
  return { rows, players: f.who === 'me' ? (rows.length ? 1 : 0) : ctx.db.apiPlayerCount(f.season, me), seasons, current: currentSeason(ctx), lastError }
}

/** Minimum lifetime rounds on an operator for it to count as one you play. */
export const PLAYED_MIN_ROUNDS = 10

/** Operators you actually play on a side (Ubisoft lifetime + replays). */
export function playedPool(ctx: Ctx, side: Side): string[] {
  const me = ctx.me()
  if (!me) return []
  const ids = new Set<string>()
  for (const [id, a] of apiAggMap(ctx, side, { profileId: me, season: 'all' }).map) if (a.rounds >= PLAYED_MIN_ROUNDS) ids.add(id)
  for (const [id, a] of ctx.db.opAggs({ profileId: me, side })) if (a.rounds >= PLAYED_MIN_ROUNDS) ids.add(id)
  return [...ids]
}

/** Roster used for recommendations: your explicit roster, else the operators you play (when you
 *  have enough history for a real choice), else everyone. */
export function effectiveRoster(ctx: Ctx, side: Side): string[] {
  const explicit = rosterIds(ctx.settings(), side)
  if (explicit.length) return explicit
  const played = playedPool(ctx, side)
  return played.length >= 4 ? played : []
}

export function rosterIds(s: Settings, side: Side): string[] {
  return s.roster[side].map((k) => operatorByKey(k)?.id).filter((x): x is string => !!x)
}

/** Who is on your team this round, for "does the team need a hard breacher / anti-breacher?". */
export interface Teammate { ops: { operatorId: string; side: Side | null }[]; profileId: string }

/** Probability that at least one teammate covers each role on this side. Per teammate: share of
 *  their picks this match on this side with the role, else share of their (Ubisoft) rounds on such
 *  operators, else a prior. Missing teammates (unknown lobby) count with the prior. */
export function teamCoverFor(ctx: Ctx, side: Side, teammates: Teammate[]): Partial<Record<RoleTag, number>> {
  const roles: RoleTag[] = ['hb', 'ah', 'uc', 'ap', 'in']
  const lack = Object.fromEntries(roles.map((r) => [r, 1])) as Record<RoleTag, number>
  const known = teammates.slice(0, 4)
  for (const t of known) {
    const played = t.ops.filter((o) => o.side === side).map((o) => operatorById(o.operatorId)).filter((o) => !!o)
    let share: (r: RoleTag) => number
    if (played.length) share = (r) => played.filter((o) => o.roles.includes(r)).length / played.length
    else {
      const rows = [...ctx.db.apiOpAggs({ profileId: t.profileId, season: 'all' })].map(([k, a]) => ({ op: operatorByKey(k), rounds: a.rounds })).filter((x) => x.op?.side === side)
      const total = rows.reduce((n, x) => n + x.rounds, 0)
      share = total >= 20 ? (r) => rows.filter((x) => x.op!.roles.includes(r)).reduce((n, x) => n + x.rounds, 0) / total : (r) => ROLE_PRIOR[r] ?? 0.25
    }
    for (const r of roles) lack[r] *= 1 - Math.min(0.95, share(r))
  }
  for (let i = known.length; i < 4; i++) for (const r of roles) lack[r] *= 1 - (ROLE_PRIOR[r] ?? 0.25)
  return Object.fromEntries(roles.map((r) => [r, 1 - lack[r]]))
}

export function recsFor(ctx: Ctx, q: { mapKey: string | null; side: Side; site: string | null; teammates?: Teammate[]; banned?: string[]; topN?: number; anyOperator?: boolean }): Recommendation[] {
  const s = ctx.settings()
  const me = ctx.me()
  const mineF = (extra: object) => (me ? ctx.db.opAggs({ profileId: me, side: q.side, ...extra }) : new Map())
  const season = currentSeason(ctx)
  const myApi = me ? apiAggMap(ctx, q.side, { profileId: me, season: 'all' }).map : new Map()
  // Season meta: everyone on RainbwStats (your rank band when it has enough players) or the players you met.
  const g = ctx.crowd?.() ?? null
  const band = yourBand(ctx, g)
  const metPlayers = apiAggMap(ctx, q.side, { excludeProfileId: me ?? '', season })
  const globalPlayers = band !== null ? bandPlayers(g, band) : g?.players ?? 0
  const crowdSeason = globalPlayers > metPlayers.players ? { map: toAggMap(globalOps(g, band ?? undefined), q.side), players: globalPlayers } : metPlayers
  // Familiarity: replay recency plus how much you've played each op this season (Ubisoft).
  const recent = recentWeights(ctx, q.side)
  if (me) for (const [id, a] of apiAggMap(ctx, q.side, { profileId: me, season }).map) recent.set(id, (recent.get(id) ?? 0) + a.rounds * 0.3)
  // Curated tiers for this map (and site): operator keys → ids for this side.
  const ids = (keys?: string[]) => (keys ?? []).map((k) => operatorByKey(k)).filter((o) => o?.side === q.side).map((o) => o!.id)
  const siteTiers = q.mapKey && q.site ? siteTiersFor(q.mapKey, q.site, q.side) : undefined
  const kind = q.mapKey && q.site ? siteKindFor(q.mapKey, q.site) : undefined
  const mix = q.mapKey && !q.site ? sitesFor(ctx, q.mapKey).slice(0, 5).map(({ site }) => {
    const t = siteTiersFor(q.mapKey!, site, q.side)
    return { S: ids(t?.S), A: ids(t?.A), B: ids(KIND_FIT[q.side][siteKindFor(q.mapKey!, site)]) }
  }) : undefined
  const kindLabel = kind === 'upper' ? 'upper-floor' : kind === 'ground' ? 'ground-floor' : kind
  const specialists = q.mapKey ? { map: ids(mapStrongFor(q.mapKey, q.side)), S: ids(siteTiers?.S), A: ids(siteTiers?.A), B: kind ? ids(KIND_FIT[q.side][kind]) : undefined, kind: kindLabel, mix, confidence: siteTiers?.confidence } : undefined
  // Official ranked win delta (Platinum+, per-site aggregated) and pro ban rates on this map.
  const byId = (o: Record<string, number> | undefined) => new Map<string, number>(
    Object.entries(o ?? {}).flatMap(([k, v]): [string, number][] => { const id = operatorByKey(k)?.id; return id ? [[id, v]] : [] }))
  const rankedDelta = byId(meta().ranked.winDelta[q.side])
  const proBans = q.mapKey ? byId(proBansFor(q.mapKey)) : new Map<string, number>()
  return recommend({
    specialists, rankedDelta, proBans,
    teamCover: teamCoverFor(ctx, q.side, q.teammates ?? []),
    crowdSeason: crowdSeason.map, crowdSeasonPlayers: crowdSeason.players,
    side: q.side, mapKey: q.mapKey, site: q.site, roster: q.anyOperator ? [] : effectiveRoster(ctx, q.side), banned: q.banned,
    mine: {
      overall: mineF({}),
      api: myApi,
      map: q.mapKey ? mineF({ mapKey: q.mapKey }) : undefined,
      site: q.mapKey && q.site ? mineF({ mapKey: q.mapKey, site: q.site }) : undefined
    },
    crowdTeamRounds: ctx.db.teamRounds({ side: q.side, mapKey: q.mapKey ?? undefined, site: q.mapKey && q.site ? q.site : undefined }),
    crowd: {
      overall: bigger(ctx.db.opAggs({ side: q.side }), toAggMap(globalSites(g, { side: q.side }), q.side)),
      map: q.mapKey ? bigger(ctx.db.opAggs({ mapKey: q.mapKey, side: q.side }), toAggMap(globalSites(g, { side: q.side, mapKey: q.mapKey }), q.side)) : undefined,
      site: q.mapKey && q.site ? bigger(ctx.db.opAggs({ mapKey: q.mapKey, site: q.site, side: q.side }), toAggMap(globalSites(g, { side: q.side, mapKey: q.mapKey, site: q.site }), q.side)) : undefined
    },
    baseline: baselineFor(ctx.dataset(), q.mapKey),
    recent,
    weights: s.weights, minRounds: s.minRounds, topN: q.topN ?? s.topN
  })
}

/** Sites for a map: learned from replays, else the approximate seed list. */
export function sitesFor(ctx: Ctx, mapKey: string): { site: string; rounds: number }[] {
  const learned = ctx.db.sites(mapKey)
  // Replay-learned names first, then researched/seed sites not already covered (by room names).
  const roomsOf = (x: string) => x.split(',').map((h) => h.trim().replace(/^(\d+F|B\d?)\s+/i, '').toLowerCase())
  const seeds = seedSitesFor(mapKey).filter((seed) => !learned.some((l) => roomsOf(l.site).some((r) => roomsOf(seed).includes(r))))
  return [...learned, ...seeds.map((site) => ({ site, rounds: 0 }))]
}

export function siteRecsFor(ctx: Ctx, mapKey: string, side: Side, perSite = 3, teammates: Teammate[] = []): { site: string; recs: Recommendation[] }[] {
  return sitesFor(ctx, mapKey).slice(0, 5).map(({ site }) => ({ site, recs: recsFor(ctx, { mapKey, side, site, topN: perSite, teammates }) }))
}

export function opStats(ctx: Ctx, f: { mine: boolean; mapKey?: string; site?: string; side?: Side; season?: string }): OpStatRow[] {
  const me = ctx.me()
  if (f.mine && !me) return []
  const aggs = ctx.db.opAggs({ profileId: f.mine ? me! : undefined, mapKey: f.mapKey, site: f.site, side: f.side, season: f.season })
  return [...aggs].map(([id, agg]) => ({ operatorId: id, name: operatorName(id), side: sideOfOperator(id) ?? f.side ?? 'attack', agg }))
    .sort((a, b) => b.agg.rounds - a.agg.rounds)
}

export function metaRows(ctx: Ctx, f: { mapKey?: string; site?: string; side: Side; season?: string }): MetaRow[] {
  const aggs = ctx.db.opAggs({ mapKey: f.mapKey, site: f.site, side: f.side, season: f.season })
  const teamRounds = Math.max(1, ctx.db.teamRounds(f))
  const base = baselineFor(ctx.dataset(), f.mapKey ?? null)
  return allOperators(f.side).map((op): MetaRow => {
    const a = aggs.get(op.id)
    return a && a.rounds
      ? { operatorId: op.id, name: op.name, side: f.side, rounds: a.rounds, winRate: a.wins / a.rounds, pickRate: Math.min(1, a.rounds / teamRounds), source: 'replays' }
      : { operatorId: op.id, name: op.name, side: f.side, rounds: 0, winRate: base.get(op.id) ?? 0.5, pickRate: 0, source: 'baseline' }
  }).sort((a, b) => b.rounds - a.rounds || b.winRate - a.winRate)
}

/** Best operator outside your explicit roster, if it beats your top pick by 3+ points. */
export function outsideRosterPick(ctx: Ctx, q: { mapKey: string; side: Side; site: string | null; teammates?: Teammate[] }, top: Recommendation | undefined): Recommendation | null {
  const roster = rosterIds(ctx.settings(), q.side)
  if (!roster.length) return null
  const best = recsFor(ctx, { ...q, anyOperator: true, topN: 8 }).find((r) => !roster.includes(r.operatorId))
  return best && (!top || best.score >= top.score + 3) ? best : null
}

/** Everything the Maps tab shows for one map and side (researched data + your picks per site). */
export function mapGuide(ctx: Ctx, mapKey: string, side: Side): MapGuide {
  const m = meta()
  const delta = m.ranked.winDelta[side]
  const proRates = proBansFor(mapKey)
  const me = ctx.me()
  const mine = me ? ctx.db.apiOpAggs({ profileId: me, season: 'all' }) : new Map<string, { rounds: number; wins: number }>()
  const cell = (key: string): GuideOp => {
    const op = operatorByKey(key)
    const you = mine.get(key)
    return { key, name: op?.name ?? key, winDelta: delta[key] ?? null, proBan: proRates[key] ?? null, yourRounds: you?.rounds ?? 0, yourWinRate: you?.rounds ? you.wins / you.rounds : null }
  }
  // Sorted by win delta (official ranked), unknown deltas last, then by pro ban rate.
  const byDelta = (a: GuideOp, b: GuideOp) => (b.winDelta ?? -1) - (a.winDelta ?? -1) || (b.proBan ?? 0) - (a.proBan ?? 0) || a.name.localeCompare(b.name)
  const sites = sitesFor(ctx, mapKey).slice(0, 5).map(({ site }) => {
    const t = siteTiersFor(mapKey, site, side)
    return {
      name: site, kind: siteKindFor(mapKey, site), source: (t?.source ?? 'none') as MapGuide['sites'][number]['source'], confidence: t?.confidence ?? 0,
      S: (t?.S ?? []).filter((k) => operatorByKey(k)?.side === side).map(cell).sort(byDelta),
      A: (t?.A ?? []).filter((k) => operatorByKey(k)?.side === side).map(cell).sort(byDelta),
      picks: recsFor(ctx, { mapKey, side, site, topN: 3 })
    }
  })
  const proBans = Object.entries(proRates).filter(([k]) => operatorByKey(k)?.side === side).map(([k]) => cell(k)).sort((a, b) => (b.proBan ?? 0) - (a.proBan ?? 0))
  const ranked = allOperators(side).map((op) => ({ ...cell(op.key), banRate: m.ranked.bans[side][op.key] ?? null }))
    .filter((r) => r.winDelta !== null || r.banRate !== null).sort(byDelta)
  return {
    mapKey, side, sites, bans: banSuggestions(ctx, mapKey), strong: mapStrongFor(mapKey, side).map(cell).sort(byDelta), proBans, proGames: m.maps[mapKey]?.proBans.games ?? 0,
    ranked, info: { version: m.version, patch: m.patch, rankedScope: m.ranked.scope, sources: m.sources, notes: m.notes }
  }
}

/** The Meta page's Global view. Without a map: ranked Career stats per rank band; with a map: replay rounds. */
export function globalMeta(ctx: Ctx, f: GlobalFilter, status: Pick<GlobalMeta, 'sharing' | 'lastError' | 'lastUpload'>): GlobalMeta {
  const g = ctx.crowd?.() ?? null
  const me = ctx.me()
  const rank = me ? ctx.db.latestRank(me) : null
  const career = !f.mapKey
  const counts = career ? globalOps(g, f.band) : globalSites(g, { mapKey: f.mapKey, site: f.site || undefined })
  const rows = [...counts].flatMap(([key, a]) => {
    const op = operatorByKey(key)
    return op ? [{ opKey: key, name: op.name, side: op.side, rounds: a.rounds, wins: a.wins, players: career ? a.players : null }] : []
  })
  const sites = f.mapKey ? [...new Set((g?.sites ?? []).filter((x) => x[0] === f.mapKey).map((x) => x[1]))].sort() : []
  return {
    available: !!g, season: currentSeason(ctx), generatedAt: g?.generatedAt ?? null,
    players: career ? (f.band !== undefined ? bandPlayers(g, f.band) : g?.players ?? 0) : 0,
    rounds: career ? 0 : rows.reduce((n, r) => n + r.rounds, 0),
    scope: career ? 'career' : 'replays', rows, sites, yourBand: rank ? bandOf(rank) : null, ...status
  }
}

/** Global win delta per operator key on a side (vs that side's average, shrunk ~500 rounds), when 30+ players share. */
export function globalDelta(ctx: Ctx, side: Side): Record<string, number> | undefined {
  const g = ctx.crowd?.() ?? null
  const band = yourBand(ctx, g)
  if ((band !== null ? bandPlayers(g, band) : g?.players ?? 0) < 30) return undefined
  const rows = [...globalOps(g, band ?? undefined)].filter(([k]) => operatorByKey(k)?.side === side)
  const n = rows.reduce((s, [, a]) => s + a.rounds, 0)
  if (!n) return undefined
  const avg = rows.reduce((s, [, a]) => s + a.wins, 0) / n
  return Object.fromEntries(rows.map(([k, a]) => [k, (a.wins + avg * 500) / (a.rounds + 500) - avg]))
}

/** Suggested bans on a map for both sides (each team bans one attacker and one defender). */
export function banSuggestions(ctx: Ctx, mapKey: string, top = 3): MapBans {
  const m = meta()
  const forSide = (side: Side) => suggestBans({
    side, candidates: allOperators(side).map((o) => ({ key: o.key, name: o.name })),
    winDelta: m.ranked.winDelta[side], rankedBan: m.ranked.bans[side], proBan: proBansFor(mapKey), strong: mapStrongFor(mapKey, side),
    crowdDelta: globalDelta(ctx, side),
    yours: effectiveRoster(ctx, side).map((id) => operatorById(id)?.key).filter((k): k is string => !!k)
  }, top)
  return { attack: forSide('attack'), defense: forSide('defense') }
}
