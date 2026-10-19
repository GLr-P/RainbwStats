// RainbwStats crowd API (Cloudflare Worker + D1).
//   POST /v1/ingest        opt-in uploads from the app (validated, rate limited, deduped)
//   GET  /v1/meta?season=  aggregated season data (rebuilt every 3 h by cron)
//   GET  /v1/seasons       seasons with data
import { cleanUpload, type CrowdMeta } from '../../src/shared/crowd'

interface D1Stmt { bind(...v: unknown[]): D1Stmt; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null>; run(): Promise<unknown> }
interface Env {
  DB: { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown[]> }
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> }
}

const CUSTOM_GAMES = [3, 4] // replay match types excluded from the meta (custom local / online)
const HEADERS = { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
const json = (v: unknown, status = 200, cache = 'no-store') => new Response(JSON.stringify(v), { status, headers: { ...HEADERS, 'cache-control': cache } })

async function ingest(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
  if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) return json({ error: 'rate limited' }, 429)
  if (Number(req.headers.get('content-length') ?? 0) > 1_000_000) return json({ error: 'too large' }, 413)
  const body = cleanUpload(await req.json().catch(() => null))
  if (!body) return json({ error: 'bad request' }, 400)
  const now = Date.now()
  const opSql = env.DB.prepare(`INSERT INTO op_stats (p, season, op, rounds, wins, band, updated) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(p, season, op) DO UPDATE SET rounds = excluded.rounds, wins = excluded.wins, band = excluded.band, updated = excluded.updated
    WHERE excluded.rounds > op_stats.rounds OR excluded.band != op_stats.band`)
  const rdSql = env.DB.prepare(`INSERT OR IGNORE INTO rounds VALUES (?,?,?,?,?,?,?,?,?,?)`)
  const stmts = [
    ...body.ops.map((r) => opSql.bind(r.p, r.season, r.op, r.rounds, r.wins, r.band, now)),
    ...body.rounds.map((r) => rdSql.bind(r.k, r.season, r.type, r.map, r.site, r.side, r.op, r.won, r.band, now))
  ]
  for (let i = 0; i < stmts.length; i += 200) await env.DB.batch(stmts.slice(i, i + 200))
  return json({ ok: true, ops: body.ops.length, rounds: body.rounds.length })
}

async function build(env: Env, season: string): Promise<CrowdMeta> {
  const ops = await env.DB.prepare(`SELECT op, band, sum(rounds) r, sum(wins) w, count(*) n FROM op_stats WHERE season = ? GROUP BY op, band`)
    .bind(season).all<{ op: string; band: number; r: number; w: number; n: number }>()
  const players = await env.DB.prepare(`SELECT count(DISTINCT p) n FROM op_stats WHERE season = ?`).bind(season).first<{ n: number }>()
  const sites = await env.DB.prepare(`SELECT map, site, side, op, count(*) r, sum(won) w FROM rounds
    WHERE season = ? AND type NOT IN (${CUSTOM_GAMES.join(',')}) GROUP BY map, site, side, op`)
    .bind(season).all<{ map: string; site: string; side: 'attack' | 'defense'; op: string; r: number; w: number }>()
  const meta: CrowdMeta = {
    season, generatedAt: Date.now(), players: players?.n ?? 0,
    ops: ops.results.map((x) => [x.op, x.band, x.r, x.w, x.n]),
    rounds: sites.results.reduce((n, x) => n + x.r, 0),
    sites: sites.results.map((x) => [x.map, x.site, x.side, x.op, x.r, x.w])
  }
  await env.DB.prepare(`INSERT OR REPLACE INTO agg VALUES (?, ?, ?)`).bind(season, JSON.stringify(meta), meta.generatedAt).run()
  return meta
}

/** Seasons that received data in the last 60 days. */
async function activeSeasons(env: Env): Promise<string[]> {
  const since = Date.now() - 60 * 86_400_000
  const rows = await env.DB.prepare(`SELECT DISTINCT season FROM op_stats WHERE updated > ?1 UNION SELECT DISTINCT season FROM rounds WHERE added > ?1`)
    .bind(since).all<{ season: string }>()
  return rows.results.map((r) => r.season)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...HEADERS, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type' } })
    try {
      if (url.pathname === '/v1/ingest' && req.method === 'POST') return await ingest(req, env)
      if (url.pathname === '/v1/meta' && req.method === 'GET') {
        const season = url.searchParams.get('season') ?? ''
        if (!/^Y\d{1,2}S[1-4]$/.test(season)) return json({ error: 'season required' }, 400)
        const row = await env.DB.prepare(`SELECT json FROM agg WHERE season = ?`).bind(season).first<{ json: string }>()
        // First request for a season builds it once; afterwards the cron keeps it fresh.
        const body = row?.json ?? JSON.stringify(await build(env, season))
        return new Response(body, { headers: { ...HEADERS, 'cache-control': 'public, max-age=900' } })
      }
      if (url.pathname === '/v1/seasons') return json((await env.DB.prepare(`SELECT season, at FROM agg ORDER BY season DESC`).all()).results, 200, 'public, max-age=900')
      if (url.pathname === '/' || url.pathname === '/v1/health') return json({ ok: true, service: 'rainbwstats-crowd' })
      return json({ error: 'not found' }, 404)
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'error' }, 500)
    }
  },
  async scheduled(_c: unknown, env: Env): Promise<void> {
    for (const s of await activeSeasons(env)) await build(env, s)
  }
}
