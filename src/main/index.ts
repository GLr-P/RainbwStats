import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { RoundRecord } from '../shared/types'
import { demoLobby } from './demo'
import { Updater } from './updater'
import { ubisoftWebLogin } from './ubi/weblogin'
import { OpStatsSync } from './ubi/opsync'
import { join } from 'node:path'
import { openDb } from './db'
import { SettingsStore } from './settings'
import { SecureStore } from './secure'
import { DatasetStore } from './dataset'
import { UbiClient, UbiError } from './ubi/client'
import { LobbyService } from './ubi/lobby'
import { LiveEngine } from './live/engine'
import { buildLive } from './live/state'
import { apiOps, currentSeason, mainsOf, metaRows, opStats, sitesFor, type Ctx } from './services'
import { buildSyntheticMatch, type SimPlayer } from './live/simulate'
import { SEED_SITES } from '../shared/data/maps'
import { rankedPool } from '../shared/data/sitePicks'
import { baselineFor } from '../shared/recommend'
import { applyLearned } from './replay/ingest'
import { findGameDirs, replayRootOf } from './replay/locate'
import { OcrDetector } from './ocr/detector'
import type { CatalogOverrides } from '../shared/catalog'
import { API_METHODS, type AppStatus, type AuthResult, type RsApi, type Settings } from '../shared/ipc'

const isSmoke = process.argv.includes('--smoke')
// Smoke/screenshot runs get their own profile so they never collide with an installed copy.
// --data-dir=<copy of a profile> (test runs against real data). Smoke runs never use the live profile.
const dataDirArg = process.argv.find((a) => a.startsWith('--data-dir='))?.slice(11)
if (dataDirArg) app.setPath('userData', dataDirArg)
else if (isSmoke) app.setPath('userData', join(app.getPath('temp'), `rainbwstats-smoke-profile-${process.pid}`))
else if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow(s: Settings): BrowserWindow {
  const w = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600, backgroundColor: s.theme.bg, show: false,
    autoHideMenuBar: true, title: 'RainbwStats', alwaysOnTop: s.alwaysOnTop,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  w.once('ready-to-show', () => !isSmoke && w.show())
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void w.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return w
}

app.on('second-instance', () => { win?.show(); win?.focus() })

app.whenReady().then(async () => {
  if (process.argv.includes('--selftest-weblogin')) {
    const { selftestWebLogin } = await import('./selftest')
    app.exit((await selftestWebLogin()) ? 0 : 1)
    return
  }
  // --demo=<rounds.json>: isolated profile seeded with scrubbed sample rounds (for public screenshots).
  const demo = process.argv.find((a) => a.startsWith('--demo='))?.slice(7)
  const dataDir = dataDirArg ?? (demo ? join(app.getPath('temp'), `rainbwstats-demo-${Date.now()}`) : isSmoke ? join(app.getPath('temp'), 'rainbwstats-smoke') : app.getPath('userData'))
  mkdirSync(dataDir, { recursive: true })
  const db = openDb(join(dataDir, 'rainbwstats.db'))
  applyLearned(db)
  const settings = new SettingsStore(db)
  if (demo) for (const r of JSON.parse(readFileSync(demo, 'utf8')) as RoundRecord[]) db.saveRound(r)
  else if (!settings.get().gameDir) settings.set({ gameDir: findGameDirs()[0] ?? null })
  const secure = new SecureStore(dataDir)
  const dataset = new DatasetStore(dataDir)
  const ubi = new UbiClient({ fetch, now: Date.now, loadCredentials: secure.loadCredentials, loadAuth: secure.loadAuth, saveAuth: secure.saveAuth,
    reauth: () => ubisoftWebLogin({ silent: true }) })
  const ctx: Ctx = { db, settings: () => settings.get(), dataset: () => dataset.get(), me: () => ubi.profileId ?? db.mostCommonRecorder() }
  const lobby = demo ? demoLobby() : new LobbyService(ubi, db)
  const replayRoot = () => (settings.get().gameDir ? replayRootOf(settings.get().gameDir!) : null)
  const engine = new LiveEngine(ctx, lobby, replayRoot)
  const opsync = new OpStatsSync(ubi, db, () => currentSeason(ctx))
  engine.onLobby = (ids) => opsync.syncPlayers(ids)
  /** Your Ubisoft operator history (all seasons; past seasons fetched once). */
  const syncMine = () => { const me = ctx.me(); if (me && ubi.canAuth) void opsync.syncMine(me).then((ok) => ok && engine.refresh()) }
  const ocr = new OcrDetector((d, fresh) => engine.setDetected(d, fresh))
  ocr.shouldRun = () => engine.needsRoundInfo
  ocr.sitesByMap = (k) => db.sites(k).map((s) => s.site)

  win = createWindow(settings.get())
  engine.on('state', (s) => win?.webContents.send('rs:live', s))
  engine.start()
  if (settings.get().ocrEnabled) ocr.start()
  if (ubi.canAuth) void ubi.warm().catch(() => undefined) // first live lookup shouldn't pay for login
  if (!isSmoke) { syncMine(); setInterval(syncMine, 3600_000) }
  void dataset.refresh(settings.get().datasetUrl).then((changed) => changed && engine.refresh())
  // Installer builds update themselves from GitHub Releases (downloaded in background, applied on quit).
  const updates = new Updater((s) => win?.webContents.send('rs:update', s))
  if (!isSmoke) updates.start()

  const status = (): AppStatus => {
    const root = replayRoot()
    const me = ctx.me()
    return {
      replayRoot: root, replayRootExists: !!root && existsSync(root), watching: engine.watching, ...db.counts(),
      lastIngest: engine.lastIngest, loggedIn: ubi.loggedIn, loginMethod: ubi.method ?? null, myProfileId: me, myName: me ? db.playerName(me) : null,
      datasetVersion: dataset.get().version, version: app.getVersion()
    }
  }
  const authErr = (e: unknown): AuthResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) })

  const api: Omit<RsApi, 'onLive' | 'onUpdate'> = {
    status: async () => status(),
    getSettings: async () => settings.get(),
    setSettings: async (patch) => {
      const prev = settings.get()
      const next = settings.set(patch)
      if (next.gameDir !== prev.gameDir) { engine.restartWatcher(); void engine.rescan() }
      if (next.alwaysOnTop !== prev.alwaysOnTop) win?.setAlwaysOnTop(next.alwaysOnTop)
      if (next.launchAtLogin !== prev.launchAtLogin) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
      if (next.ocrEnabled !== prev.ocrEnabled) next.ocrEnabled ? ocr.start() : ocr.stop()
      engine.refresh()
      return next
    },
    getLive: async () => engine.state,
    preview: async (mapKey, side, site) =>
      buildLive(ctx, [], { gameRunning: false, roundsPerMatch: 6, overtimeRounds: 3, phase: 'idle', override: { mapKey, side, site } }),
    login: async (email, password) => {
      try {
        const r = await ubi.login({ email, password })
        secure.saveCredentials({ email, password })
        if (r === 'twoFactor') return { ok: false, twoFactor: true }
        void ubi.warm().catch(() => undefined)
        syncMine()
        return { ok: true }
      } catch (e) { return authErr(e) }
    },
    submitTwoFactor: async (code) => {
      try { await ubi.submitTwoFactor(code); void ubi.warm().catch(() => undefined); syncMine(); return { ok: true } } catch (e) { return authErr(e) }
    },
    logout: async () => { ubi.logout(); secure.clear(); await session.fromPartition('persist:ubisoft-login').clearStorageData() },
    loginWithUbisoft: async () => {
      try {
        const web = await ubisoftWebLogin({ parent: win ?? undefined })
        if (!web) return { ok: false, error: 'Sign-in window closed' }
        await ubi.adoptWebSession(web)
        void ubi.warm().catch(() => undefined)
        syncMine()
        return { ok: true }
      } catch (e) { return authErr(e) }
    },
    apiOps: async (f) => apiOps(ctx, f, opsync.lastError),
    simPeople: async () => {
      let error: string | null = null
      let friends: { profileId: string; name: string }[] = []
      if (ubi.canAuth) { try { friends = await ubi.friends() } catch (e) { error = e instanceof Error ? e.message : String(e) } } else error = 'Sign in to load your Ubisoft friends'
      const me = ctx.me() ?? ''
      const people = [
        ...friends.map((f) => ({ ...f, source: 'friend' as const })),
        ...db.recentPlayers(40, me).filter((p) => !friends.some((f) => f.profileId === p.profileId)).map((p) => ({ ...p, source: 'recent' as const }))
      ]
      return { people, error }
    },
    simulateMatch: async (req) => {
      const me = ctx.me()
      if (!me) return { ok: false, error: 'Sign in (or record one replay) so the app knows which player is you' }
      // Resolve names → profile ids: friends / met players first, then a Ubisoft name lookup.
      const known = new Map<string, { profileId: string; name: string }>()
      if (ubi.canAuth) { try { for (const f of await ubi.friends()) known.set(f.name.toLowerCase(), f) } catch { /* lookup fallback */ } }
      for (const p of db.recentPlayers(500)) if (!known.has(p.name.toLowerCase())) known.set(p.name.toLowerCase(), p)
      const unresolved: string[] = []
      const resolve = async (q: string) => {
        const s = q.trim()
        if (!s) return null
        if (/^[0-9a-f-]{36}$/i.test(s)) return { profileId: s, name: db.playerName(s) ?? s }
        const hit = known.get(s.toLowerCase())
        if (hit) return hit
        try { const p = ubi.canAuth ? await ubi.profileByName(s) : null; if (p) return { profileId: p.profileId, name: p.name } } catch { /* unresolved */ }
        unresolved.push(s)
        return null
      }
      const team = async (qs: string[]) => (await Promise.all(qs.map(resolve))).filter((p): p is { profileId: string; name: string } => !!p)
      let [mine, enemy] = await Promise.all([team(req.myTeam), team(req.enemyTeam)])
      let activeCount: number | undefined
      let activeIds = new Set<string>()
      const cards0 = (id: string) => activeIds.has(id)
      if (req.mapKey === 'random') { const keys = rankedPool().length ? rankedPool() : Object.keys(SEED_SITES); req = { ...req, mapKey: keys[Math.floor(Math.random() * keys.length)]! } }
      if (!req.myTeam.some((s) => s.trim()) && !req.enemyTeam.some((s) => s.trim())) {
        // Auto: random players from friends + people you've met, preferring ones ranked this season
        // with games played. Ranks come from one batched lookup (cached), friends go on your team first.
        let friends: { profileId: string; name: string }[] = []
        if (ubi.canAuth) { try { friends = await ubi.friends() } catch { /* met players only */ } }
        const pool = new Map<string, { profileId: string; name: string; friend: boolean }>()
        for (const f of friends) if (f.profileId !== me) pool.set(f.profileId, { ...f, friend: true })
        for (const p of db.recentPlayers(60, me)) if (!pool.has(p.profileId)) pool.set(p.profileId, { ...p, friend: false })
        const people = [...pool.values()].slice(0, 80)
        const { cards } = await lobby.cards(people.map((p) => p.profileId), Object.fromEntries(people.map((p) => [p.profileId, p.name])))
        const active = new Set(cards.filter((c) => (c.ranked?.rank ?? 0) > 0 && (c.season?.wins ?? 0) + (c.season?.losses ?? 0) > 0).map((c) => c.profileId))
        activeCount = active.size
        activeIds = active
        const shuffled = <T,>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x)
        const ordered = [...shuffled(people.filter((p) => active.has(p.profileId))), ...shuffled(people.filter((p) => !active.has(p.profileId)))]
        mine = [...ordered.filter((p) => p.friend), ...ordered.filter((p) => !p.friend)].slice(0, 4)
        enemy = ordered.filter((p) => !mine.includes(p)).slice(0, 5)
      }
      if (!enemy.length) return { ok: false, error: 'No players to simulate with yet: sign in (friends) or play a match first', unresolved }
      // Their real mains (Ubisoft stats) drive the simulated picks.
      await opsync.syncPlayers([me, ...mine.map((p) => p.profileId), ...enemy.map((p) => p.profileId)])
      const asSim = (p: { profileId: string; name: string }): SimPlayer => ({ ...p, mains: mainsOf(ctx, p.profileId, 8) })
      const rounds = buildSyntheticMatch({
        mapKey: req.mapKey, mySide: req.side, me: asSim({ profileId: me, name: db.playerName(me) ?? 'You' }),
        myTeam: mine.filter((p) => p.profileId !== me).slice(0, 4).map(asSim), enemyTeam: enemy.slice(0, 5).map(asSim),
        sites: sitesFor(ctx, req.mapKey).map((s) => s.site), baseline: baselineFor(dataset.get(), req.mapKey)
      })
      void engine.playRounds(rounds, 4000)
      return { ok: true, unresolved, ranked: activeCount === undefined ? undefined : [...mine, ...enemy].filter((p) => cards0(p.profileId)).length }
    },
    stopSimulation: async () => engine.stopSimulation(),
    updateStatus: async () => updates.status,
    checkForUpdates: () => updates.check(),
    installUpdate: async () => updates.install(),
    opStats: async (f) => opStats(ctx, f),
    meta: async (f) => metaRows(ctx, f),
    sites: async (mapKey) => sitesFor(ctx, mapKey),
    seasons: async () => db.seasons(),
    lookupPlayer: async (name) => {
      let id = db.findPlayerByName(name)
      let error: string | undefined
      if (!id && ubi.canAuth) {
        try { id = (await ubi.profileByName(name))?.profileId ?? null } catch (e) { error = e instanceof UbiError ? e.message : String(e) }
      }
      if (!id) return { card: null, history: [], encounters: 0, error: error ?? 'Player not found' }
      const { cards, error: e2 } = await lobby.cards([id], { [id]: db.playerName(id) ?? name })
      const me = ctx.me()
      return { card: cards[0] ?? null, history: db.rankHistory(id), encounters: me && me !== id ? db.encounters(id, me) : 0, error: e2 }
    },
    simulate: () => engine.simulate(),
    rescan: async () => { await engine.rescan(); return status() },
    catalog: async () => ({ operators: [...(dataset.get().operators ?? []), ...(db.getJson<NonNullable<CatalogOverrides['operators']>>('learnedOperators') ?? [])], maps: dataset.get().maps }),
    pickGameDir: async () => {
      const r = await dialog.showOpenDialog(win!, { title: 'Select your Rainbow Six Siege folder', properties: ['openDirectory'] })
      const dir = r.canceled ? null : r.filePaths[0] ?? null
      if (dir) await api.setSettings({ gameDir: dir })
      return dir
    }
  }
  for (const m of API_METHODS) ipcMain.handle(`rs:${m}`, (_e, ...args: unknown[]) => (api[m] as (...a: unknown[]) => unknown)(...args))

  tray = new Tray(nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'tray.png')))
  tray.setToolTip('RainbwStats')
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show', click: () => win?.show() }, { label: 'Quit', click: () => app.quit() }]))
  tray.on('click', () => win?.show())

  if (isSmoke) {
    const fail = setTimeout(() => { console.error('SMOKE FAIL: timeout'); app.exit(1) }, 60000)
    const shots = process.argv.find((a) => a.startsWith('--shots='))?.slice(8)
    win.webContents.once('did-finish-load', async () => {
      const js = (code: string) => win!.webContents.executeJavaScript(code)
      const ok = await js('new Promise(r => setTimeout(() => r(!!document.querySelector("[data-app-ready]")), 2500))')
      if (ok && shots) {
        // Screenshot every page at 1440×900 for visual review.
        mkdirSync(shots, { recursive: true })
        win!.setSize(1440, 900)
        await new Promise((r) => setTimeout(r, 1500))
        writeFileSync(join(shots, '0-waiting.png'), (await win!.webContents.capturePage()).toPNG())
        await engine.showLatest()
        await new Promise((r) => setTimeout(r, 1500)) // let a busy machine finish rendering the pushed state
        for (const [i, label] of ['Live', 'Roster', 'Ops', 'Meta', 'Players', 'Settings'].entries()) {
          await js(`[...document.querySelectorAll('.nav button')].find(b => b.textContent.trim() === '${label}')?.click()`)
          await new Promise((r) => setTimeout(r, 700))
          writeFileSync(join(shots, `${i + 1}-${label.toLowerCase()}.png`), (await win!.webContents.capturePage()).toPNG())
        }
        // Full simulator path through the real IPC API: round 1 (as OCR would report it), then mid-match.
        await js(`[...document.querySelectorAll('.nav button')].find(b => b.textContent.trim() === 'Live')?.click()`)
        const started = await js(`window.rs.simulateMatch({ mapKey: 'random', side: 'defense', myTeam: [], enemyTeam: [] })`)
        console.log('SIM', JSON.stringify(started))
        await new Promise((r) => setTimeout(r, 1500))
        writeFileSync(join(shots, '0-round1.png'), (await win!.webContents.capturePage()).toPNG())
        await new Promise((r) => setTimeout(r, 10_000))
        writeFileSync(join(shots, '0-simulation.png'), (await win!.webContents.capturePage()).toPNG())
        const lobbyPlayers = [...engine.state.myTeam, ...engine.state.enemyTeam]
        console.log('SIMSTATE', engine.state.source, engine.state.phase, engine.state.rounds.length, engine.state.mapKey,
          `players=${lobbyPlayers.length} ranked=${lobbyPlayers.filter((x) => x.card?.ranked).length} withMains=${lobbyPlayers.filter((x) => x.mains.length).length}`,
          `side=${engine.state.side} picks=${engine.state.recommendations.map((r) => r.name).join('/')} other=${engine.state.otherSide?.recs.map((r) => r.name).join('/')}`, `lobbyError=${engine.state.lobbyError}`)
        await js('window.rs.stopSimulation()')
      }
      clearTimeout(fail)
      console.log(ok ? `SMOKE OK rounds=${db.counts().rounds}` : 'SMOKE FAIL: app root missing')
      app.exit(ok ? 0 : 1)
    })
  }
})

app.on('window-all-closed', () => app.quit())
