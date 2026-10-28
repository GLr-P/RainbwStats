# RainbwStats architecture

How the app is put together: data sources, processes, speed budget and the recommendation model. Copied out of the private plan on 2026-10-28; keep it current when a mechanism changes.

## Overview

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

