# RainbwStats: instructions for AI assistants (Copilot etc.)

Read these first; they are the source of truth:
- `CLAUDE.md`: layout, commands, gotchas, conventions (applies to any assistant)
- `PLAN.md`: phases and the open items; `docs/VERIFICATION-LOG.md` has one row per release
- `messages.md` (local only, gitignored): the running conversation with the owner. Newest first; "Needs you" lists what's waiting on them. Add an entry there after each release.

## How work is done here
- Electron + React + TypeScript; `node:sqlite` (no native modules). Main process in `src/main`, shared pure logic in `src/shared`, UI in `src/renderer`.
- Before every commit: `npm run check` (typecheck + vitest) must pass. Visual check: `npm run shots`, then look at `site/img/*.png` (demo data only).
- Release: bump `version` in package.json → `npm run dist` → smoke the build (`env -u ELECTRON_RUN_AS_NODE ./release/win-unpacked/RainbwStats.exe --smoke --demo=test/fixtures/rounds-sample.json` prints `SMOKE OK`) → `git tag vX.Y.Z && git push origin vX.Y.Z` → `gh release create` with the Setup exe, its .blockmap, latest.yml and the Portable exe. Installed apps auto-update from GitHub Releases.
- Commit identity: GLr-P <241555371+GLr-P@users.noreply.github.com>.

## Hard rules
- Never read or modify game memory or inject into Siege (BattlEye). Only replay files, Ubisoft web APIs, and optional screen OCR.
- Never commit replays, credentials, the `feedback/` folder, or other players' names.
- Don't run repeated end-to-end tests on copies of the owner's real profile: each creates a Ubisoft session and can rate-limit or log out the account.
- The Cloudflare Worker (`worker/`) is production: test SQL with `npx wrangler dev --local`, then deploy (pre-approved; no need to ask).

## Open items (2026-10-20)
- Verify past-season ranks (Me tab) against the owner's real ranks; then extend to lobby players and the Players page (`UbiClient.seasonRanks`, `season_ranks` table).
- v0.6.3 fixed: reworked maps showing as "Unknown map" (learned from site room names: `mapForSite`, `learnMap`) and side voting when operator ids are unknown (header display-name fallback). Confirm with the owner's next matches.
- Ban-phase OCR needs real frames (Settings → OCR debug keeps the last 40).
- Phase 10 (Overwolf live data for round 1): code ready on branch `overwolf-runtime` (ow-electron runtime + `src/main/gep`). Waiting for the owner's Overwolf dev account: DevRel must enable R6 GEP for "RainbwStats" by "GLr-P", and OW_CLI_EMAIL / OW_CLI_API_KEY / OW_BUILD_KEY must be set as env vars (never commit them). Then merge, `npm install`, `node node_modules/electron/install.js`, `npm run dist`, release.
