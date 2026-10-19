// Main ↔ renderer contract. The preload exposes RsApi as window.rs; main registers a handler
// for every method in API_METHODS (channel "rs:<method>"). Live updates arrive on "rs:live".
import type { Agg, Side } from './types'
import type { CatalogOverrides } from './catalog'

export interface PlayerCard {
  profileId: string
  name: string
  loaded: boolean
  level: number | null
  hoursPlayed: number | null
  ranked: { rank: number; rankPoints: number; maxRank: number; maxRankPoints: number; seasonId: number } | null
  season: { wins: number; losses: number; abandons: number; kills: number; deaths: number; board: string } | null
}

export interface Recommendation {
  operatorId: string
  name: string
  score: number // estimated round win chance, %
  reasons: string[]
  personal: Agg // this map/site/side (or broader scope, see scope)
  scope: 'site' | 'map' | 'overall' | 'none'
  metaRounds: number
  baseline: boolean // meta came from seed tiers only
  tier: 'S' | 'A' | 'B' | 'map' | null // curated site tier (B = fits this kind of site)
}

export interface LivePlayer {
  profileId: string
  name: string
  isMe: boolean
  card: PlayerCard | null
  ops: { round: number; operatorId: string; side: Side | null; won: boolean }[]
  /** Most played operators (Ubisoft stats, current season, else lifetime). */
  mains: { opKey: string; name: string; side: Side; rounds: number; wins: number }[]
  kills: number
  deaths: number
}

export interface RoundSummary { round: number; side: Side | null; site: string; won: boolean; myOp: string | null }

export type LivePhase = 'idle' | 'game' | 'loading' | 'match' | 'ended'

export interface LiveState {
  phase: LivePhase
  gameRunning: boolean
  matchId: string | null
  mapKey: string | null
  side: Side | null // my side for the upcoming round
  site: string | null // known site for the upcoming round (defense) or null
  nextRound: number
  score: [number, number] // [mine, enemy]
  myTeam: LivePlayer[]
  enemyTeam: LivePlayer[]
  recommendations: Recommendation[]
  /** Top picks for the other side, in case the predicted side is wrong. */
  otherSide: { side: Side; recs: Recommendation[] } | null
  /** A clearly better pick that is not in your roster (only when your roster is explicit). */
  outsideRoster: Recommendation | null
  siteRecs: { site: string; recs: Recommendation[] }[]
  rounds: RoundSummary[]
  source: 'replay' | 'ocr' | 'preview' | 'simulation' | null
  lobbyError: string | null
  updatedAt: string
}

/** Multipliers (0–2, default 1) on each part of the estimated win chance. */
export interface Weights { personal: number; meta: number; site: number; role: number; comfort: number }

export interface ThemeSettings {
  accent: string
  attack: string
  defense: string
  bg: string
  surface: string
  text: string
  fontScale: number // 0.85..1.4
  density: 'comfortable' | 'compact'
  angled: boolean // R6-style cut corners
}

export interface Settings {
  gameDir: string | null
  roster: { attack: string[]; defense: string[] } // operator keys; empty = all
  weights: Weights
  theme: ThemeSettings
  panels: { recommendations: boolean; siteBreakdown: boolean; teams: boolean; timeline: boolean }
  topN: number
  minRounds: number // personal sample needed before trusting own stats fully
  alwaysOnTop: boolean
  autoSwitchToLive: boolean
  launchAtLogin: boolean
  ocrEnabled: boolean
  datasetUrl: string
}

export interface OpStatRow { operatorId: string; name: string; side: Side; agg: Agg }

export interface MetaRow {
  operatorId: string
  name: string
  side: Side
  pickRate: number // share of rounds on this side where op was picked (per player slot)
  winRate: number
  rounds: number
  source: 'replays' | 'baseline'
}

export interface AppStatus {
  replayRoot: string | null
  replayRootExists: boolean
  watching: boolean
  rounds: number
  matches: number
  players: number
  lastIngest: string | null
  loggedIn: boolean
  loginMethod: 'password' | 'web' | null
  myProfileId: string | null
  myName: string | null
  datasetVersion: string | null
  version: string
}

export interface ApiOpRow { opKey: string; name: string; side: Side; rounds: number; wins: number; players: number }
export interface ApiOps { rows: ApiOpRow[]; players: number; seasons: string[]; current: string; lastError: string | null }

export interface SimPerson { profileId: string; name: string; source: 'friend' | 'recent' }
export interface SimRequest { mapKey: string; side: Side; myTeam: string[]; enemyTeam: string[] } // names or profile ids

export interface AuthResult { ok: boolean; twoFactor?: boolean; error?: string }

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'upToDate' | 'downloading' | 'ready' | 'error' | 'unsupported'
  current: string
  next?: string
  percent?: number
  checkedAt?: string
  error?: string
}

export interface PlayerLookup { card: PlayerCard | null; history: { seasonId: number; board: string; rank: number; rankPoints: number; maxRank: number; maxRankPoints: number; wins: number; losses: number; kills: number; deaths: number }[]; encounters: number; error?: string }

export interface RsApi {
  status(): Promise<AppStatus>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getLive(): Promise<LiveState>
  preview(mapKey: string, side: Side, site: string | null): Promise<LiveState>
  login(email: string, password: string): Promise<AuthResult>
  submitTwoFactor(code: string): Promise<AuthResult>
  logout(): Promise<void>
  opStats(f: { mine: boolean; mapKey?: string; site?: string; side?: Side; season?: string }): Promise<OpStatRow[]>
  meta(f: { mapKey?: string; site?: string; side: Side; season?: string }): Promise<MetaRow[]>
  sites(mapKey: string): Promise<{ site: string; rounds: number }[]>
  seasons(): Promise<string[]>
  lookupPlayer(name: string): Promise<PlayerLookup>
  rescan(): Promise<AppStatus>
  pickGameDir(): Promise<string | null>
  /** Replays the last recorded match into the Live page round by round (testing without playing). */
  simulate(): Promise<boolean>
  /** Dataset + learned operators, so the renderer catalog matches main. */
  catalog(): Promise<CatalogOverrides>
  /** Opens Ubisoft's own login page (Xbox / PlayStation / Facebook / email). */
  loginWithUbisoft(): Promise<AuthResult>
  /** Ubisoft Career operator stats: yours ('me') or aggregated over players you've met ('others'). */
  apiOps(f: { who: 'me' | 'others'; season: string; playlist?: string }): Promise<ApiOps>
  /** Friends (Ubisoft) and players you've met, for the simulator. */
  simPeople(): Promise<{ people: SimPerson[]; error: string | null }>
  /** Simulates a match on any map with chosen players (in memory only). */
  /** Empty teams = auto-pick random players (friends + met), preferring ranked-this-season. mapKey 'random' allowed. */
  simulateMatch(r: SimRequest): Promise<{ ok: boolean; error?: string; unresolved?: string[]; ranked?: number }>
  stopSimulation(): Promise<void>
  updateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  onLive(cb: (s: LiveState) => void): () => void
}

export const API_METHODS = [
  'status', 'getSettings', 'setSettings', 'getLive', 'preview', 'login', 'submitTwoFactor', 'logout',
  'opStats', 'meta', 'sites', 'seasons', 'lookupPlayer', 'rescan', 'pickGameDir', 'catalog', 'simulate', 'loginWithUbisoft', 'apiOps', 'simPeople', 'simulateMatch', 'stopSimulation', 'updateStatus', 'checkForUpdates', 'installUpdate'
] as const satisfies readonly Exclude<keyof RsApi, 'onLive' | 'onUpdate'>[]
