export type Side = 'attack' | 'defense'

/** Normalized round record stored in the DB and used by stats/recommendations. */
export interface RoundRecord {
  matchId: string
  round: number // 1-based
  playedAt: string // ISO
  gameVersion: string // e.g. "Y11S3_Alpha04"
  season: string // e.g. "Y11S3"
  matchType: number
  mapKey: string // MapInfo.key or "unknown:<id>"
  site: string
  recordingProfileId: string
  players: RoundPlayer[]
}

export interface RoundPlayer {
  profileId: string
  username: string
  teamIndex: 0 | 1
  side: Side | null
  operatorId: string
  won: boolean
  kills: number
  died: boolean
  headshots: number
}

/** Aggregate of rounds for some (operator × scope) bucket. */
export interface Agg {
  rounds: number
  wins: number
  kills: number
  deaths: number
  headshots: number
}

export const emptyAgg = (): Agg => ({ rounds: 0, wins: 0, kills: 0, deaths: 0, headshots: 0 })
