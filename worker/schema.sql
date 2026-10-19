-- RainbwStats global crowd database (Cloudflare D1). Apply: npx wrangler d1 execute rainbwstats --remote --file=schema.sql
-- Players are pseudonymous: p = HMAC of the Ubisoft profile id (no names are ever sent).

-- Ubisoft Career ranked stats per player, operator and season (cumulative, so the newest upload replaces older ones).
CREATE TABLE IF NOT EXISTS op_stats (
  p TEXT NOT NULL, season TEXT NOT NULL, op TEXT NOT NULL,
  rounds INTEGER NOT NULL, wins INTEGER NOT NULL, band INTEGER NOT NULL, updated INTEGER NOT NULL,
  PRIMARY KEY (p, season, op)
);
CREATE INDEX IF NOT EXISTS op_season ON op_stats(season);

-- One row per (round, player) from Match Replay files; k = HMAC(match|round|player) so overlapping uploads dedupe.
CREATE TABLE IF NOT EXISTS rounds (
  k TEXT PRIMARY KEY, season TEXT NOT NULL, type INTEGER NOT NULL, map TEXT NOT NULL, site TEXT NOT NULL,
  side TEXT NOT NULL, op TEXT NOT NULL, won INTEGER NOT NULL, band INTEGER NOT NULL, added INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rounds_season ON rounds(season);

-- Aggregated JSON per season, rebuilt by the cron trigger.
CREATE TABLE IF NOT EXISTS agg (season TEXT PRIMARY KEY, json TEXT NOT NULL, at INTEGER NOT NULL);
