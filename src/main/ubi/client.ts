// Unofficial Ubisoft services client (same endpoints the official stats site and siegeapi use).
// Electron-agnostic: fetch, clock and persistence are injected so it is unit-testable.

export const UBI = {
  sessions: 'https://public-ubiservices.ubi.com/v3/profiles/sessions',
  base: 'https://public-ubiservices.ubi.com',
  appId: '4391c956-8943-48eb-8859-07b0778f47b9',
  /** App ids tried, in order, for email/password logins. Since 2026-10 Ubisoft's edge bot-protection
   *  blocks Basic-auth logins for `appId` (HTML 403), while the Ubisoft Connect PC id still works. */
  loginAppIds: ['f68a4bb5-608a-4ff2-8123-be8ef797e0a6', '4391c956-8943-48eb-8859-07b0778f47b9'],
  advancedAppId: 'e3d5ea9e-50bd-43b7-88bf-39794f4e3d40',
  xplaySpace: '0d2ae42d-4c27-4cb7-af6c-2099062302bb',
  userAgent: 'UbiServices_SDK_2020.Release.58_PC64_ansi_static'
}

export interface Session {
  ticket: string
  sessionId: string
  expiration: string // ISO
  profileId: string
  nameOnPlatform?: string
  rememberMeTicket?: string
  /** App id the ticket belongs to when it is not ours (web sign-in fallback). */
  appId?: string
}

export interface StoredAuth {
  base?: Session
  advanced?: Session
  /** Long-lived remember-me ticket and the Ubisoft app it belongs to (ours, or the web login's). */
  remember?: { ticket: string; appId: string }
  /** How the user signed in, for the UI. */
  method?: 'password' | 'web'
}

/** A session captured from Ubisoft's own login page (any Ubisoft app id). */
export interface WebSession { ticket: string; appId: string; rememberMeTicket?: string }

export interface Credentials { email: string; password: string }

export interface UbiDeps {
  fetch: typeof fetch
  now: () => number
  loadCredentials: () => Credentials | null
  loadAuth: () => StoredAuth
  saveAuth: (a: StoredAuth) => void
  /** Optional silent re-login (e.g. hidden Ubisoft login window with saved cookies). */
  reauth?: () => Promise<WebSession | null>
}

export class UbiError extends Error {
  readonly status: number
  readonly code: 'auth' | 'twoFactor' | 'rateLimited' | 'http' | 'shape' | 'noCredentials' | 'blocked'
  constructor(code: UbiError['code'], message: string, status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface Profile { profileId: string; userId: string; name: string; platform: string }

export interface BoardProfile {
  profileId: string
  board: string // 'ranked' | 'standard' | 'dual_front' | ...
  seasonId: number
  rank: number
  rankPoints: number
  maxRank: number
  maxRankPoints: number
  topRankPosition: number
  wins: number
  losses: number
  abandons: number
  kills: number
  deaths: number
}

export interface BasicStats { profileId: string; level: number; pvpSeconds: number; totalSeconds: number }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const n = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) || 0 : 0)
const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const chunk = <T>(xs: T[], size: number): T[][] => Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, i * size + size))

export function toSession(data: unknown): Session {
  if (!isObj(data) || !s(data['ticket'])) throw new UbiError('shape', 'session response missing ticket')
  return {
    ticket: s(data['ticket']), sessionId: s(data['sessionId']), expiration: s(data['expiration']),
    profileId: s(data['profileId']), nameOnPlatform: s(data['nameOnPlatform']) || undefined,
    rememberMeTicket: s(data['rememberMeTicket']) || undefined
  }
}

export class UbiClient {
  private auth: StoredAuth
  private pending2fa: { ticket: string; appId: string } | null = null
  private inflight: Promise<Session> | null = null
  private readonly d: UbiDeps

  constructor(deps: UbiDeps) {
    this.d = deps
    this.auth = deps.loadAuth()
    // Migrate v0.1.0 storage: remember-me lived on the base session.
    if (!this.auth.remember && this.auth.base?.rememberMeTicket) this.auth.remember = { ticket: this.auth.base.rememberMeTicket, appId: UBI.appId }
  }

  get profileId(): string | undefined { return this.auth.base?.profileId }
  get loggedIn(): boolean { return !!this.auth.base }
  get method(): StoredAuth['method'] { return this.auth.method }
  /** True when a request can authenticate (session or stored credentials). */
  get canAuth(): boolean { return this.loggedIn || this.d.loadCredentials() !== null }

  private valid(sess?: Session, marginMs = 5 * 60_000): boolean {
    return !!sess && Date.parse(sess.expiration) - marginMs > this.d.now()
  }

  private async postSession(authorization: string, appId: string, extra: Record<string, string> = {}): Promise<unknown> {
    const res = await this.d.fetch(UBI.sessions, {
      method: 'POST',
      headers: { Authorization: authorization, 'Ubi-AppId': appId, 'User-Agent': UBI.userAgent, 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify({ rememberMe: true })
    })
    if (res.status === 429) throw new UbiError('rateLimited', 'Ubisoft rate limit: wait a few minutes', 429)
    const text = await res.text().catch(() => '')
    // An HTML page instead of JSON is Ubisoft's edge bot-protection, not a credentials problem.
    if (!res.ok && /^\s*</.test(text)) throw new UbiError('blocked', 'Ubisoft blocked this sign-in method (bot protection). Try "Sign in with Ubisoft" instead.', res.status)
    let body: unknown = null
    try { body = JSON.parse(text) } catch { /* empty / non-JSON */ }
    if (!res.ok) throw new UbiError('auth', (isObj(body) && s(body['message'])) || `login failed (${res.status})`, res.status)
    return body
  }

  /** Email/password login. Returns 'twoFactor' when a code is required (call submitTwoFactor). */
  async login(c: Credentials): Promise<'ok' | 'twoFactor'> {
    const basic = 'Basic ' + Buffer.from(`${c.email}:${c.password}`).toString('base64')
    let lastBlock: UbiError | null = null
    for (const appId of UBI.loginAppIds) {
      let body: unknown
      try { body = await this.postSession(basic, appId) } catch (e) {
        if (e instanceof UbiError && e.code === 'blocked') { lastBlock = e; continue } // try the next app id
        throw e
      }
      if (isObj(body) && !s(body['ticket']) && s(body['twoFactorAuthenticationTicket'])) {
        this.pending2fa = { ticket: s(body['twoFactorAuthenticationTicket']), appId }
        return 'twoFactor'
      }
      await this.adopt(toSession(body), appId, 'password')
      return 'ok'
    }
    throw lastBlock ?? new UbiError('auth', 'login failed')
  }

  async submitTwoFactor(code: string): Promise<void> {
    if (!this.pending2fa) throw new UbiError('twoFactor', 'no pending two-factor login')
    const { ticket, appId } = this.pending2fa
    const body = await this.postSession(`ubi_2fa_v1 t=${ticket}`, appId, { 'Ubi-2FACode': code.trim() })
    this.pending2fa = null
    await this.adopt(toSession(body), appId, 'password')
  }

  /** Signs in with a session captured from Ubisoft's own login page (Xbox/PSN/Facebook/email). */
  adoptWebSession(web: WebSession): Promise<void> {
    const sess: Session = { ticket: web.ticket, sessionId: '', expiration: new Date(this.d.now() + 2.5 * 3600_000).toISOString(), profileId: '', rememberMeTicket: web.rememberMeTicket }
    return this.adopt(sess, web.appId, 'web')
  }

  /** Stores a session obtained under any app id. Foreign tickets are exchanged for a session of
   *  our app id (like the advanced session); if Ubisoft refuses, the foreign session is used as-is. */
  private async adopt(sess: Session, appId: string, method: StoredAuth['method']): Promise<void> {
    if (appId === UBI.appId) { this.setBase(sess, method, appId); return }
    let own: Session | null = null
    try { own = toSession(await this.postSession(`Ubi_v1 t=${sess.ticket}`, UBI.appId)) } catch (e) {
      if (e instanceof UbiError && e.code === 'rateLimited') throw e
    }
    if (own) {
      // Prefer a remember-me ticket for our own app id; else keep the one from the original app.
      if (own.rememberMeTicket) this.setBase(own, method, UBI.appId)
      else this.setBase(own, method, appId, sess.rememberMeTicket)
    } else this.setBase({ ...sess, appId }, method, appId, sess.rememberMeTicket)
  }

  logout(): void { this.auth = {}; this.d.saveAuth(this.auth) }

  private setBase(sess: Session, method?: StoredAuth['method'], rememberAppId?: string, rememberTicket?: string): void {
    const ticket = rememberTicket ?? sess.rememberMeTicket
    const remember = ticket && rememberAppId ? { ticket, appId: rememberAppId } : this.auth.remember
    this.auth = { base: sess, remember, method: method ?? this.auth.method }
    this.d.saveAuth(this.auth)
  }

  /** Valid base session: cached → remember-me refresh → silent re-login → stored credentials. */
  private async baseSession(): Promise<Session> {
    if (this.valid(this.auth.base)) return this.auth.base!
    const rm = this.auth.remember
    if (rm) {
      try {
        const fresh = toSession(await this.postSession(`rm_v1 t=${rm.ticket}`, rm.appId))
        await this.adopt({ ...fresh, rememberMeTicket: fresh.rememberMeTicket ?? rm.ticket }, rm.appId, this.auth.method)
        return this.auth.base!
      } catch (e) {
        if (e instanceof UbiError && e.code === 'rateLimited') throw e
      }
    }
    if (this.auth.method === 'web' && this.d.reauth) {
      const web = await this.d.reauth().catch(() => null)
      if (web) { await this.adoptWebSession(web); return this.auth.base! }
    }
    const creds = this.d.loadCredentials()
    if (!creds) throw new UbiError('noCredentials', 'Log in with your Ubisoft account in Settings')
    if ((await this.login(creds)) === 'twoFactor') throw new UbiError('twoFactor', 'Two-factor code required: open Settings')
    return this.auth.base!
  }

  private async advancedSession(): Promise<Session> {
    if (this.valid(this.auth.advanced)) return this.auth.advanced!
    const base = await this.baseSession()
    this.auth.advanced = toSession(await this.postSession(`Ubi_v1 t=${base.ticket}`, UBI.advancedAppId))
    this.d.saveAuth(this.auth)
    return this.auth.advanced
  }

  /** Warms both sessions so the first live request doesn't pay for login. Deduplicated. */
  warm(): Promise<Session> {
    this.inflight ??= this.advancedSession().finally(() => { this.inflight = null })
    return this.inflight
  }

  private async get(path: string, advanced = false, retried = false): Promise<unknown> {
    const sess = advanced ? await this.advancedSession() : await this.baseSession()
    const res = await this.d.fetch(UBI.base + path, {
      headers: {
        Authorization: `Ubi_v1 t=${sess.ticket}`, 'Ubi-AppId': advanced ? UBI.advancedAppId : sess.appId ?? UBI.appId,
        'Ubi-SessionId': sess.sessionId, 'Ubi-LocaleCode': 'en-us', 'User-Agent': UBI.userAgent
      }
    })
    if (res.status === 204) return {}
    if (res.status === 429) throw new UbiError('rateLimited', 'Ubisoft rate limit', 429)
    if (res.status === 401 && !retried) {
      if (advanced) this.auth.advanced = undefined
      else this.auth.base = { ...this.auth.base!, expiration: new Date(0).toISOString() }
      return this.get(path, advanced, true)
    }
    if (!res.ok) throw new UbiError('http', `${path.split('?')[0]} → ${res.status}`, res.status)
    return res.json()
  }

  private static profiles(data: unknown): Profile[] {
    return arr(isObj(data) ? data['profiles'] : null).filter(isObj).map((p) => ({
      profileId: s(p['profileId']), userId: s(p['userId']), name: s(p['nameOnPlatform']), platform: s(p['platformType'])
    }))
  }

  async profileByName(name: string, platform = 'uplay'): Promise<Profile | null> {
    const data = await this.get(`/v3/profiles?nameOnPlatform=${encodeURIComponent(name)}&platformType=${platform}`)
    return UbiClient.profiles(data)[0] ?? null
  }

  async profilesByIds(ids: string[]): Promise<Profile[]> {
    const out: Profile[] = []
    for (const part of chunk(ids, 50)) out.push(...UbiClient.profiles(await this.get(`/v3/profiles?profileIds=${part.join(',')}`)))
    return out
  }

  /** Rank/RP/W-L/K-D per board for many players (one request per 20 ids). */
  async fullProfiles(ids: string[], platformFamily = 'pc'): Promise<BoardProfile[]> {
    const out: BoardProfile[] = []
    for (const part of chunk(ids, 20)) {
      const data = await this.get(`/v2/spaces/${UBI.xplaySpace}/title/r6s/skill/full_profiles?profile_ids=${part.join(',')}&platform_families=${platformFamily}`, true)
      out.push(...parseFullProfiles(data, part))
    }
    return out
  }

  /** Per-operator rounds played/won for many players in one request per 40 ids (the official
   *  Career page's stats). `calendarId` selects one season; omit it for lifetime. */
  async operatorStats(ids: string[], opKeyOf: (hex: string) => string | undefined, season?: { code: string; calendarId: string }): Promise<OperatorStatRow[]> {
    const names = season ? 'RoundPlayedOperatorConsolePlaylistSeasonal,RoundWonOperatorConsolePlaylistSeasonal' : 'RoundPlayedOperatorConsolePlaylist,RoundWonOperatorConsolePlaylist'
    const out: OperatorStatRow[] = []
    for (const part of chunk(ids, 40)) {
      const cal = season ? `&calendarEntryId=${season.calendarId}` : ''
      const data = await this.get(`/v1/profiles/stats?profileIds=${part.join(',')}&spaceId=${UBI.xplaySpace}&statNames=${names}${cal}`)
      out.push(...parseOperatorStats(data, season?.code ?? 'all', opKeyOf))
    }
    return out
  }

  /** Ranked rank at the end of a past season (the official Career page's "RankingRankSeasonal"),
   *  for many players: one request per 40 ids. Players with no ranked games that season are absent. */
  async seasonRanks(ids: string[], season: { code: string; calendarId: string }): Promise<{ profileId: string; season: string; rank: number }[]> {
    const out: { profileId: string; season: string; rank: number }[] = []
    for (const part of chunk(ids, 40)) {
      const data = await this.get(`/v1/profiles/stats?profileIds=${part.join(',')}&spaceId=${UBI.xplaySpace}&statNames=RankingRankSeasonal&calendarEntryId=${season.calendarId}`)
      for (const p of arr(isObj(data) ? data['profiles'] : null).filter(isObj)) {
        const st = isObj(p['stats']) ? p['stats'] : {}
        const v = st['RankingRankSeasonal']
        const rank = n(isObj(v) ? v['value'] : v)
        if (rank > 0) out.push({ profileId: s(p['profileId']), season: season.code, rank })
      }
    }
    return out
  }

  /** Raw stats response (diagnostics only: --probe-ranks). */
  rawStats(path: string): Promise<unknown> { return this.get(path) }

  /** Your Ubisoft friends list (same call as the Ubisoft account site). */
  async friends(): Promise<{ profileId: string; name: string; favorite: boolean }[]> {
    const me = (await this.baseSession()).profileId || this.profileId
    if (!me) return []
    const data = await this.get(`/v3/profiles/${me}/friends?locale=en-US`)
    const friends = arr(isObj(data) ? data['friends'] : null).filter(isObj)
      .filter((f) => !f['state'] || s(f['state']) === 'Friends')
      .map((f) => ({ profileId: s(f['pid']), name: s(f['nickname']), favorite: f['isFavorite'] === true }))
      .filter((f) => f.profileId)
    // "nickname" is your private alias for the friend (usually empty): use their real username.
    const names = new Map((await this.profilesByIds(friends.map((f) => f.profileId)).catch(() => [])).map((p) => [p.profileId, p.name]))
    return friends.map((f) => ({ ...f, name: names.get(f.profileId) || f.name || 'Unknown' }))
  }

  async basicStats(ids: string[]): Promise<BasicStats[]> {
    const names = 'PClearanceLevel,PPvPTimePlayed,PTotalTimePlayed'
    const out: BasicStats[] = []
    for (const part of chunk(ids, 50)) {
      const data = await this.get(`/v1/profiles/stats?profileIds=${part.join(',')}&spaceId=${UBI.xplaySpace}&statNames=${names}`)
      for (const p of arr(isObj(data) ? data['profiles'] : null).filter(isObj)) {
        const st = isObj(p['stats']) ? p['stats'] : {}
        const v = (k: string) => n(isObj(st[k]) ? (st[k] as Record<string, unknown>)['value'] : 0)
        out.push({ profileId: s(p['profileId']), level: v('PClearanceLevel'), pvpSeconds: v('PPvPTimePlayed'), totalSeconds: v('PTotalTimePlayed') })
      }
    }
    return out
  }
}

export interface OperatorStatRow {
  profileId: string
  season: string // 'all' or season code (e.g. 'Y11S3')
  playlist: 'ranked' | 'unranked' | 'quick' | 'other'
  opKey: string
  rounds: number
  wins: number
}

const PLAYLISTS: Record<string, OperatorStatRow['playlist']> = {
  MATCHMAKING_PVP_RANKED: 'ranked', MATCHMAKING_PVP_UNRANKED: 'unranked', MATCHMAKING_PVP_CASUAL: 'quick'
}

/** Parses Career-page operator stats ("RoundPlayedOperatorConsolePlaylist[Seasonal].….playlist.X.CLASS.<hex>").
 *  `opKeyOf` maps the stats-service hex id to our operator key (unknown ids are dropped). */
export function parseOperatorStats(data: unknown, season: string, opKeyOf: (hex: string) => string | undefined): OperatorStatRow[] {
  const rows = new Map<string, OperatorStatRow>()
  for (const p of arr(isObj(data) ? data['profiles'] : null).filter(isObj)) {
    const profileId = s(p['profileId'])
    const stats = isObj(p['stats']) ? p['stats'] : {}
    for (const [k, v] of Object.entries(stats)) {
      const m = /^Round(Played|Won)OperatorConsolePlaylist(?:Seasonal)?\..*\.playlist\.([A-Z_]+)\.CLASS\.([0-9A-F]{16})$/.exec(k)
      if (!m) continue
      const opKey = opKeyOf(m[3]!)
      if (!opKey) continue
      const playlist = PLAYLISTS[m[2]!] ?? 'other'
      const id = `${profileId}|${playlist}|${opKey}`
      const row = rows.get(id) ?? { profileId, season, playlist, opKey, rounds: 0, wins: 0 }
      const value = n(isObj(v) ? v['value'] : v)
      if (m[1] === 'Played') row.rounds += value; else row.wins += value
      rows.set(id, row)
    }
  }
  return [...rows.values()].filter((r) => r.rounds > 0)
}

const BOARD_RENAMES: Record<string, string> = { living_game_mode: 'dual_front', pvp_ranked: 'ranked' }

export function parseFullProfiles(data: unknown, requested: string[]): BoardProfile[] {
  const fam = arr(isObj(data) ? data['platform_families_full_profiles'] : null).filter(isObj)[0]
  const out: BoardProfile[] = []
  for (const board of arr(fam?.['board_ids_full_profiles']).filter(isObj)) {
    const id = s(board['board_id'])
    const list = arr(board['full_profiles']).filter(isObj)
    list.forEach((fp, i) => {
      const prof = isObj(fp['profile']) ? fp['profile'] : {}
      const st = isObj(fp['season_statistics']) ? fp['season_statistics'] : {}
      const mo = isObj(st['match_outcomes']) ? st['match_outcomes'] : {}
      // Ubisoft echoes the id as profile.id (sometimes profile_id); fall back to request order.
      const pid = s(prof['id']) || s(prof['profile_id']) || s(fp['profile_id']) || (list.length === requested.length ? requested[i] ?? '' : '')
      if (!pid) return
      out.push({
        profileId: pid, board: BOARD_RENAMES[id] ?? id, seasonId: n(prof['season_id']),
        rank: n(prof['rank']), rankPoints: n(prof['rank_points']), maxRank: n(prof['max_rank']),
        maxRankPoints: n(prof['max_rank_points']), topRankPosition: n(prof['top_rank_position']),
        wins: n(mo['wins']), losses: n(mo['losses']), abandons: n(mo['abandons']), kills: n(st['kills']), deaths: n(st['deaths'])
      })
    })
  }
  return out
}
