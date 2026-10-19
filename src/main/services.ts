// Query layer shared by IPC handlers and the live engine.
import type { Db } from './db'
import type { Dataset } from '../shared/data/dataset'
import type { MetaRow, OpStatRow, Recommendation, Settings } from '../shared/ipc'
import { baselineFor, recommend } from '../shared/recommend'
import { allOperators, operatorByKey, operatorName, sideOfOperator } from '../shared/catalog'
import type { Side } from '../shared/types'

export interface Ctx {
  db: Db
  settings: () => Settings
  dataset: () => Dataset
  /** The user's Ubisoft profile id (login, else most common replay recorder). */
  me: () => string | null
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

export function rosterIds(s: Settings, side: Side): string[] {
  return s.roster[side].map((k) => operatorByKey(k)?.id).filter((x): x is string => !!x)
}

export function recsFor(ctx: Ctx, q: { mapKey: string | null; side: Side; site: string | null; teammateOps?: string[]; banned?: string[]; topN?: number }): Recommendation[] {
  const s = ctx.settings()
  const me = ctx.me()
  const mineF = (extra: object) => (me ? ctx.db.opAggs({ profileId: me, side: q.side, ...extra }) : new Map())
  return recommend({
    side: q.side, mapKey: q.mapKey, site: q.site, roster: rosterIds(s, q.side), banned: q.banned, teammateOps: q.teammateOps,
    mine: {
      overall: mineF({}),
      map: q.mapKey ? mineF({ mapKey: q.mapKey }) : undefined,
      site: q.mapKey && q.site ? mineF({ mapKey: q.mapKey, site: q.site }) : undefined
    },
    crowdTeamRounds: ctx.db.teamRounds({ side: q.side, mapKey: q.mapKey ?? undefined, site: q.mapKey && q.site ? q.site : undefined }),
    crowd: {
      overall: ctx.db.opAggs({ side: q.side }),
      map: q.mapKey ? ctx.db.opAggs({ mapKey: q.mapKey, side: q.side }) : undefined,
      site: q.mapKey && q.site ? ctx.db.opAggs({ mapKey: q.mapKey, site: q.site, side: q.side }) : undefined
    },
    baseline: baselineFor(ctx.dataset(), q.mapKey),
    recent: recentWeights(ctx, q.side),
    weights: s.weights, minRounds: s.minRounds, topN: q.topN ?? s.topN
  })
}

export function siteRecsFor(ctx: Ctx, mapKey: string, side: Side, perSite = 3): { site: string; recs: Recommendation[] }[] {
  return ctx.db.sites(mapKey).slice(0, 5).map(({ site }) => ({ site, recs: recsFor(ctx, { mapKey, side, site, topN: perSite }) }))
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
