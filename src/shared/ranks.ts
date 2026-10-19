// Ranked 2.0/3.0 rank ids (index = rank id from full_profiles). Overridable by the remote dataset.
const TIERS = ['Copper', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond'] as const
export const RANK_NAMES: string[] = ['Unranked', ...TIERS.flatMap((t) => [5, 4, 3, 2, 1].map((d) => `${t} ${d}`)), 'Champion', 'Legend']

export const TIER_COLORS: Record<string, string> = {
  Unranked: '#7d8590', Copper: '#b4553c', Bronze: '#b98a52', Silver: '#aeb6bf', Gold: '#e3b341',
  Platinum: '#4fc1c9', Emerald: '#3fbf7f', Diamond: '#b48cff', Champion: '#ff4f6d', Legend: '#ffd166'
}

export const rankName = (id: number): string => RANK_NAMES[id] ?? `Rank ${id}`
export const rankTier = (id: number): string => rankName(id).split(' ')[0]!
export const rankColor = (id: number): string => TIER_COLORS[rankTier(id)] ?? '#7d8590'

/** Season number ↔ code: Y11S3 = 43. */
export const seasonIdToCode = (id: number): string => `Y${Math.floor((id - 1) / 4) + 1}S${((id - 1) % 4) + 1}`
export const seasonCodeToId = (code: string): number => {
  const m = /^Y(\d+)S(\d+)$/.exec(code)
  return m ? (Number(m[1]) - 1) * 4 + Number(m[2]) : 0
}
