// TypeScript port of redraskal/r6-dissect (MIT) for Siege "Dissect" .rec replay files.
// Differences from upstream: unknown operator/map IDs never throw, team roles are decided by
// majority vote of known operator sides, and the round winner comes from the score delta.
import { zstdDecompressSync } from 'node:zlib'
import type { Side } from '../../shared/types'

export interface ReplayPlayer {
  username: string
  profileId: string
  teamIndex: 0 | 1
  operatorId: string // uint64 as decimal string ("0" = none)
  roleName: string // operator name as shown in game header (often uppercase), may be empty
  spawn: string
  dissectId: string // hex, links feedback events to players
  uiId: string
}

export type FeedbackType =
  | 'kill' | 'death' | 'plantStart' | 'plantComplete' | 'disableStart' | 'disableComplete' | 'opSwap' | 'other'

export interface FeedbackEvent {
  type: FeedbackType
  time: number // seconds remaining on round clock
  username?: string
  target?: string
  headshot?: boolean
  operatorId?: string
}

export interface ReplayRound {
  gameVersion: string
  codeVersion: number
  timestamp: string // ISO
  matchId: string
  matchType: number
  gameModeId: string
  mapId: string
  site: string
  roundNumber: number // 0-based, as in file
  overtimeRoundNumber: number
  roundsPerMatch: number
  recordingProfileId: string
  playlistCategory: number
  teams: [ReplayTeam, ReplayTeam]
  players: ReplayPlayer[]
  feedback: FeedbackEvent[]
  /** Raw header props for forward-compat investigation (e.g. bans). */
  props: Record<string, string>
}

export interface ReplayTeam {
  name: string
  score: number
  startingScore: number
  won: boolean
  winCondition: 'KilledOpponents' | 'DisabledDefuser' | 'DefusedBomb' | 'Time' | 'Unknown'
  role: Side | null
}

export class ReplayParseError extends Error {}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const DISS_MAGIC = Buffer.from('diss')
const STR_SEP = Buffer.alloc(7)

// Code versions (dissect/version.go)
const Y7S4 = 7338571, Y8S1 = 7408213, Y8S2 = 7601998, Y9S1 = 8111697, Y9S1U3 = 8211379
const Y9S3 = 8506016, Y9S4 = 8673114, Y7S2 = 7040830

const P = {
  player: Buffer.from([0x22, 0x07, 0x94, 0x9b, 0xdc]),
  atkOpSwap: Buffer.from([0x22, 0xa9, 0x26, 0x0b, 0xe4]),
  spawn: Buffer.from([0xaf, 0x98, 0x99, 0xca]),
  time: Buffer.from([0x1f, 0x07, 0xef, 0xc9]),
  feedback: Buffer.from([0x59, 0x34, 0xe5, 0x8b, 0x04]),
  defuser: Buffer.from([0x22, 0xa9, 0xc8, 0x58, 0xd9]),
  sbKills: Buffer.from([0x1c, 0xd2, 0xb1, 0x9d]),
  opMarker: Buffer.from([0x40, 0xf2, 0x15, 0x04]),
  idIndicator: Buffer.from([0x33, 0xd8, 0x3d, 0x4f, 0x23]),
  idIndicatorOld: Buffer.from([0xe6, 0xf9, 0x7d, 0x86]),
  profileId: Buffer.from([0x8a, 0x50, 0x9b, 0xd0]),
  uiId: Buffer.from([0x38, 0xdf, 0xee, 0x88]),
  currentSite: Buffer.from([0xfc, 0xc6, 0xa8, 0x60, 0x01]),
  killIndicator: Buffer.from([0x22, 0xd9, 0x13, 0x3c, 0xba])
}

class EOF extends Error {}

class Cursor {
  b: Buffer
  o: number
  constructor(b: Buffer, o = 0) { this.b = b; this.o = o }
  skip(n: number): void {
    this.o += n
    if (this.o >= this.b.length) throw new EOF()
  }
  bytes(n: number): Buffer {
    this.skip(n)
    return this.b.subarray(this.o - n, this.o)
  }
  int(): number { return this.bytes(1)[0]! }
  str(): string { return this.bytes(this.int()).toString('utf8') }
  u32(): number { this.skip(1); return this.bytes(4).readUInt32LE(0) }
  u64(): bigint { this.skip(1); return this.bytes(8).readBigUInt64LE(0) }
  /** Moves past the next occurrence of pattern. Throws EOF when absent. */
  seek(pattern: Buffer): void {
    const i = this.b.indexOf(pattern, this.o)
    if (i < 0) throw new EOF()
    this.o = i + pattern.length
  }
}

/** Decompresses a .rec file: either one zstd stream, or a "dissect" header followed by zstd frames. */
export function decompress(file: Buffer): { header: Buffer; body: Buffer } {
  if (file.subarray(0, 4).equals(ZSTD_MAGIC)) {
    const all = zstdDecompressSync(file)
    return { header: all, body: all }
  }
  if (!file.subarray(0, 4).equals(DISS_MAGIC)) throw new ReplayParseError('not a dissect replay')
  // Collect frame start candidates; a magic sequence can also occur inside compressed data,
  // so when a slice fails to decode we merge it with the next one.
  const starts: number[] = []
  for (let i = file.indexOf(ZSTD_MAGIC); i >= 0; i = file.indexOf(ZSTD_MAGIC, i + 4)) starts.push(i)
  starts.push(file.length)
  const parts: Buffer[] = []
  for (let a = 0; a < starts.length - 1; ) {
    let decoded: Buffer | null = null
    let b = a + 1
    for (; b < starts.length && !decoded; b++) {
      try { decoded = zstdDecompressSync(file.subarray(starts[a], starts[b])) } catch { /* extend */ }
    }
    if (decoded) parts.push(decoded)
    a = decoded ? b - 1 : a + 1
  }
  return { header: file, body: Buffer.concat(parts) }
}

function readHeaderMagic(c: Cursor): void {
  if (c.bytes(7).toString('latin1') !== 'dissect') throw new ReplayParseError('bad header magic')
  // Skip to the end of the second run of 7 zero bytes.
  let n = 0, t = 0
  while (t !== 2) {
    const b = c.int()
    if (b === 0) { if (n !== 6) n++; else { n = 0; t++ } } else if (n > 0) n = 0
  }
}

function readHeaderString(c: Cursor): string {
  const len = c.int()
  if (!c.bytes(7).equals(STR_SEP)) throw new ReplayParseError('bad header string separator')
  return c.bytes(len).toString('utf8')
}

interface HeaderPlayer { id: string; username: string; team: number; roleName: string }

function readHeader(c: Cursor): { props: Record<string, string>; players: HeaderPlayer[] } {
  const props: Record<string, string> = {}
  const players: HeaderPlayer[] = []
  let cur: HeaderPlayer | null = null
  while (!('teamscore1' in props)) {
    const k = readHeaderString(c)
    const v = readHeaderString(c)
    if (k === 'playerid') { if (cur) players.push(cur); cur = { id: v, username: '', team: 0, roleName: '' }; continue }
    if ((k === 'playlistcategory' || k === 'id') && cur) { players.push(cur); cur = null }
    if (cur) {
      if (k === 'playername') cur.username = v
      else if (k === 'team') cur.team = Number(v)
      else if (k === 'rolename') cur.roleName = v
      else if (!['heroname', 'alliance', 'roleimage', 'roleportrait'].includes(k)) props[k] = v
    } else if (k === 'gmsetting') props['gmsetting'] = props['gmsetting'] ? `${props['gmsetting']},${v}` : v
    else props[k] = v
  }
  return { props, players }
}

const num = (v: string | undefined): number => (v === undefined || v === '' ? 0 : Number(v))

function parseTimestamp(s: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(s ?? '')
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : new Date(0).toISOString()
}

/** Side lookup used for team-role voting. Return null for unknown operators. */
export type SideLookup = (operatorId: string) => Side | null

export interface ParseOptions {
  sideOf: SideLookup
  /** Side by operator display name (e.g. "THERMITE"), used when the id is unknown. */
  sideOfName?: (name: string) => Side | null
  /** Stop after player packets (≈first third of the body). Much faster; no feedback events. */
  headerOnly?: boolean
}

interface State {
  c: Cursor
  code: number
  site: string
  players: ReplayPlayer[]
  playersRead: number
  feedback: FeedbackEvent[]
  time: number
  planted: boolean
  lastDefuserIdx: number
  lastKillerFromScoreboard: string
  recordingProfileId: string
}

function readPlayer(s: State): void {
  const { c, code } = s
  s.playersRead++
  const username = c.str()
  if (code >= Y7S4) {
    c.seek(P.opMarker)
    c.skip(8)
    if (c.int() === 0x9d) return // duplicate marker, not a role swap
  } else c.seek(P.atkOpSwap)
  const op = c.u64()
  if (op === 0n) return
  if (c.int() !== 0x22) return
  c.seek(code <= Y7S2 ? P.idIndicatorOld : P.idIndicator)
  const dissectId = c.bytes(4).toString('hex')
  c.seek(P.spawn)
  const spawn = c.str()
  if (spawn === '') {
    c.skip(10)
    if (c.int() !== 0x1b) return
  }
  let uiId = 0n
  if (code >= Y9S3) { c.seek(P.uiId); c.skip(13); uiId = c.u64() }
  let profileId = ''
  if (s.recordingProfileId) { c.seek(P.profileId); profileId = c.str() }
  const p: ReplayPlayer = {
    username, profileId, teamIndex: s.playersRead > 5 ? 1 : 0, operatorId: op.toString(),
    roleName: '', spawn, dissectId, uiId: uiId.toString()
  }
  const existing = s.players.find((e) => e.username === username || (code >= Y8S2 && e.dissectId === dissectId))
  if (existing) Object.assign(existing, { profileId, username, operatorId: p.operatorId, spawn, dissectId, uiId: p.uiId })
  else if (username) s.players.push(p)
}

function readAtkOpSwap(s: State): void {
  const { c } = s
  const op = c.u64().toString()
  if (s.code < Y9S3) {
    c.skip(5)
    const id = c.bytes(4).toString('hex')
    const p = s.players.find((x) => x.dissectId === id)
    if (p) { p.operatorId = op; s.feedback.push({ type: 'opSwap', time: s.time, username: p.username, operatorId: op }) }
    return
  }
  c.skip(402)
  const id = c.u64().toString()
  const p = s.players.find((x) => x.uiId === id)
  if (p) { p.operatorId = op; s.feedback.push({ type: 'opSwap', time: s.time, username: p.username, operatorId: op }) }
}

function readSpawn(s: State): void {
  const { c } = s
  const location = c.str()
  c.skip(150)
  const pattern = c.bytes(5)
  if (!location.includes('<br/>')) return
  if (s.site === '' || pattern.equals(P.currentSite)) s.site = location.replace('<br/>', ', ')
}

function readTime(s: State): void { s.time = s.c.u32() }

function readFeedback(s: State): void {
  const { c, code } = s
  if (code >= Y9S1U3) c.skip(38)
  else if (code >= Y9S1) { c.skip(9); if (c.int() !== 4) return; c.skip(24) }
  else return // pre-Y9 feedback layout not supported (not needed for Siege X)
  const size = c.int()
  if (size !== 0) return
  if (!c.bytes(5).equals(P.killIndicator)) return
  const username = c.str()
  c.skip(15)
  const target = c.str()
  if (!username) {
    if (target) s.feedback.push({ type: 'death', time: s.time, username: target })
    return
  }
  c.skip(56)
  const headshot = c.int() === 1
  if (s.feedback.some((f) => f.type === 'kill' && f.username === username && f.target === target)) return
  // The scoreboard kill counter is more reliable for who got the kill (vs. elimination credit).
  const killer = s.lastKillerFromScoreboard && s.lastKillerFromScoreboard !== username ? s.lastKillerFromScoreboard : username
  s.feedback.push({ type: 'kill', time: s.time, username: killer, target, headshot })
}

function readDefuser(s: State): void {
  const { c } = s
  const timer = c.str()
  c.skip(34)
  const id = c.bytes(4).toString('hex')
  const i = s.players.findIndex((p) => p.dissectId === id)
  if (i > -1) {
    s.feedback.push({ type: s.planted ? 'disableStart' : 'plantStart', time: s.time, username: s.players[i]!.username })
    s.lastDefuserIdx = i
  }
  if (!timer.startsWith('0.00')) return
  const who = s.players[s.lastDefuserIdx]?.username
  if (s.planted) s.feedback.push({ type: 'disableComplete', time: s.time, username: who })
  else { s.planted = true; s.feedback.push({ type: 'plantComplete', time: s.time, username: who }) }
}

function readScoreboardKills(s: State): void {
  const { c } = s
  c.u32()
  c.skip(30)
  const id = c.bytes(4).toString('hex')
  const p = s.players.find((x) => x.dissectId === id)
  if (p) s.lastKillerFromScoreboard = p.username
}

/** Finds every occurrence of each pattern and returns them in file order. */
function scan(b: Buffer, start: number, end: number, patterns: [Buffer, (s: State) => void][]) {
  const hits: { at: number; fn: (s: State) => void }[] = []
  for (const [pat, fn] of patterns) {
    for (let i = b.indexOf(pat, start); i >= 0 && i < end; i = b.indexOf(pat, i + 1)) hits.push({ at: i + pat.length, fn })
  }
  return hits.sort((a, b2) => a.at - b2.at)
}

export function parseRound(file: Buffer, opts: ParseOptions): ReplayRound {
  const { header, body } = decompress(file)
  const hc = new Cursor(header)
  let head: ReturnType<typeof readHeader>
  try {
    readHeaderMagic(hc)
    head = readHeader(hc)
  } catch (e) {
    throw e instanceof EOF ? new ReplayParseError('truncated header') : e
  }
  const { props } = head
  const code = num(props['code'])
  const s: State = {
    c: new Cursor(body, 0), code, site: '', players: [], playersRead: 0, feedback: [], time: 0,
    planted: false, lastDefuserIdx: -1, lastKillerFromScoreboard: '', recordingProfileId: props['recordingprofileid'] ?? ''
  }
  // Chunked files repeat the header inside the decompressed body; skip it there too.
  if (body !== header) {
    const bc = new Cursor(body)
    try { readHeaderMagic(bc); readHeader(bc); s.c.o = bc.o } catch { s.c.o = 0 }
  } else s.c.o = hc.o

  const patterns: [Buffer, (s: State) => void][] = [[P.player, readPlayer], [P.spawn, readSpawn]]
  if (!opts.headerOnly) {
    patterns.push([P.atkOpSwap, readAtkOpSwap], [P.feedback, readFeedback], [P.defuser, readDefuser], [P.sbKills, readScoreboardKills])
    if (code >= Y8S1) patterns.push([P.time, readTime])
  }
  const end = opts.headerOnly ? Math.floor(body.length / 3) : body.length
  for (const hit of scan(body, s.c.o, end, patterns)) {
    s.c.o = hit.at
    try { hit.fn(s) } catch (e) { if (!(e instanceof EOF)) throw e }
    if (opts.headerOnly && s.playersRead >= 10 && s.site) break
  }

  // Attach header role names (operator display names) by username.
  for (const p of s.players) p.roleName = head.players.find((h) => h.username === p.username)?.roleName ?? ''
  const players = s.players.filter((p) => p.operatorId !== '0')

  const teams: [ReplayTeam, ReplayTeam] = [0, 1].map((i) => ({
    name: props[`teamname${i}`] ?? '',
    score: num(props[`teamscore${i}`]),
    startingScore: code >= Y9S4 ? num(props[`startingteamscore${i}`]) : 0,
    won: false,
    winCondition: 'Unknown',
    role: null
  })) as [ReplayTeam, ReplayTeam]

  // Team roles: majority vote of known operator sides per team.
  const votes = [0, 0] // >0 = attack
  for (const p of players) {
    // Unknown id (new season / re-issued id): fall back to the operator's display name from the header.
    const side = opts.sideOf(p.operatorId) ?? (p.roleName ? opts.sideOfName?.(p.roleName) ?? null : null)
    if (side) votes[p.teamIndex]! += side === 'attack' ? 1 : -1
  }
  const net = votes[0]! - votes[1]!
  if (net !== 0) {
    teams[0].role = net > 0 ? 'attack' : 'defense'
    teams[1].role = net > 0 ? 'defense' : 'attack'
  }
  if (s.site) for (const p of players) if (teams[p.teamIndex].role === 'defense') p.spawn = s.site

  if (!opts.headerOnly) decideWinner(teams, players, s.feedback, code)

  return {
    gameVersion: props['version'] ?? '',
    codeVersion: code,
    timestamp: parseTimestamp(props['datetime']),
    matchId: props['id'] ?? '',
    matchType: num(props['matchtype']),
    gameModeId: props['gamemodeid'] ?? '',
    mapId: props['worldid'] ?? '',
    site: s.site,
    roundNumber: num(props['roundnumber']),
    overtimeRoundNumber: num(props['overtimeroundnumber']),
    roundsPerMatch: num(props['roundspermatch']),
    recordingProfileId: props['recordingprofileid'] ?? '',
    playlistCategory: num(props['playlistcategory']),
    teams,
    players,
    feedback: s.feedback,
    props
  }
}

function decideWinner(teams: [ReplayTeam, ReplayTeam], players: ReplayPlayer[], fb: FeedbackEvent[], code: number): void {
  const teamOf = (name?: string) => players.find((p) => p.username === name)?.teamIndex
  let winner: 0 | 1 | undefined
  if (code >= Y9S4) {
    const d0 = teams[0].score - teams[0].startingScore
    const d1 = teams[1].score - teams[1].startingScore
    if (d0 !== d1) winner = d0 > d1 ? 0 : 1
  }
  const defused = fb.find((f) => f.type === 'disableComplete')
  const planted = fb.find((f) => f.type === 'plantComplete')
  let condition: ReplayTeam['winCondition'] = 'Unknown'
  if (defused) { winner ??= teamOf(defused.username); condition = 'DisabledDefuser' }
  else if (planted && winner === teamOf(planted.username)) condition = 'DefusedBomb'
  if (winner === undefined || condition === 'Unknown') {
    const size = [0, 0], deaths = [0, 0]
    for (const p of players) size[p.teamIndex]!++
    for (const f of fb) {
      const t = f.type === 'kill' ? teamOf(f.target) : f.type === 'death' ? teamOf(f.username) : undefined
      if (t !== undefined) deaths[t]!++
    }
    const wiped = size.findIndex((n, i) => n > 0 && deaths[i]! >= n)
    if (wiped >= 0 && !planted) { winner ??= (wiped ^ 1) as 0 | 1; if (winner === (wiped ^ 1)) condition = 'KilledOpponents' }
    else if (winner !== undefined && !planted && teams[winner].role === 'defense') condition = 'Time'
    else if (winner === undefined && !planted) {
      const def = teams.findIndex((t) => t.role === 'defense')
      if (def >= 0) { winner = def as 0 | 1; condition = 'Time' }
    }
  }
  if (winner !== undefined) {
    teams[winner].won = true
    teams[winner].winCondition = condition
  }
}
