// Local SQLite store (built-in node:sqlite). All queries live here so the schema stays in one place.
import { DatabaseSync } from 'node:sqlite'
import type { Agg, RoundRecord, Side } from '../shared/types'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS rounds (
  match_id TEXT NOT NULL, round INTEGER NOT NULL, played_at TEXT NOT NULL, season TEXT NOT NULL,
  game_version TEXT NOT NULL, match_type INTEGER NOT NULL, map_key TEXT NOT NULL, site TEXT NOT NULL,
  recording_profile_id TEXT NOT NULL, PRIMARY KEY (match_id, round)
);
CREATE TABLE IF NOT EXISTS round_players (
  match_id TEXT NOT NULL, round INTEGER NOT NULL, profile_id TEXT NOT NULL, username TEXT NOT NULL,
  team INTEGER NOT NULL, side TEXT, operator_id TEXT NOT NULL, won INTEGER NOT NULL,
  kills INTEGER NOT NULL, died INTEGER NOT NULL, headshots INTEGER NOT NULL,
  PRIMARY KEY (match_id, round, profile_id)
);
CREATE INDEX IF NOT EXISTS rp_profile ON round_players(profile_id);
CREATE INDEX IF NOT EXISTS rp_op ON round_players(operator_id, side);
CREATE INDEX IF NOT EXISTS rounds_map ON rounds(map_key, site);
CREATE TABLE IF NOT EXISTS players (
  profile_id TEXT PRIMARY KEY, username TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rank_snapshots (
  profile_id TEXT NOT NULL, fetched_at TEXT NOT NULL, board TEXT NOT NULL, season_id INTEGER NOT NULL,
  rank INTEGER, rank_points INTEGER, max_rank INTEGER, max_rank_points INTEGER,
  wins INTEGER, losses INTEGER, abandons INTEGER, kills INTEGER, deaths INTEGER,
  PRIMARY KEY (profile_id, board, season_id, fetched_at)
);
CREATE TABLE IF NOT EXISTS ingested_files (
  path TEXT PRIMARY KEY, mtime_ms INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export interface AggFilter {
  profileId?: string // only this player's rows; omit = everyone seen in replays
  mapKey?: string
  site?: string
  side?: Side
  season?: string
}

export interface RankSnapshot {
  profileId: string; board: string; seasonId: number; rank: number; rankPoints: number
  maxRank: number; maxRankPoints: number; wins: number; losses: number; abandons: number
  kills: number; deaths: number; fetchedAt: string
}

export type Db = ReturnType<typeof openDb>

export function openDb(path: string) {
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)

  const insRound = db.prepare(`INSERT OR REPLACE INTO rounds VALUES (?,?,?,?,?,?,?,?,?)`)
  const insRP = db.prepare(`INSERT OR REPLACE INTO round_players VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  const upPlayer = db.prepare(`INSERT INTO players VALUES (?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET
    username = excluded.username, last_seen = max(last_seen, excluded.last_seen)`)
  const getKv = db.prepare(`SELECT value FROM kv WHERE key = ?`)
  const setKv = db.prepare(`INSERT OR REPLACE INTO kv VALUES (?, ?)`)

  function tx<T>(fn: () => T): T {
    db.exec('BEGIN')
    try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
  }

  return {
    raw: db,
    close: () => db.close(),
    tx,

    saveRound(r: RoundRecord): void {
      tx(() => {
        insRound.run(r.matchId, r.round, r.playedAt, r.season, r.gameVersion, r.matchType, r.mapKey, r.site, r.recordingProfileId)
        for (const p of r.players) {
          insRP.run(r.matchId, r.round, p.profileId, p.username, p.teamIndex, p.side, p.operatorId, +p.won, p.kills, +p.died, p.headshots)
          if (!p.profileId.startsWith('name:')) upPlayer.run(p.profileId, p.username, r.playedAt, r.playedAt)
        }
      })
    },

    counts(): { rounds: number; matches: number; players: number } {
      return db.prepare(`SELECT (SELECT count(*) FROM rounds) rounds, (SELECT count(DISTINCT match_id) FROM rounds) matches,
        (SELECT count(*) FROM players) players`).get() as { rounds: number; matches: number; players: number }
    },

    /** Per-operator aggregates for a filter. */
    opAggs(f: AggFilter = {}): Map<string, Agg> {
      const where: string[] = []
      const args: (string | number)[] = []
      if (f.profileId) { where.push('rp.profile_id = ?'); args.push(f.profileId) }
      if (f.mapKey) { where.push('r.map_key = ?'); args.push(f.mapKey) }
      if (f.site) { where.push('r.site = ?'); args.push(f.site) }
      if (f.side) { where.push('rp.side = ?'); args.push(f.side) }
      if (f.season) { where.push('r.season = ?'); args.push(f.season) }
      const rows = db.prepare(`SELECT rp.operator_id op, count(*) rounds, sum(rp.won) wins, sum(rp.kills) kills,
          sum(rp.died) deaths, sum(rp.headshots) headshots
        FROM round_players rp JOIN rounds r USING (match_id, round)
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY rp.operator_id`).all(...args) as unknown as
        ({ op: string } & Agg)[]
      return new Map(rows.map(({ op, ...a }) => [op, a]))
    },

    /** Number of (round × team) slots on a side for a filter: the pick-rate denominator. */
    teamRounds(f: AggFilter = {}): number {
      const where = ['rp.side IS NOT NULL']
      const args: string[] = []
      if (f.mapKey) { where.push('r.map_key = ?'); args.push(f.mapKey) }
      if (f.site) { where.push('r.site = ?'); args.push(f.site) }
      if (f.side) { where.push('rp.side = ?'); args.push(f.side) }
      if (f.season) { where.push('r.season = ?'); args.push(f.season) }
      return (db.prepare(`SELECT count(*) n FROM (SELECT DISTINCT rp.match_id, rp.round, rp.team FROM round_players rp
        JOIN rounds r USING (match_id, round) WHERE ${where.join(' AND ')})`).get(...args) as { n: number }).n
    },

    /** Sites seen per map (learned from replays), with round counts. */
    sites(mapKey: string): { site: string; rounds: number }[] {
      return db.prepare(`SELECT site, count(*) rounds FROM rounds WHERE map_key = ? AND site != '' GROUP BY site ORDER BY rounds DESC`)
        .all(mapKey) as { site: string; rounds: number }[]
    },

    seasons(): string[] {
      return (db.prepare(`SELECT DISTINCT season FROM rounds ORDER BY season DESC`).all() as { season: string }[]).map((r) => r.season)
    },

    roundsOfMatch(matchId: string): RoundRecord[] {
      const rounds = db.prepare(`SELECT * FROM rounds WHERE match_id = ? ORDER BY round`).all(matchId) as Record<string, string | number>[]
      const rps = db.prepare(`SELECT * FROM round_players WHERE match_id = ? ORDER BY round, team`).all(matchId) as Record<string, string | number>[]
      return rounds.map((r) => ({
        matchId, round: Number(r['round']), playedAt: String(r['played_at']), season: String(r['season']),
        gameVersion: String(r['game_version']), matchType: Number(r['match_type']), mapKey: String(r['map_key']),
        site: String(r['site']), recordingProfileId: String(r['recording_profile_id']),
        players: rps.filter((p) => p['round'] === r['round']).map((p) => ({
          profileId: String(p['profile_id']), username: String(p['username']), teamIndex: Number(p['team']) as 0 | 1,
          side: (p['side'] as Side | null) ?? null, operatorId: String(p['operator_id']), won: !!p['won'],
          kills: Number(p['kills']), died: !!p['died'], headshots: Number(p['headshots'])
        }))
      }))
    },

    recentMatches(limit = 20): { matchId: string; playedAt: string; mapKey: string; rounds: number; season: string }[] {
      return db.prepare(`SELECT match_id matchId, min(played_at) playedAt, map_key mapKey, count(*) rounds, season
        FROM rounds GROUP BY match_id ORDER BY playedAt DESC LIMIT ?`).all(limit) as never
    },

    fileStatus(path: string): { mtime_ms: number; ok: number } | undefined {
      return db.prepare(`SELECT mtime_ms, ok FROM ingested_files WHERE path = ?`).get(path) as never
    },
    markFile(path: string, mtimeMs: number, error?: string): void {
      db.prepare(`INSERT OR REPLACE INTO ingested_files VALUES (?,?,?,?)`).run(path, mtimeMs, error ? 0 : 1, error ?? null)
    },

    saveRank(s: RankSnapshot): void {
      db.prepare(`INSERT OR REPLACE INTO rank_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        s.profileId, s.fetchedAt, s.board, s.seasonId, s.rank, s.rankPoints, s.maxRank, s.maxRankPoints,
        s.wins, s.losses, s.abandons, s.kills, s.deaths)
    },
    /** Latest snapshot per (board, season) for a player: their rank history. */
    rankHistory(profileId: string): RankSnapshot[] {
      return db.prepare(`SELECT profile_id profileId, board, season_id seasonId, rank, rank_points rankPoints, max_rank maxRank,
          max_rank_points maxRankPoints, wins, losses, abandons, kills, deaths, max(fetched_at) fetchedAt
        FROM rank_snapshots WHERE profile_id = ? GROUP BY board, season_id ORDER BY season_id DESC`).all(profileId) as never
    },

    /** (operator, played_at) rows for recency-weighted comfort. */
    recentOps(profileId: string, side: Side): { op: string; at: string }[] {
      return db.prepare(`SELECT rp.operator_id op, r.played_at at FROM round_players rp JOIN rounds r USING (match_id, round)
        WHERE rp.profile_id = ? AND rp.side = ? ORDER BY r.played_at DESC LIMIT 2000`).all(profileId, side) as never
    },
    /** The profile that records most replays on this PC: the user. */
    mostCommonRecorder(): string | null {
      const row = db.prepare(`SELECT recording_profile_id p FROM rounds WHERE recording_profile_id != '' GROUP BY p ORDER BY count(*) DESC LIMIT 1`).get() as { p: string } | undefined
      return row?.p ?? null
    },
    playerName(profileId: string): string | null {
      return (db.prepare(`SELECT username FROM players WHERE profile_id = ?`).get(profileId) as { username: string } | undefined)?.username ?? null
    },
    encounters(profileId: string, me: string): number {
      return (db.prepare(`SELECT count(DISTINCT a.match_id) n FROM round_players a JOIN round_players b USING (match_id, round)
        WHERE a.profile_id = ? AND b.profile_id = ?`).get(profileId, me) as { n: number }).n
    },
    findPlayerByName(name: string): string | null {
      return (db.prepare(`SELECT profile_id FROM players WHERE lower(username) = lower(?) ORDER BY last_seen DESC LIMIT 1`).get(name) as { profile_id: string } | undefined)?.profile_id ?? null
    },
    latestMatch(): { matchId: string; lastAt: string } | null {
      return (db.prepare(`SELECT match_id matchId, max(played_at) lastAt FROM rounds GROUP BY match_id ORDER BY lastAt DESC LIMIT 1`).get() as never) ?? null
    },

    getJson<T>(key: string): T | undefined {
      const row = getKv.get(key) as { value: string } | undefined
      return row ? (JSON.parse(row.value) as T) : undefined
    },
    setJson(key: string, value: unknown): void { setKv.run(key, JSON.stringify(value)) }
  }
}
