import type { ReplayRound } from './parser'
import type { RoundPlayer, RoundRecord } from '../../shared/types'
import { mapKeyForWorldId, seasonOf } from '../../shared/catalog'

/** Converts a parsed replay round into the stored, analysis-friendly shape. */
export function normalizeRound(r: ReplayRound): RoundRecord {
  const kills = new Map<string, number>()
  const hs = new Map<string, number>()
  const dead = new Set<string>()
  for (const f of r.feedback) {
    if (f.type === 'kill' && f.username) {
      kills.set(f.username, (kills.get(f.username) ?? 0) + 1)
      if (f.headshot) hs.set(f.username, (hs.get(f.username) ?? 0) + 1)
      if (f.target) dead.add(f.target)
    } else if (f.type === 'death' && f.username) dead.add(f.username)
  }
  const players: RoundPlayer[] = r.players.map((p) => ({
    profileId: p.profileId || `name:${p.username}`,
    username: p.username,
    teamIndex: p.teamIndex,
    side: r.teams[p.teamIndex].role,
    operatorId: p.operatorId,
    won: r.teams[p.teamIndex].won,
    kills: kills.get(p.username) ?? 0,
    died: dead.has(p.username),
    headshots: hs.get(p.username) ?? 0
  }))
  return {
    matchId: r.matchId,
    round: r.roundNumber + 1,
    playedAt: r.timestamp,
    gameVersion: r.gameVersion,
    season: seasonOf(r.gameVersion),
    matchType: r.matchType,
    mapKey: mapKeyForWorldId(r.mapId),
    site: r.site,
    recordingProfileId: r.recordingProfileId,
    players
  }
}
