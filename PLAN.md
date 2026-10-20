# RainbwStats — Master Plan

Ad-free Windows desktop companion for Rainbow Six Siege X: live lobby stats, personal operator
analytics, and per-map/site operator recommendations from your own roster. Built for speed: once
a match is detected, the screen should be readable with zero clicks.

This file is the source of truth. Every phase has a Definition of Done (DoD). A phase is done only
when every DoD box is ticked and the verification log has an entry with test output.

---

## 1. Research findings (2026-10-19, Y11S3 "Operation Split Fire", Ranked 3.0)

| Source | What it gives | Status / risk |
|---|---|---|
| **Match Replay `.rec` files** (`<game>/MatchReplay/Match-*/…-RNN.rec`) | Map, game mode, match type, game version, **site**, all 10 players (name + Ubisoft profile ID), **operator per player per round**, kills/headshots/plants/defuses, round winner | Best source. Written **at end of each round**. Format reverse-engineered by `redraskal/r6-dissect` (Go, MIT, works on Y11S3 with minor patches). We port it to TS. Requires "Match Replay" enabled in game settings. Bans not confirmed. |
| **Ubisoft services API** (unofficial, needs a Ubisoft login) | Profile lookup by name/ID, **rank/RP/max rank/W-L/K-D per board** (`ranked`, `standard`, `dual_front`) for up to N profiles in one call, level, playtime | Works (CNDRD/siegeapi, Feb 2026). Per-player **operator/map endpoints died with Siege X**, and past-season ranks are unclear. |
| tracker.gg (scraping) | Operators/maps/match history for any player | Cloudflare-protected, against their ToS. **Not used** (maybe an optional opt-in later). |
| Screen capture + Windows OCR | Map name and side **before round 1** (replays don't exist yet) | Passive (same as OBS/Discord), BattlEye-safe. Fragile → opt-in, vocabulary-matched. |
| Game memory reading / injection | Everything | **Never.** BattlEye ban risk. |

Consequences:
- **The global operator database (pick/win per map/site/side, per patch) gets built from replays.**
  Locally from your matches (all 10 players per round = 10 data points per round). Globally later
  via opt-in anonymous uploads (Phase 8).
- **Live lobby:** round 1 shows map/side (OCR) plus recommendations. Once R01 is written (about 3 min
  in), all 10 players are known by profile ID, so ranks come from one batched API call.
  Recommendations re-rank for every later round (you re-pick each round).
- **Past ranks:** we snapshot every rank we ever fetch into a local history table (it builds over time).
  Past-season endpoints are to be probed in Phase 2.
- **Data that changes every season** (operator IDs, map IDs, sites, meta weights) lives in a remote
  JSON dataset on GitHub Pages, so new seasons are fixed by pushing JSON, not by shipping an app update.

## 2. Architecture

```
Electron (Windows)
├─ main/            Node side, owns all I/O
│  ├─ db            node:sqlite, single file in %APPDATA%/RainbwStats (WAL mode)
│  ├─ replay/       parser (TS port of r6-dissect), folder watcher, ingest → rounds/players tables
│  ├─ ubi/          auth (+2FA, ticket refresh), profiles, full_profiles, stats; batching + cache
│  ├─ ocr/          screen grab (desktopCapturer) → persistent PowerShell WinRT OCR worker → vocab match
│  ├─ live/         match state machine: idle → loading(OCR) → in-round → between-rounds → ended
│  └─ meta/         fetch remote dataset (stale-while-revalidate, disk cache)
├─ shared/          types, static seed data, recommendation engine (pure), stats math (pure)
├─ preload/         typed, minimal IPC bridge (contextIsolation on, nodeIntegration off)
└─ renderer/        React + CSS variables (themeable). Pages: Live · Operators · Players · Meta · Settings
GitHub
├─ Actions          CI (typecheck + tests on windows-latest), Release (tag → NSIS + portable → Releases)
└─ Pages            landing page + /data/meta/*.json (app pulls this)
```

### Speed budget (acceptance numbers)
| Path | Target |
|---|---|
| Cold start → UI painted with cached data | < 1.5 s |
| New `.rec` file → parsed header → live page updated | < 300 ms |
| Lobby ranks (10 players, warm auth ticket) | < 1.5 s (one batched request) |
| Recommendation recompute | < 10 ms (precomputed aggregates) |
| OCR map/side detection after loading screen appears | < 3 s |

How we hit them: cache-first UI, auth ticket refreshed in background before expiry, keep-alive HTTP,
batched profile calls, aggregates materialized at ingest time (not at read time), parsing only the
header for live and the full parse after, and OCR only on downscaled crops, only while Siege runs.

### Recommendation model (v0.3: estimated round win chance, unit-tested)
```
est(op) = yourBase + wP·personal + wS·site + wR·teamNeed + wM·meta + wC·familiarity   (weights ×0–2)
yourBase  = your win rate on this side (Ubisoft all games, shrunk to 50%)
personal  = your WR with the op (site→map→overall shrinkage, k = 6×minRounds) − yourBase
site      = curated S/A tiers per site, B = fits this kind of site (basement/upper/ground), map list;
            site unknown → average over the map's sites; hard breach/anti-breach value × team need
teamNeed  = P(no teammate brings hard breach / anti-breach) from teammates' picks this match + mains
meta      = replay crowd → season crowd (players met) → tempered baseline
```
Every recommendation shows **why** and **sample size** ("62% WR · 21 rounds on 2F Kids/Dorms").
Weights are user-configurable in Settings.

## 3. Phases

Legend: [ ] todo · [x] done. Each phase ends with: tests green → PLAN updated → commit → push.

### Phase 0 — Foundation
- [x] Research data sources (above)
- [x] Repo, MIT license, README (with ToS / safety disclaimer), CLAUDE.md
- [x] Scaffold: electron-vite + React + TS strict, vitest, `npm run check` (typecheck + tests)
- [x] CI workflow on windows-latest
- [x] Public GitHub repo, first push
- DoD: `npm run check` passes locally and in CI; `npm run dev` opens a window.

### Phase 1 — Replay parser + local stats DB
- [x] Port r6-dissect header/player/feedback/scoreboard parsing to `src/main/replay/` (unknown IDs never throw)
- [x] Operator/map/site ID tables in shared seed data (overridable by remote dataset)
- [x] Investigate ban data in the Y11S3 fixture → **no ban fields in Y11S3 header props**; bans need OCR (ban screen) or crowd data
- [x] SQLite schema: matches, rounds, round_players, players, rank_snapshots, op_agg (materialized)
- [x] Ingest a folder of replays idempotently (by match ID + round)
- [x] Auto-detect game folder (Steam libraryfolders.vdf + Ubisoft Connect registry + settings override)
- DoD: parses the local Y11S3 replay (6 rounds) with correct map/site/ops/winner; ingest twice = no dupes; parse < 100 ms per round.

### Phase 2 — Ubisoft API client
- [x] Login (email/password, safeStorage-encrypted), 2FA code flow, ticket cache + background refresh
- [x] Profiles by name / by IDs (batched), full_profiles (rank/RP/max/W-L/K-D) batched, level/playtime
- [x] Response guards (never crash on shape change), 429 backoff, 10-min per-player cache
- [x] Rank snapshot on every fetch → history
- [x] Past-season ranks: the official Career module (r6s_career.iife.js) reads `RankingRankSeasonal` via /v1/profiles/stats + calendarEntryId. Fetched once per past season for you (v0.6.2, Me tab). Not yet checked against a live response (value assumed = full_profiles rank id; values outside 1–40 hidden). Lobby players (last 3) and Players page (all) since v0.6.8
- DoD: unit tests on recorded fixtures; manual test with a real login (user step).

### Phase 3 — Recommendation engine + roster + seed meta
- [x] Operator metadata (side, roles, speed) for the full Y11S3 roster
- [x] Seed meta dataset v1 (baseline tiers, flagged "baseline" in UI) + map/site list
- [x] Engine with explainable reasons + configurable weights
- [x] Auto-learn unknown operators (new seasons) from replay header role names
- DoD: unit tests cover cold start (no data), roster filtering, bans, site-specific vs map fallback, determinism.

### Phase 4 — UI
- [x] R6-styled theme (dark, angular cuts, condensed caps type, attack orange / defense blue), CSS-variable tokens
- [x] **Live page** (single glanceable screen): map/side/site header · your top-3 picks with reasons · both teams (rank, RP, K/D, W/L, level, ops this match) · round timeline
- [x] Roster sidebar (toggle the ops you're willing to play, quick presets)
- [x] Operators page (your stats by op × map × site × side, per patch)
- [x] Players page (lookup, rank history, encounters)
- [x] Meta page (pick/win by map/site/side, per patch, sample sizes)
- [x] Settings: theme colors, density, font scale, panels on/off, weights, paths, always-on-top, compact mode
- DoD: every page renders with empty DB and with fixture data; readable at 1080p from arm's length (min 14px body).

### Phase 5 — Live engine (zero interaction)
- [x] Detect Siege process; watch MatchReplay; state machine; auto-switch to Live page
- [x] On new round file: header parse → lobby fetch → recompute recs → push to UI
- [x] Tray icon, launch-at-login option, single instance
- DoD: simulated replay drop (copy fixture rounds in with delays) drives the full UI flow within budget.

### Phase 6 — Round-1 OCR (opt-in)
- [x] Persistent Windows OCR worker, desktopCapturer frames, fuzzy vocab (maps, ATTACK/DEFENSE, sites)
- [x] Debug capture mode (Settings toggle: last 40 frames + recognized text)
- DoD: matcher unit tests; manual validation in a real match (user step).

### Phase 7 — Ship
- [x] electron-builder NSIS + portable, release workflow on tag, electron-updater from GitHub Releases
- [x] GitHub Pages: landing page + hosted meta dataset; app pulls dataset with disk cache
- DoD: tagged release downloads + installs + auto-detects replay folder on a clean profile.

### Phase 8 — Global crowd database (the "pick/ban/WR for everyone" feature) ✅
- [x] Opt-in pseudonymous upload (Settings → Global database, off by default): lobby players' ranked Career op stats this season + rank band, replay player-rounds (map/site/side/op/result). HMAC ids, no names; sent once (crowd_sent_* tables)
- [x] Cloudflare Worker + D1 (free tier, `worker/`): validated ingest, per-IP rate limit, dedupe (rounds by key, Career rows keep the newest), cron aggregation every 3 h → JSON per season
- [x] App downloads for everyone (cached, 3 h): Meta → Global (rank band / map / site, sortable); recommendations use global data when it beats local samples (your rank band once it has 30+ players)
- [ ] Bans: not in replays or Career stats; needs ban-phase OCR (backlog)

### Phase 9 — Ubisoft Career operator stats (no replays needed) ✅
- [x] Found by reading the official Career page code (ubisoft.com/…/siege/services/career): `/v1/profiles/stats` with stat names `Round{Played,Won}OperatorConsolePlaylist[Seasonal]` (+ `calendarEntryId` per season, Y7S4→Y11S3). Works for PC, for **any** player, and **batched** (40 ids/request)
- [x] Official operator table (78 ops, hex ids, sides) + season calendar ids → `src/shared/data/statsIds.ts`. Confirms Rauora=attack, Denari=defense; adds Noor
- [x] Your history: lifetime + every season (past seasons fetched once), current season hourly. Survives reinstalls / works on any PC
- [x] Lobby: lifetime + current season for all 10 players, 2 requests per match, cached 12 h → **Mains** column in the lobby
- [x] Season meta from every player you meet (Meta page, "Players I've met") → feeds recommendations between replay meta and baseline
- [x] Recommendations: your Ubisoft win rate per operator when replays are thin; season play time feeds comfort

### Phase 10 — Overwolf live game data (round 1 / sides, like R6 Tracker)
- [ ] Owner: Overwolf developer account + request GEP for Rainbow Six Siege (game id 10826) for RainbwStats via DevRel
- [~] Switch runtime to @overwolf/ow-electron: done on branch `overwolf-runtime` (electron aliased to @overwolf/ow-electron@42.11.4, overwolf.packages ["gep"], scripts use ow-electron, dist uses ow-electron-builder; typecheck + smoke OK). Blocked: ow-electron-builder needs OW_CLI_EMAIL / OW_CLI_API_KEY / OW_BUILD_KEY env vars, and owepm says "invalid verification" until Overwolf registers the app. After merging: `npm install` then `node node_modules/electron/install.js` (npm allow-scripts skips the binary download), add `"overwolf": { "packages": ["gep"] }`
- [x] GEP adapter (src/main/gep, dormant on plain Electron, 3 tests from the documented payloads): match_info.map_id / match_start → map before round 1; game_info.phase (operator_select/loading); match.round; roster_XX (player, team Blue/Orange, operator) → teams + sides from operators; feed LiveEngine as an override source (replaces OCR when available)
- [ ] Keep replay + OCR paths as fallback (GEP unavailable in custom games / when Overwolf is off)

### Next (proposed order)
1. ~~Rank-banded meta~~ ✅ v0.6.1 (players you met, by their rank; global data by band since v0.4.0)
2. ~~Ban suggestions~~ ✅ v0.4.1 (map-based; the enemy lobby isn't known until round 1 ends)
4. ~~Export/import local data between PCs~~ ✅ v0.6.0 (+ CSV, overlay window, OCR debug toggle)

### Backlog / expansion
Opt-in tracker.gg enrichment · in-game overlay window · ban-phase OCR · teammate-aware recs ·
weapon/attachment stats from replays (not in .rec files) · ~~export CSV~~ ✅ · ~~per-patch diff view~~ ✅ v0.6.1.

## 4. Risk register
| Risk | Mitigation |
|---|---|
| New season adds unknown operator/map IDs | Unknown IDs → `Unknown(id)`, never throw; ID tables in remote dataset; role inferred from team side |
| Replay format change | Parser isolated + fixture tests; header-only fallback; error surfaced in UI, app keeps working |
| User has Match Replay disabled | Onboarding check: folder exists + recent files; show exact steps to enable |
| Ubisoft API change / block / rate limit | Isolated client, shape guards, batching, caching, backoff; app degrades to replay-only. Login app ids are an ordered fallback list (UBI.loginAppIds); edge blocks (HTML 403) are detected and skipped |
| 2FA accounts | Implemented 2FA flow; README suggests an alt account |
| Credential safety | Electron safeStorage (DPAPI), only ever sent to ubiservices.ubi.com, never logged |
| Exclusive-fullscreen capture fails | OCR is opt-in; suggest borderless; replay path still works from round 2 |
| Privacy (other players' names) | Stored locally only; raw replays never committed (gitignored fixtures) |
| Electron security | contextIsolation, sandboxed renderer, strict CSP, typed IPC allowlist |
| ToS | Passive reads only; user's own account; clear disclaimer; not affiliated with Ubisoft |

## 5. Working rules (how I keep this cheap and correct)
- One commit + push per finished phase (or major feature), only after `npm run check` passes.
- Tests come from DoD lines, written alongside code. Pure logic (parser, engine, stats) gets unit
  tests. I/O gets thin wrappers.
- Before ticking a phase, do a self-review against its DoD and the risk register, and log the result below.
- Things only the user can verify (real login, live match, OCR) are listed under "User checks" and
  never claimed as verified.

## 6. Verification log
Kept in [docs/VERIFICATION-LOG.md](docs/VERIFICATION-LOG.md) (one row per phase or release; add new rows there).

## 7. User checks (things I can't verify myself)
- [ ] Enable Match Replay in Siege settings (if not already) so every match is recorded
- [ ] Settings → Sign in with Ubisoft (Xbox/PSN/Facebook/email), then Live → Simulate last match: lobby should show real ranks
- [ ] Play one match with the app open and report what the Live page showed (Phase 5/6)
- [ ] Optional: enable OCR in Settings and check it reads the map before round 1 (borderless window mode is most reliable)
- [ ] Turn on Settings → Global database (sharing) so your lobbies seed the global meta
