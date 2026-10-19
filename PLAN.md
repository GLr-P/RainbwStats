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

### Recommendation model (pure function, unit-tested)
```
score(op) = wP·personal + wM·meta + wC·comfort + wT·teamfit  (−∞ if banned / not in roster)
personal = Bayesian-shrunk win-rate & K/D delta on this map+site+side (falls back map → global)
meta     = pick/win-rate delta on this map+site+side from dataset (crowd > local-all-players > seed)
comfort  = recency-weighted play share
teamfit  = covers missing roles given teammates' known picks (hard breach, intel, anti-gadget…)
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
- [ ] Login (email/password, safeStorage-encrypted), 2FA code flow, ticket cache + background refresh
- [ ] Profiles by name / by IDs (batched), full_profiles (rank/RP/max/W-L/K-D) batched, level/playtime
- [ ] Response guards (never crash on shape change), 429 backoff, 10-min per-player cache
- [ ] Rank snapshot on every fetch → history
- [ ] Probe past-season rank endpoints (document results here)
- DoD: unit tests on recorded fixtures; manual test with a real login (user step).

### Phase 3 — Recommendation engine + roster + seed meta
- [ ] Operator metadata (side, roles, speed) for the full Y11S3 roster
- [ ] Seed meta dataset v1 (baseline tiers, flagged "baseline" in UI) + map/site list
- [ ] Engine with explainable reasons + configurable weights
- DoD: unit tests cover cold start (no data), roster filtering, bans, site-specific vs map fallback, determinism.

### Phase 4 — UI
- [ ] R6-styled theme (dark, angular cuts, condensed caps type, attack orange / defense blue), CSS-variable tokens
- [ ] **Live page** (single glanceable screen): map/side/site header · your top-3 picks with reasons · both teams (rank, RP, K/D, W/L, level, ops this match) · round timeline
- [ ] Roster sidebar (toggle the ops you're willing to play, quick presets)
- [ ] Operators page (your stats by op × map × site × side, per patch)
- [ ] Players page (lookup, rank history, encounters)
- [ ] Meta page (pick/win by map/site/side, per patch, sample sizes)
- [ ] Settings: theme colors, density, font scale, panels on/off, weights, paths, always-on-top, compact mode
- DoD: every page renders with empty DB and with fixture data; readable at 1080p from arm's length (min 14px body).

### Phase 5 — Live engine (zero interaction)
- [ ] Detect Siege process; watch MatchReplay; state machine; auto-switch to Live page
- [ ] On new round file: header parse → lobby fetch → recompute recs → push to UI
- [ ] Tray icon, launch-at-login option, single instance
- DoD: simulated replay drop (copy fixture rounds in with delays) drives the full UI flow within budget.

### Phase 6 — Round-1 OCR (opt-in)
- [ ] Persistent Windows OCR worker, desktopCapturer frames, fuzzy vocab (maps, ATTACK/DEFENSE, sites)
- [ ] Debug capture mode (saves frames so the user can send failing screenshots)
- DoD: matcher unit tests; manual validation in a real match (user step).

### Phase 7 — Ship
- [ ] electron-builder NSIS + portable, release workflow on tag, electron-updater from GitHub Releases
- [ ] GitHub Pages: landing page + hosted meta dataset; app pulls dataset with disk cache
- DoD: tagged release downloads + installs + auto-detects replay folder on a clean profile.

### Phase 8 — Global crowd database (the "pick/ban/WR for everyone" feature)
- [ ] Opt-in anonymous upload of round records (no names; salted-hash profile IDs)
- [ ] Cloudflare Worker + D1 (free tier) ingest + nightly aggregation → cached JSON per season/patch
- [ ] App blends crowd → local → seed, with sample sizes shown
- Needs: a Cloudflare account (`npx wrangler login`, one-time user step).

### Backlog / expansion
Opt-in tracker.gg enrichment · in-game overlay window · ban-phase OCR · teammate-aware recs ·
weapon/attachment stats from replays · export CSV · per-patch diff view ("what changed in Y11S3.1").

## 4. Risk register
| Risk | Mitigation |
|---|---|
| New season adds unknown operator/map IDs | Unknown IDs → `Unknown(id)`, never throw; ID tables in remote dataset; role inferred from team side |
| Replay format change | Parser isolated + fixture tests; header-only fallback; error surfaced in UI, app keeps working |
| User has Match Replay disabled | Onboarding check: folder exists + recent files; show exact steps to enable |
| Ubisoft API change / block / rate limit | Isolated client, shape guards, batching, caching, backoff; app degrades to replay-only |
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

## 7. User checks (things I can't verify myself)
- [ ] Enable Match Replay in Siege settings (if not already) so every match is recorded
- [ ] Log in with a Ubisoft account in Settings (Phase 2)
- [ ] Play one match with the app open and report what the Live page showed (Phase 5/6)
