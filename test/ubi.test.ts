import { describe, expect, it } from 'vitest'
import { parseFullProfiles, UbiClient, UbiError, type StoredAuth } from '../src/main/ubi/client'
import { LobbyService } from '../src/main/ubi/lobby'
import { openDb } from '../src/main/db'
import { rankName, seasonCodeToId, seasonIdToCode } from '../src/shared/ranks'

const NOW = Date.parse('2026-10-19T12:00:00Z')
const later = (h: number) => new Date(NOW + h * 3600_000).toISOString()
const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

type Call = { url: string; init?: RequestInit }
function mockFetch(handler: (c: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = []
  const f = (async (url: string, init?: RequestInit) => {
    const c = { url: String(url), init }
    calls.push(c)
    const { status = 200, body = {} } = handler(c)
    return new Response(status === 204 ? null : JSON.stringify(body), { status })
  }) as typeof fetch
  return { f, calls }
}
const auth = (c: Call) => (c.init?.headers as Record<string, string>)['Authorization'] ?? ''
const session = (t: string, extra = {}) => ({ ticket: t, sessionId: 's-' + t, expiration: later(3), profileId: P1, ...extra })

function client(f: typeof fetch, stored: StoredAuth = {}, creds = true) {
  let saved = stored
  const c = new UbiClient({
    fetch: f, now: () => NOW, loadAuth: () => saved, saveAuth: (a) => { saved = a },
    loadCredentials: () => (creds ? { email: 'a@b.c', password: 'pw' } : null)
  })
  return { c, saved: () => saved }
}

const FULL = {
  platform_families_full_profiles: [{
    board_ids_full_profiles: [
      { board_id: 'ranked', full_profiles: [
        { profile: { id: P1, rank: 27, rank_points: 3712, max_rank: 28, max_rank_points: 3801, season_id: 43 }, season_statistics: { kills: 120, deaths: 100, match_outcomes: { wins: 14, losses: 10, abandons: 1 } } },
        { profile: { id: P2, rank: 36, rank_points: 4620, max_rank: 36, max_rank_points: 4700, season_id: 43 }, season_statistics: { kills: 300, deaths: 200, match_outcomes: { wins: 40, losses: 20, abandons: 0 } } }
      ] },
      { board_id: 'living_game_mode', full_profiles: [] }
    ]
  }]
}

describe('ubi client', () => {
  it('logs in, then gets an advanced session for full_profiles', async () => {
    const m = mockFetch((c) => {
      if (c.url.endsWith('/sessions')) return { body: session(auth(c).startsWith('Basic') ? 'base' : 'adv') }
      return { body: FULL }
    })
    const { c } = client(m.f)
    const cards = await c.fullProfiles([P1, P2])
    expect(cards.map((x) => [x.profileId, x.rank])).toEqual([[P1, 27], [P2, 36]])
    expect(auth(m.calls[1]!)).toBe('Ubi_v1 t=base') // advanced session derived from base
    expect(auth(m.calls[2]!)).toBe('Ubi_v1 t=adv')
    await c.fullProfiles([P1])
    expect(m.calls.filter((x) => x.url.endsWith('/sessions')).length).toBe(2) // sessions reused
  })

  it('handles two-factor login', async () => {
    const m = mockFetch((c) => {
      const h = c.init?.headers as Record<string, string>
      if (h['Ubi-2FACode'] === '123456') return { body: session('base2fa') }
      return { body: { twoFactorAuthenticationTicket: 'tfa' } }
    })
    const { c } = client(m.f)
    expect(await c.login({ email: 'a', password: 'b' })).toBe('twoFactor')
    await c.submitTwoFactor(' 123456 ')
    expect(auth(m.calls[1]!)).toBe('ubi_2fa_v1 t=tfa')
    expect(c.loggedIn).toBe(true)
  })

  it('refreshes an expired session with the remember-me ticket, not the password', async () => {
    const expired = { ...session('old', { rememberMeTicket: 'rm1' }), expiration: later(-1) }
    const m = mockFetch((c) => (c.url.endsWith('/sessions') ? { body: session('new') } : { body: { profiles: [] } }))
    const { c, saved } = client(m.f, { base: expired })
    await c.profilesByIds([P1])
    expect(auth(m.calls[0]!)).toBe('rm_v1 t=rm1')
    expect(saved().remember?.ticket).toBe('rm1')
  })

  it('reports missing credentials and rate limits as typed errors', async () => {
    const none = client(mockFetch(() => ({ status: 401 })).f, {}, false).c
    await expect(none.profilesByIds([P1])).rejects.toMatchObject({ code: 'noCredentials' })
    const limited = client(mockFetch(() => ({ status: 429 })).f).c
    await expect(limited.profilesByIds([P1])).rejects.toBeInstanceOf(UbiError)
  })

  it('retries once on 401 with a fresh session', async () => {
    let gets = 0
    const m = mockFetch((c) => {
      if (c.url.endsWith('/sessions')) return { body: session('t' + gets) }
      return ++gets === 1 ? { status: 401 } : { body: { profiles: [{ profileId: P1, nameOnPlatform: 'Me', userId: 'u', platformType: 'uplay' }] } }
    })
    const { c } = client(m.f)
    expect((await c.profilesByIds([P1]))[0]?.name).toBe('Me')
  })

  it('tolerates junk shapes', () => {
    expect(parseFullProfiles(null, [P1])).toEqual([])
    expect(parseFullProfiles({ platform_families_full_profiles: [{ board_ids_full_profiles: [{ board_id: 'ranked', full_profiles: [{}] }] }] }, [P1])[0]?.profileId).toBe(P1)
  })
})

describe('lobby service', () => {
  it('batches, caches, and snapshots ranks', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/sessions') ? { body: session('x') } : c.url.includes('full_profiles') ? { body: FULL } : { body: { profiles: [{ profileId: P1, stats: { PClearanceLevel: { value: '187' }, PPvPTimePlayed: { value: 360000 } } }] } }))
    const db = openDb(':memory:')
    const svc = new LobbyService(client(m.f).c, db, () => NOW)
    const a = await svc.cards([P1, P2, 'name:bot'], { [P1]: 'Me' })
    expect(a.error).toBeUndefined()
    expect(a.cards[0]).toMatchObject({ name: 'Me', level: 187, hoursPlayed: 100, ranked: { rank: 27, rankPoints: 3712 } })
    expect(a.cards[2]?.loaded).toBe(false)
    const before = m.calls.length
    await svc.cards([P1, P2])
    expect(m.calls.length).toBe(before) // served from cache
    expect(db.rankHistory(P2)[0]?.rankPoints).toBe(4620)
  })

  it('degrades gracefully when not logged in', async () => {
    const svc = new LobbyService(client(mockFetch(() => ({})).f, {}, false).c, openDb(':memory:'), () => NOW)
    const r = await svc.cards([P1], { [P1]: 'Me' })
    expect(r.error).toMatch(/Not logged in/)
    expect(r.cards[0]).toMatchObject({ name: 'Me', loaded: false })
  })
})

describe('ranks', () => {
  it('maps ids and seasons', () => {
    expect(rankName(0)).toBe('Unranked')
    expect(rankName(1)).toBe('Copper 5')
    expect(rankName(35)).toBe('Diamond 1')
    expect(rankName(36)).toBe('Champion')
    expect(seasonCodeToId('Y11S3')).toBe(43)
    expect(seasonIdToCode(43)).toBe('Y11S3')
  })
})

import { sessionFromBody, sessionFromHeaders } from '../src/main/ubi/websession'
import { UBI } from '../src/main/ubi/client'

const WEB = '314d4fef-e568-454a-ae06-43e3bece12a6'
const appIdOf = (c: Call) => (c.init?.headers as Record<string, string>)['Ubi-AppId']

describe('ubisoft web sign-in', () => {
  it('parses captured sessions from bodies and headers', () => {
    expect(sessionFromBody(JSON.stringify({ ticket: 't', rememberMeTicket: 'rm' }), WEB)).toEqual({ ticket: 't', appId: WEB, rememberMeTicket: 'rm' })
    expect(sessionFromBody('{"error":1}', WEB)).toBeNull()
    expect(sessionFromBody('not json', WEB)).toBeNull()
    expect(sessionFromHeaders({ Authorization: 'Ubi_v1 t=abc', 'Ubi-AppId': WEB })).toEqual({ ticket: 'abc', appId: WEB })
    expect(sessionFromHeaders({ authorization: 'Basic x', 'ubi-appid': WEB })).toBeNull()
  })

  it('exchanges a web ticket for our own session and refreshes via the web remember-me', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/sessions') ? { body: session(auth(c).startsWith('rm_v1') ? 'webFresh' : 'own' + Math.random(), { rememberMeTicket: auth(c).startsWith('rm_v1') ? 'rm2' : undefined }) } : { body: { profiles: [] } }))
    let now = NOW
    let saved: StoredAuth = {}
    const c = new UbiClient({ fetch: m.f, now: () => now, loadAuth: () => saved, saveAuth: (a) => { saved = a }, loadCredentials: () => null })
    await c.adoptWebSession({ ticket: 'webT', appId: WEB, rememberMeTicket: 'rm1' })
    expect(auth(m.calls[0]!)).toBe('Ubi_v1 t=webT')
    expect(appIdOf(m.calls[0]!)).toBe(UBI.appId)
    expect(saved.method).toBe('web')
    expect(saved.remember).toEqual({ ticket: 'rm1', appId: WEB })
    expect(c.canAuth).toBe(true)
    now += 4 * 3600_000 // session expired
    m.calls.length = 0
    await c.profilesByIds([P1])
    expect(auth(m.calls[0]!)).toBe('rm_v1 t=rm1')
    expect(appIdOf(m.calls[0]!)).toBe(WEB) // remember-me belongs to the web app id
    expect(auth(m.calls[1]!)).toBe('Ubi_v1 t=webFresh') // exchanged again
    expect(saved.remember?.ticket).toBe('rm2')
  })

  it('falls back to silent re-login when remember-me is gone', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/sessions') ? { body: session('own') } : { body: { profiles: [] } }))
    let saved: StoredAuth = { method: 'web', base: { ...session('old'), expiration: later(-1) } }
    let reauths = 0
    const c = new UbiClient({ fetch: m.f, now: () => NOW, loadAuth: () => saved, saveAuth: (a) => { saved = a }, loadCredentials: () => null, reauth: async () => { reauths++; return { ticket: 'silent', appId: WEB } } })
    await c.profilesByIds([P1])
    expect(reauths).toBe(1)
    expect(auth(m.calls[0]!)).toBe('Ubi_v1 t=silent')
  })

  it('migrates v0.1.0 storage (remember-me on the base session)', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/sessions') ? { body: session('new') } : { body: { profiles: [] } }))
    const { c } = client(m.f, { base: { ...session('old', { rememberMeTicket: 'legacy' }), expiration: later(-1) } }, false)
    await c.profilesByIds([P1])
    expect(auth(m.calls[0]!)).toBe('rm_v1 t=legacy')
  })
})

describe('web sign-in fallback', () => {
  it('keeps the web session (and its app id) if Ubisoft refuses the exchange', async () => {
    const m = mockFetch((c) => (c.url.endsWith('/sessions') ? { status: 401, body: { message: 'nope' } } : { body: { profiles: [{ profileId: P1, nameOnPlatform: 'Me' }] } }))
    let saved: StoredAuth = {}
    const c = new UbiClient({ fetch: m.f, now: () => NOW, loadAuth: () => saved, saveAuth: (a) => { saved = a }, loadCredentials: () => null })
    await c.adoptWebSession({ ticket: 'webT', appId: WEB })
    expect(c.loggedIn).toBe(true)
    expect((await c.profilesByIds([P1]))[0]?.name).toBe('Me')
    const get = m.calls.find((x) => x.url.includes('/v3/profiles?'))!
    expect(auth(get)).toBe('Ubi_v1 t=webT')
    expect(appIdOf(get)).toBe(WEB)
  })
})
