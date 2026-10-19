// Live match engine: watches MatchReplay, detects the game process, and pushes LiveState.
// Zero interaction: a new round file → parse (~60 ms) → state pushed → lobby ranks fetched → pushed again.
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import type { Ctx } from '../services'
import type { LobbyService } from '../ubi/lobby'
import { ingestFile, ingestReplayRoot, parseFile } from '../replay/ingest'
import type { LiveState, PlayerCard } from '../../shared/ipc'
import type { RoundRecord, Side } from '../../shared/types'
import { buildLive, emptyLive } from './state'

const GAME_EXE = /^"?RainbowSix(_Vulkan|_BE|_DX11)?\.exe/im
const STALE_MATCH_MS = 20 * 60_000

export function isGameRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000, maxBuffer: 4 << 20 }, (err, out) => resolve(!err && GAME_EXE.test(out)))
  })
}

export class LiveEngine extends EventEmitter<{ state: [LiveState]; ingested: [number] }> {
  private watcher: FSWatcher | null = null
  private poll: NodeJS.Timeout | null = null
  private gameRunning = false
  private matchId: string | null = null
  private format = { roundsPerMatch: 6, overtimeRounds: 3 }
  private cards = new Map<string, PlayerCard>()
  private lobbyError: string | null = null
  private override: { mapKey?: string; side?: Side; site?: string | null } | undefined
  private pending = new Map<string, NodeJS.Timeout>()
  private current: LiveState = emptyLive()
  lastIngest: string | null = null
  /** Called with lobby profile ids after ranks load (Ubisoft operator stats sync). */
  onLobby: ((ids: string[]) => Promise<unknown>) | null = null
  private readonly ctx: Ctx
  private readonly lobby: LobbyService
  private readonly root: () => string | null

  constructor(ctx: Ctx, lobby: LobbyService, root: () => string | null) {
    super()
    this.ctx = ctx
    this.lobby = lobby
    this.root = root
  }

  get state(): LiveState { return this.current }
  get watching(): boolean { return this.watcher !== null }
  /** OCR gate: only look at the screen while the game runs and round-1 info is missing. */
  get needsRoundOneInfo(): boolean {
    const s = this.current
    return this.gameRunning && s.phase !== 'match' && !(s.phase === 'loading' && s.mapKey && s.side)
  }

  start(): void {
    this.restartWatcher()
    void this.tick()
    this.poll = setInterval(() => void this.tick(), 4000)
    // Backfill existing replays without blocking startup paint.
    setTimeout(() => void this.rescan(), 50)
  }

  stop(): void {
    this.watcher?.close(); this.watcher = null
    if (this.poll) clearInterval(this.poll)
  }

  restartWatcher(): void {
    this.watcher?.close(); this.watcher = null
    const root = this.root()
    if (!root || !existsSync(root)) return
    try {
      this.watcher = watch(root, { recursive: true }, (_ev, name) => {
        if (name && /\.rec$/i.test(name)) this.schedule(`${root}/${name}`)
      })
    } catch { this.watcher = null }
  }

  private scanning: Promise<number> | null = null
  /** Imports any replays not yet in the DB (deduplicated if called while running). */
  rescan(): Promise<number> {
    this.scanning ??= (async () => {
      const root = this.root()
      const n = root ? await ingestReplayRoot(this.ctx.db, root) : 0
      if (n) { this.lastIngest = new Date().toISOString(); this.emit('ingested', n) }
      this.resume()
      return n
    })().finally(() => { this.scanning = null })
    return this.scanning
  }

  /** On startup / rescan: show the latest match if it is recent. */
  private resume(): void {
    const latest = this.ctx.db.latestMatch()
    if (latest && Date.now() - Date.parse(latest.lastAt) < STALE_MATCH_MS) void this.showMatch(latest.matchId, false)
    else this.push()
  }

  private schedule(path: string): void {
    // Files are written in one go at round end; a short debounce coalesces duplicate fs events.
    clearTimeout(this.pending.get(path))
    this.pending.set(path, setTimeout(() => { this.pending.delete(path); void this.onRoundFile(path) }, 120))
  }

  private async onRoundFile(path: string): Promise<void> {
    if (!existsSync(path)) return
    const rec: RoundRecord | null = ingestFile(this.ctx.db, path)
    if (!rec) return
    this.lastIngest = new Date().toISOString()
    try {
      const head = parseFile(path, true)
      this.format = { roundsPerMatch: head.roundsPerMatch || 6, overtimeRounds: Number(head.props['roundspermatchovertime']) || 3 }
    } catch { /* keep previous format */ }
    this.emit('ingested', 1)
    if (rec.matchId !== this.matchId) this.cards.clear()
    this.override = undefined // the recorded round supersedes OCR guesses
    await this.showMatch(rec.matchId, true)
  }

  private async showMatch(matchId: string, live: boolean): Promise<void> {
    this.matchId = matchId
    const rounds = this.ctx.db.roundsOfMatch(matchId)
    this.push(rounds, live ? undefined : 'ended')
    // Lobby ranks: one batched request for everyone not cached.
    const players = rounds.flatMap((r) => r.players)
    const names = Object.fromEntries(players.map((p) => [p.profileId, p.username]))
    const { cards, error } = await this.lobby.cards(Object.keys(names), names)
    for (const c of cards) this.cards.set(c.profileId, c)
    this.lobbyError = error ?? null
    this.push(rounds, live ? undefined : 'ended')
    if (this.onLobby) { await this.onLobby(Object.keys(names)).catch(() => undefined); this.push(rounds, live ? undefined : 'ended') }
  }

  private push(rounds?: RoundRecord[], phase?: LiveState['phase']): void {
    const rs = rounds ?? (this.matchId ? this.ctx.db.roundsOfMatch(this.matchId) : [])
    const state = rs.length || this.override
      ? buildLive(this.ctx, rs, { ...this.format, gameRunning: this.gameRunning, cards: this.cards, lobbyError: this.lobbyError, override: this.override, phase: rs.length ? (phase ?? (this.gameRunning ? undefined : 'ended')) : undefined })
      : emptyLive(this.gameRunning)
    if (this.simulating) state.source = 'simulation'
    this.current = state
    this.emit('state', state)
  }

  private async tick(): Promise<void> {
    // MatchReplay may only appear after the user enables replays in game: start watching then.
    if (!this.watcher) { const root = this.root(); if (root && existsSync(root)) { this.restartWatcher(); void this.rescan() } }
    const running = await isGameRunning()
    if (running === this.gameRunning || this.simulating) return
    this.gameRunning = running
    if (!running) this.override = undefined
    this.push()
  }

  /** Round-1 info from OCR (Phase 6). Starts a fresh "loading" state for a new match. */
  setDetected(d: { mapKey?: string; side?: Side; site?: string | null }, newMatch: boolean): void {
    const p = this.current.phase
    if (newMatch || (d.mapKey && (p === 'ended' || p === 'game' || p === 'idle'))) { this.matchId = null; this.cards.clear(); this.override = undefined }
    if (!this.matchId && !d.mapKey && !this.override?.mapKey) return // side alone is meaningless before a map
    this.override = { ...this.override, ...d }
    this.push()
  }

  /** Shows the most recent recorded match regardless of age (screenshots / demo). */
  async showLatest(): Promise<void> {
    const latest = this.ctx.db.latestMatch()
    if (latest) await this.showMatch(latest.matchId, true)
  }

  private simulating = false

  /** Replays the latest recorded match into the Live page round by round (no game needed).
   *  Uses the real lobby service, so with a Ubisoft login it fetches real ranks. */
  async simulate(stepMs = 4000): Promise<boolean> {
    const latest = this.ctx.db.latestMatch()
    return latest ? this.playRounds(this.ctx.db.roundsOfMatch(latest.matchId), stepMs) : false
  }

  private stopSim = false
  /** Stops a running simulation and returns to the normal live state. */
  stopSimulation(): void { this.stopSim = true }

  /** Plays rounds (recorded or synthetic) into the Live page one at a time. Nothing is stored. */
  async playRounds(rounds: RoundRecord[], stepMs = 4000): Promise<boolean> {
    if (!rounds.length || this.simulating) return false
    this.simulating = true
    this.stopSim = false
    const sleep = async () => {
      for (let t = 0; t < stepMs && !this.stopSim; t += 100) await new Promise((r) => setTimeout(r, Math.min(100, stepMs)))
      if (this.stopSim) throw new Error('stopped')
    }
    try {
      const first = rounds[0]!
      const me = this.ctx.me() ?? first.recordingProfileId
      const mySide = first.players.find((p) => p.profileId === me || p.profileId === first.recordingProfileId)?.side ?? 'attack'
      // Round 1: what OCR would report at operator select.
      this.matchId = null
      this.cards.clear()
      this.override = { mapKey: first.mapKey, side: mySide }
      this.push([], 'loading')
      await sleep()
      this.override = undefined
      this.matchId = first.matchId
      for (let i = 1; i <= rounds.length; i++) {
        const subset = rounds.slice(0, i)
        this.push(subset, i < rounds.length ? 'match' : 'ended')
        if (i === 1) {
          const names = Object.fromEntries(rounds.flatMap((r) => r.players).map((p) => [p.profileId, p.username]))
          const { cards, error } = await this.lobby.cards(Object.keys(names), names)
          for (const c of cards) this.cards.set(c.profileId, c)
          this.lobbyError = error ?? null
          this.push(subset, 'match')
          if (this.onLobby) { await this.onLobby(Object.keys(names)).catch(() => undefined); this.push(subset, 'match') }
        }
        await sleep()
      }
      return true
    } catch (e) {
      if (e instanceof Error && e.message === 'stopped') return false
      throw e
    } finally {
      this.simulating = false
      if (this.stopSim) { this.stopSim = false; this.matchId = null; this.cards.clear(); this.resume() }
    }
  }

  /** Recompute recommendations after settings/roster changes. */
  refresh(): void { if (!this.simulating) this.push() }
}
