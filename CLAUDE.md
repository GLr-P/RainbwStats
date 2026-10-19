# RainbwStats: notes for Claude

Read PLAN.md first. It holds phases, DoD checklists, the risk register and the verification log. Tick
boxes and add a log row when a phase finishes.

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
- The Bash tool collapses backslashes and breaks on backticks in heredocs / node -e. Use Write/Edit for code containing either
- Release: bump version in package.json → tag vX.Y.Z → push tag (release.yml builds + publishes). Fallback: `npm run dist` + `gh release create` with release/*.exe, *.blockmap, latest.yml
- Visual check: `npm run shots` then look at site/img/*.png (demo data, safe to publish)

## Conventions
- SQLite via built-in `node:sqlite` (no native modules). Never add native deps without a strong reason
- Unknown operator/map IDs from replays must never throw. Map them to `Unknown(<id>)`
- Season-varying data (op IDs, maps, sites, meta) goes in `src/shared/data/` and is overridable by the remote dataset
- Never commit replays, credentials, or other players' names
- Game install on the dev machine: `C:\Program Files (x86)\Steam\steamapps\common\Tom Clancy's Rainbow Six Siege` (MatchReplay has a Y11S3 sample)
- Commit identity: GLr-P <241555371+GLr-P@users.noreply.github.com>
