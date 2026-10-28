# RainbwStats: notes for Claude

This folder is the code repo (public). The private project files sit one level up in the hub: `../ABOUTME.md` (status,
decisions), `../Information/PLAN.md`, `../Handoff/` (handoff log, `messages.md` = the async channel with the owner),
`../Research/`, `../Thoughts/`.

Before starting, read PLAN.md §3 "Next" and §7 "User checks", plus the "Needs you" section at the top of `../Handoff/messages.md`.
Read PLAN.md's other sections (research, phase checklists, risks) only when the task touches them. Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
When a phase or release finishes, tick its boxes and add a row to [docs/VERIFICATION-LOG.md](docs/VERIFICATION-LOG.md).

## Layout
- `src/main/`: Electron main process (all I/O): `db.ts`, `replay/` (rec parser + watcher), `ubi/` (Ubisoft API), `live/`, `ocr/`, `meta/`
- `src/shared/`: pure TS shared by main and renderer: types, seed data (`data/`), recommendation engine, stats math
- `src/preload/`: typed IPC bridge (`window.rs`). Built as CJS (`index.cjs`) because the renderer is sandboxed
- `src/renderer/`: React UI, themed via CSS variables in `styles/theme.css`
- `test/`: vitest. Raw `.rec` replays are gitignored (`test/fixtures/local/`); tests that need them skip when absent

## Commands
- `npm run check`: typecheck (TS 7 / tsgo) + vitest. Must pass before every commit
- `npm run smoke`: build + launch Electron + assert the UI mounted (prints `SMOKE OK`)
- `npm run dev`: dev app. Scripts go through `scripts/run.mjs` because VS Code sets `ELECTRON_RUN_AS_NODE=1`

## Gotchas
- Meta/site data: follow docs/META-RESEARCH.md (research scripts in scripts/research, output src/shared/data/meta.json + dataset)
- Don't repeatedly run E2E on copies of the user's real profile: each run creates a Ubisoft session → account rate limit
- The Bash tool collapses backslashes and breaks on backticks in heredocs / node -e. Use Write/Edit for code containing either
- Release: bump version in package.json → tag vX.Y.Z → push tag (release.yml pre-creates the release, then builds + uploads). Afterwards confirm `gh api repos/GLr-P/RainbwStats/releases/latest -q .tag_name` is the new tag: v0.6.19–0.6.22 silently stayed split drafts, so auto-update saw nothing. Fallback: `npm run dist` + `gh release create` with release/*.exe, *.blockmap, latest.yml
- Global crowd DB: `worker/` (Cloudflare Worker + D1 `rainbwstats`, https://rainbwstats-crowd.nanotechservices.workers.dev). Contract in `src/shared/crowd.ts`. Deploy: `cd worker && npx wrangler deploy` (schema changes: `npx wrangler d1 execute rainbwstats --remote --file=schema.sql`). Test SQL locally with `npx wrangler dev --local --test-scheduled`, never by posting fake data to production
- Visual check: `npm run shots` then look at site/img/*.png (demo data, safe to publish)

## Conventions
- SQLite via built-in `node:sqlite` (no native modules). Never add native deps without a strong reason
- Unknown operator/map IDs from replays must never throw. Map them to `Unknown(<id>)`
- Season-varying data (op IDs, maps, sites, meta) goes in `src/shared/data/` and is overridable by the remote dataset
- Never commit replays, credentials, or other players' names
- Game install on the dev machine: `C:\Program Files (x86)\Steam\steamapps\common\Tom Clancy's Rainbow Six Siege` (MatchReplay has a Y11S3 sample)
- Commit identity: GLr-P <241555371+GLr-P@users.noreply.github.com>
