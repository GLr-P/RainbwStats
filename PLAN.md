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
- [x] Past-season ranks: the official Career module (r6s_career.iife.js) reads `RankingRankSeasonal` via /v1/profiles/stats + calendarEntryId. Fetched once per past season for you (v0.6.2, Me tab). Not yet checked against a live response (value assumed = full_profiles rank id; values outside 1–40 hidden). Next: lobby players / Players page
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
| Date | Phase | Result |
|---|---|---|
| 2026-10-19 | 0 | check ✅ (tsc + 1 test), smoke ✅ `SMOKE OK`, pushed to GLr-P/RainbwStats |
| 2026-10-19 | 1 | check ✅ 13 tests. Local Y11S3 replay: 6/6 rounds parsed in 33–79 ms (header-only ~ same; zstd dominates). Found new Plane world ID 439976373310. Rauora confirmed attacker. Winner from score delta, one winner per round ✅. Ingest idempotent ✅. Game dir auto-detected (Steam) ✅ |
| 2026-10-19 | 2 | check ✅ 22 tests: login, 2FA, remember-me refresh (no password resend), 401 retry, 429 typed error, junk-shape tolerance, lobby batching + cache + rank snapshots, logged-out degradation. Real login untested (user check) |
| 2026-10-19 | 3 | check ✅ 30 tests. Tests caught 2 real flaws: tiny samples beating reliable ones (→ lower-confidence-bound ranking) and saturating pick-rate term (→ log-scaled, capped). Cold start, roster/bans, site lift, crowd>baseline, team fit, determinism covered |
| 2026-10-19 | 5 | check ✅ 35 tests. Simulated replay drops (real Y11S3 files copied into a watched dir): file → LiveState in **181–262 ms** (budget 300). Side prediction + match-end (incl. OT) tested |
| 2026-10-19 | 6 | Windows OCR worker verified on this PC: boot 0.4 s, **24 ms/frame**, read CLUBHOUSE/DEFENSE/site correctly from a rendered frame. Matcher tests incl. OCR noise + no false positives. Real in-game frames untested (user check) |
| 2026-10-19 | 4 | Screenshot review of every page found + fixed: misleading side tags, stale header side after match end, inflated pick rate in 3v3 (now exact team-rounds), baseline shown as win %, op chips overflowing, all-ops score penalty (now neutral 50 for no data) |
| 2026-10-20 | 10.1 | **Researched meta for Y11S3.2** (docs/META-RESEARCH.md, rerunnable): siegestrats crawler (338 per-site lineups), Liquipedia pro bans (294 games), official ranked bans + win deltas read from Designer's Notes charts, manual overrides (Tubarão CCTV). Generated meta.json drives site tiers (evidence-weighted), map strong lists (pro must-bans), ranked deltas in the meta term; shipped in the downloadable dataset. Ranked pool only (15 maps) in pickers/simulator. Corrected outdated sites (Villa rework etc.). 67 tests. Real-profile E2E hit a Ubisoft session rate limit after repeated test runs (not a bug) |
| 2026-10-20 | 10.2 | **Maps tab** (v0.3.2): researched meta per ranked map and side outside a live game: site S/A tiers with ranked win deltas, your top picks per site, strong-on-map list, pro bans, ranked meta table (win delta, ban rate, pro ban, your record). **Every operator table is sortable by any column, defaulting to win-rate delta** (Ops: Ubisoft + replays; Meta: players met + replays; Maps). Personal/crowd delta is shrunk toward the side average (~20 rounds) so tiny samples don't top the list. Demo screenshots include Maps (7-maps.png). 67 tests |
| 2026-10-20 | 8 | **Global crowd DB** (v0.4.0): Worker deployed (rainbwstats-crowd.nanotechservices.workers.dev, D1 rainbwstats). Verified locally with wrangler dev: ingest validation, newer-wins upsert, round dedupe, custom games excluded, cron aggregation, rate limit (429 after 4/min burst). Production: health, empty meta, empty ingest, bad request OK. App: opt-in sharing, Meta → Global, recs prefer larger global samples. 72 tests |
| 2026-10-20 | 10.3 | **Ban suggestions** (v0.4.1): per map, one list per side, scored from pro ban rate on the map, official ranked ban rate, ranked win delta (weighted lower: it helps whoever picks it), map-strong list, global RainbwStats delta (when 30+ players), minus ops you play. Shown on Live before round 1 (OCR / preview / simulation) and on the Maps tab. Audit over the 15 ranked maps: Mira/Kaid/Bandit/Wamai/Azami and Solid Snake/Ace/Thermite/Montagne, i.e. the real ranked ban pool. 75 tests |
| 2026-10-20 | 10.4 | v0.4.2: one-time opt-in card on Live ("Help build the global meta?" Share / No thanks); sharing stays off unless chosen. 75 tests |
| 2026-10-20 | 11 | **Me tab** (v0.5.0): rank card + season RP chart, current/last session (3 h gap rule: games, W-L, RP, rounds won, K/D, ops), last-10 form, match history merging replays with ranked games inferred from W/L changes between rank snapshots (RP per game, works without replays; several games between checks → one summary row), attack vs defense split, your ops and maps sorted by win delta. App checks your rank every 10 min while Siege runs. Demo profile seeds a season of rank history for screenshots. 78 tests |
| 2026-10-20 | 12 | v0.6.0: **data export/import** between PCs (replays, players, rank history, Ubisoft stats; import adds missing rows, newer Ubisoft fetch wins, idempotent), **CSV** match history, **OCR debug** toggle (last 40 frames + read text, Open folder), **overlay window** (frameless, always-on-top screen-saver level, drag/resize/opacity, remembers position, tray toggle; picks, bans before R1, enemy ranks/mains). Settings now broadcast to all windows. 80 tests |
| 2026-10-20 | 13 | v0.6.1: **rank-banded meta** for players you met (band = their latest ranked rank; Meta → Players I've met → rank select; recommendations use your band once 30+ met players are in it). **Patch changes** (Meta → Patch changes): the app keeps the previous patch's researched meta (meta-seen/meta-prev.json) and lists ops whose official ranked win delta / ban rate moved, sortable. 83 tests |
| 2026-10-20 | 15 | v0.6.3 (user test on main PC): reworked maps (Villa, Outback…) showed "Unknown map": new world ids are now learned from the site room names (mapForSite → learnedMaps, stored rounds repaired at startup, renderer catalog includes learned maps). Team-side vote falls back to the header's operator display name when ids are unknown. .github/copilot-instructions.md hand-off for other assistants. 85 tests |
| 2026-10-20 | 16 | v0.6.4: OCR debug frames skip Siege's main menu (the owner's 40 frames were all post-match menu, pushing out ban/loading frames). 86 tests |
| 2026-10-20 | 17 | v0.6.5: Live "By site" always shown (was hidden once the site was known, i.e. on defense); current site highlighted. Checked: .rec files are created and finished at round end (created == modified, folder created with R01), so round 1 can only come from OCR / presence / manual preview. 86 tests |
| 2026-10-20 | 18 | v0.6.6: next-round side learned from recorded matches (per round number, how often sides swapped; ≥3 matches, custom games ignored when real ones exist) instead of assuming the half-time rule; Siege X bans every round → Live/overlay show ban suggestions every round for the enemy side; operator-name side vote folds accents (NØKK). Researched R6 Tracker's live data: Overwolf GEP (map at match start, phase, round, score, roster with operators; no bans/side key), available to Electron apps via @overwolf/ow-electron, enabled per game by Overwolf DevRel → Phase 10 (needs owner's Overwolf dev account). 87 tests |
| 2026-10-20 | 19 | v0.6.7 (round 1 still empty on the owner's PC): root cause found in the engine: a match that never looked finished (leaver/surrender/format ≠ 6-round rule) kept phase "match", and in that phase a newly read map was discarded as a misread → round 1 of every following match stayed empty. Now a match ends when OCR sees the main menu, or when a different map is read >90 s after the last round. Map-only reads (loading screen, side not yet known) now show the map, attack picks + defense alternatives and bans instead of nothing. Ruled out: replay files (written at round end), Ubisoft Connect logs (no presence), Ubisoft presence API (undocumented). 92 tests |
| 2026-10-20 | 10 | User: picks felt wrong (one attacker everywhere; Kaid/Bandit/hard breachers always top; Tubarão should be CCTV). Rebuilt recommender as **estimated round win chance** with signed reasons. Richer S/A site tiers (Tubarão S on Clubhouse CCTV), site-kind fit tier, site-unknown averaging, team-need model for hard breach/anti-breach from teammates (new slider), stronger shrinkage (1 lucky round +0.9% not +3%), outside-roster suggestion. Real-data check (user roster has no hard breachers): attack now uses 8/10 roster ops across sites, defense 9; tests for every reported case. 62 tests |
| 2026-10-19 | 9.4 | User report: same 3 picks on every map/site. Cause: no map/site-specific signal (Ubisoft stats have no map breakdown: probed, 0 per-map stat names; 1 replay). Fix: curated site specialists for 17 maps (sitePicks.ts, remote-overridable) as a new weight "site" (0.25; untouched old defaults migrated), role-diversity re-ranking (−10 per repeated primary role), empty roster = operators you've played 10+ rounds. Verified on real data: defense picks now vary per map/site (e.g. basements Frost/Echo/Smoke, CCTV Mute/Maestro); attack keeps Thermite/Ace (user: 70%/64% vs 37–48% on mains) with a site-varying 3rd pick. 62 tests |
| 2026-10-19 | 9.3 | **Audit with the user's real data** (copied profile, real login, Siege running). Found + fixed: (1) OCR never worked on real captures: 24-bit PNG + console code page → JSON parse failure → 0 lines (now UTF-8 I/O, control-char strip, BGRA8); (2) OCR false positive "Border" from code on screen → OCR now only while Siege is the **foreground** process (user32 via the worker), map/side must be short standalone labels, both-sides frames ignored, 2-frame confirmation, mid-match OCR can only change side/site; (3) side is now re-read every round between rounds (prediction is a fallback) + "If you're on ATK/DEF" row; (4) Stop did nothing after a simulation finished / new sim silently ignored → cancellation tokens; (5) friends showed blank names (nickname alias) → real usernames; (6) "Unranked 0". Recommender audit: 558 static recs + 105 simulated live states with real players/mains → 0 side mismatches. 58 tests |
| 2026-10-19 | 9.2 | Simulator per user feedback: no typing, auto-picks random players (friends first on your team, then met players) preferring ranked-this-season with games played (one batched rank lookup), optional random map. E2E via real IPC ✅ (random map → Bank, 5/5 ranked picked) |
| 2026-10-19 | 9.1 | Match simulator: any map, start side, both teams from Ubisoft friends (GET /v3/profiles/{me}/friends, live-verified: 28 friends) / players met / any name; picks drawn from each player's real mains; in-memory only. E2E through real IPC in screenshot mode ✅ (unknown name reported). Seed site names for 17 maps (replaced by replay-learned names). Review fixes: shuffle duplicates, input focus loss, lobby overflow, 1-round samples over-weighted (prior k doubled). 53 tests |
| 2026-10-19 | 9 | Live-verified with user session (read-only): your stats 200 OK (191 values, 90 operator rows since 2024-08), batched 3 profiles 200 OK, seasonal Y11S3 200 OK; real hex ids map to Ash/Finka/Kapkan/Kali. 50 tests (parser, sync scheduling = 2 req/lobby, API-only recommendations). Debugged a screenshot-only render-timing artifact (engine state was correct) |
| 2026-10-19 | 7.2 | User report: password login → 403. Probed live: Ubisoft edge bot-protection now blocks Basic-auth logins for app id 4391c956 (HTML 403); Ubisoft Connect PC id f68a4bb5 passes; ticket exchange/rm_v1/2FA/GETs unaffected. Fix: login via Connect PC id → exchange to ours, fallback order, clear "blocked" error. Real client vs live Ubisoft with a fake account → "Invalid credentials" (401) ✅. 47 tests |
| 2026-10-19 | 7.1 | v0.1.1: Simulate last match (tested: phases loading→match→ended). v0.1.2: sign in via Ubisoft's official page (no password stored; Steam not offered by Ubisoft), session exchange + remember-me refresh + silent re-login + exchange-refused fallback (45 tests); real Electron self-test of both capture paths ✅ (`npm run selftest`); found + fixed ERR_FAILED when a login window opens right after another closes. Visible auto-update: 30-min checks, Settings panel, restart banner hidden during matches |
| 2026-10-19 | 7 | NSIS + portable built locally; packaged exe passes smoke (node:sqlite, updater, tray in asar). Self-review found + fixed: first-run import blocking UI (now async), watcher never starting if MatchReplay created later. Pages enabled. CI/Release workflows written; GitHub Actions degraded today so runs queued |

## 7. User checks (things I can't verify myself)
- [ ] Enable Match Replay in Siege settings (if not already) so every match is recorded
- [ ] Settings → Sign in with Ubisoft (Xbox/PSN/Facebook/email), then Live → Simulate last match: lobby should show real ranks
- [ ] Play one match with the app open and report what the Live page showed (Phase 5/6)
- [ ] Optional: enable OCR in Settings and check it reads the map before round 1 (borderless window mode is most reliable)
- [ ] Turn on Settings → Global database (sharing) so your lobbies seed the global meta
