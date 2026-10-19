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
  get needsRoundInfo(): boolean {
    // Between a round ending (new replay file clears the override) and the next operator-select
    // screen being read. Idle during gameplay once the side is known.
    return this.gameRunning && !this.simulating && !this.override?.side
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

  /** Map/side/site read from the screen (OCR). Before a match it starts a fresh "loading" state;
   *  during a match it only updates side/site for the upcoming round (a misread map is ignored). */
  setDetected(found: { mapKey?: string; side?: Side; site?: string | null }, newMatch: boolean): void {
    if (this.simulating) return
    const p = this.current.phase
    const d = p === 'match' ? { side: found.side, site: found.site } : found
    if (p === 'match') newMatch = false
    if (newMatch || (d.mapKey && (p === 'ended' || p === 'game' || p === 'idle'))) { this.matchId = null; this.cards.clear(); this.override = undefined }
    // Side/site without a map only count during a match (menus also show ATTACK/DEFENSE labels).
    if (!d.mapKey && !(p === 'match' || p === 'loading')) return
    if (!this.matchId && !d.mapKey && !this.override?.mapKey) return
    this.override = { ...this.override, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) }
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

  private simToken = 0
  /** Stops a running simulation (or clears a finished one) and returns to the normal live state. */
  stopSimulation(): void {
    this.simToken++
    if (this.simulating || this.current.source === 'simulation') {
      this.simulating = false
      this.override = undefined
      this.matchId = null
      this.cards.clear()
      this.resume()
    }
  }

  /** Plays rounds (recorded or synthetic) into the Live page one at a time. Nothing is stored.
   *  Starting a new playback cancels any running one; Stop cancels immediately. */
  async playRounds(rounds: RoundRecord[], stepMs = 4000): Promise<boolean> {
    if (!rounds.length) return false
    const token = ++this.simToken
    const alive = () => token === this.simToken
    this.simulating = true
    const sleep = async () => {
      for (let t = 0; t < stepMs && alive(); t += 100) await new Promise((r) => setTimeout(r, Math.min(100, stepMs)))
      return alive()
    }
    const first = rounds[0]!
    const me = this.ctx.me() ?? first.recordingProfileId
    const mySide = first.players.find((p) => p.profileId === me || p.profileId === first.recordingProfileId)?.side ?? 'attack'
    // Round 1: what OCR would report at operator select.
    this.matchId = null
    this.cards.clear()
    this.override = { mapKey: first.mapKey, side: mySide }
    this.push([], 'loading')
    if (!(await sleep())) return false
    this.override = undefined
    this.matchId = first.matchId
    for (let i = 1; i <= rounds.length; i++) {
      const subset = rounds.slice(0, i)
      this.push(subset, i < rounds.length ? 'match' : 'ended')
      if (i === 1) {
        const names = Object.fromEntries(rounds.flatMap((r) => r.players).map((p) => [p.profileId, p.username]))
        const { cards, error } = await this.lobby.cards(Object.keys(names), names)
        if (!alive()) return false
        for (const c of cards) this.cards.set(c.profileId, c)
        this.lobbyError = error ?? null
        this.push(subset, 'match')
        if (this.onLobby) { await this.onLobby(Object.keys(names)).catch(() => undefined); if (!alive()) return false; this.push(subset, 'match') }
      }
      if (i < rounds.length && !(await sleep())) return false
    }
    // Finished: the result stays on screen (source "simulation") until Stop or the next real event.
    if (alive()) this.simulating = false
    return true
  }

  /** Recompute recommendations after settings/roster changes. */
  refresh(): void { if (!this.simulating) this.push() }
}
