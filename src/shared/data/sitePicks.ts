// Curated map/site tiers (Y11S3 baseline knowledge). Gives recommendations a map- and site-specific
// signal before you have replay data there; replays and crowd data take over as they grow.
// Format: a map key line, then
//   "map | attackers | defenders"                       (generally strong on this map)
//   "<site> | S: a b / A: c d | S: e f / A: g h"         (S = site specialist, A = strong here)
// Operator keys are lowercase names without spaces/accents. Site names match SEED_SITES / replays.

const RAW = `
bank
map | thermite hibana ace thatcher | mira kaid echo valkyrie
2F Executive Lounge, 2F CEO Office | S: buck sledge thermite / A: hibana ace twitch flores | S: castle bandit mira / A: kaid tubarao goyo azami
1F Staff Room, 1F Open Area | S: ace hibana / A: twitch iana thatcher zero | S: maestro mira / A: kaid melusi valkyrie goyo
1F Teller's Office, 1F Archives | S: thermite ace / A: thatcher zofia twitch kali | S: kaid smoke / A: mira melusi aruni tubarao
B Lockers, B CCTV Room | S: thermite thatcher / A: ace hibana capitao gridlock | S: echo smoke mira / A: kaid frost goyo lesion
border
map | thermite ace hibana iana | mira kaid valkyrie azami
2F Armory Lockers, 2F Archives | S: ace buck / A: thermite sledge zofia twitch | S: castle mira / A: bandit kaid azami tubarao
1F Ventilation Room, 1F Workshop | S: hibana ace / A: zofia twitch iana kali | S: maestro mira / A: melusi kaid goyo valkyrie
1F Customs Inspection, 1F Supply Room | S: thermite iana / A: ace zero brava thatcher | S: goyo kaid / A: azami mira smoke tachanka
1F Bathroom, 1F Tellers | S: thermite twitch / A: sledge buck ace dokkaebi | S: mira melusi / A: lesion kaid aruni ela
chalet
map | thermite ace buck sledge | mira kaid valkyrie echo
2F Master Bedroom, 2F Office | S: buck sledge / A: flores thermite ace zero | S: castle goyo / A: bandit mira smoke kaid
1F Bar, 1F Gaming Room | S: ace thermite / A: zero twitch iana kali | S: melusi mira / A: kaid maestro aruni valkyrie
1F Dining Room, 1F Kitchen | S: buck sledge / A: thatcher flores capitao ace | S: smoke goyo / A: tachanka mira kaid tubarao
B Wine Cellar, B Snowmobile Garage | S: thermite thatcher / A: ace capitao gridlock hibana | S: echo smoke / A: kaid frost goyo mira
clubhouse
map | thermite ace hibana thatcher | mira kaid azami smoke
2F Gym, 2F Bedroom | S: thermite hibana / A: buck ace sledge zofia | S: castle azami / A: kaid bandit mira smoke
2F CCTV Room, 2F Cash Room | S: ace twitch / A: thatcher iana zero kali | S: tubarao mira / A: kaid maestro mute azami
1F Bar, 1F Stock Room | S: ace hibana / A: buck sledge thatcher thermite | S: mira kaid / A: goyo smoke tubarao echo
B Church, B Arsenal Room | S: thermite thatcher / A: ace capitao gridlock buck | S: echo smoke / A: goyo frost mira kaid
coastline
map | ace hibana buck zero | mira kaid valkyrie melusi
2F Hookah Lounge, 2F Billiards Room | S: ace hibana / A: buck zero twitch iana | S: melusi mira / A: kaid azami maestro valkyrie
2F Penthouse, 2F Theater | S: buck sledge / A: flores ace zero ying | S: castle goyo / A: bandit mira kaid smoke
1F Service Entrance, 1F Kitchen | S: thermite iana / A: zofia ace thatcher dokkaebi | S: smoke tachanka / A: kaid goyo mira tubarao
1F Blue Bar, 1F Sunrise Bar | S: ace hibana / A: twitch buck iana zero | S: mira melusi / A: maestro kaid valkyrie aruni
consulate
map | thermite ace hibana thatcher | mira kaid echo valkyrie
2F Consul Office, 2F Meeting Room | S: buck thermite / A: hibana sledge ace flores | S: castle bandit / A: kaid mira azami tubarao
1F Lobby, 1F Press Room | S: ace zero / A: twitch iana thermite kali | S: melusi mira / A: maestro kaid valkyrie goyo
B Archives, B Tellers | S: thermite hibana / A: sledge thatcher ace capitao | S: echo kaid / A: mira smoke frost aruni
B Cafeteria, B Garage | S: thatcher ace / A: thermite capitao gridlock nomad | S: echo smoke / A: goyo mira kaid tachanka
kafe
map | thermite ace buck hibana | mira kaid valkyrie jager
3F Bar, 3F Cocktail Lounge | S: thermite hibana / A: buck ace sledge zofia | S: castle smoke / A: bandit kaid mira goyo
2F Fireplace Hall, 2F Mining Room | S: ace sledge / A: twitch iana thermite zero | S: maestro mira / A: kaid jager azami melusi
2F Reading Room, 2F Fireplace Hall | S: ace hibana / A: buck twitch iana zero | S: melusi aruni / A: mira jager kaid valkyrie
1F Kitchen Cooking, 1F Kitchen Service | S: buck sledge / A: thermite flores capitao ace | S: goyo smoke / A: tachanka kaid mira tubarao
kanal
map | thermite ace buck iana | mira kaid maestro valkyrie
2F Security Room, 2F Map Room | S: buck thermite / A: hibana ace sledge twitch | S: castle bandit / A: kaid mira azami melusi
1F Kitchen, 1F Projector Room | S: ace iana / A: zero thermite twitch brava | S: goyo wamai / A: mira kaid smoke maestro
1F Coast Guard Meeting Room, 1F Lounge | S: hibana zofia / A: ace twitch buck thatcher | S: smoke melusi / A: kaid mira aruni valkyrie
B Supply Room, B Kayaks | S: thatcher thermite / A: ace capitao gridlock buck | S: echo smoke / A: frost goyo kaid mira
oregon
map | thermite ace buck sledge | mira kaid echo goyo
2F Kids Dorms, 2F Dorms Main Hall | S: buck sledge / A: flores thermite ace zofia | S: castle bandit / A: goyo kaid mira smoke
1F Kitchen, 1F Dining Hall | S: ace zero / A: buck iana twitch thatcher | S: smoke tachanka / A: mira goyo kaid melusi
1F Meeting Hall, 1F Kitchen | S: thermite hibana / A: ace buck zofia twitch | S: melusi kaid / A: mira smoke maestro aruni
B Laundry Room, B Supply Room | S: thatcher thermite / A: ace capitao gridlock buck | S: echo goyo / A: frost smoke kaid mira
outback
map | ace buck sledge thermite | mira kaid melusi smoke
2F Laundry Room, 2F Games Room | S: ace buck / A: sledge thermite zofia flores | S: castle bandit / A: kaid mira azami smoke
2F Party Room, 2F Office | S: ace iana / A: thermite zero twitch brava | S: goyo smoke / A: mira kaid tachanka melusi
1F Nature Room, 1F Bushranger Room | S: thermite hibana / A: buck ace twitch iana | S: melusi aruni / A: mira kaid valkyrie maestro
1F Compressor Room, 1F Gear Store | S: ace sledge / A: zofia thermite buck thatcher | S: goyo kaid / A: tachanka mira smoke tubarao
skyscraper
map | ace hibana buck zero | mira kaid valkyrie melusi
2F Karaoke, 2F Tea Room | S: ace hibana / A: buck zero twitch iana | S: melusi mira / A: kaid maestro valkyrie azami
2F Exhibition Room, 2F Office | S: ace zero / A: thermite iana twitch flores | S: goyo mira / A: maestro kaid melusi smoke
1F BBQ, 1F Kitchen | S: buck sledge / A: flores ace capitao zero | S: smoke melusi / A: tachanka goyo kaid mira
1F Bedroom, 1F Bathroom | S: hibana thermite / A: buck ace twitch zofia | S: castle kaid / A: bandit mira azami smoke
themepark
map | thermite ace iana buck | mira kaid melusi smoke
2F Initiation Room, 2F Office | S: thermite hibana / A: buck ace sledge zofia | S: castle bandit / A: kaid mira azami melusi
2F Day Care, 2F Cafe | S: ace iana / A: thermite zero twitch brava | S: goyo mira / A: melusi kaid smoke maestro
1F Armory, 1F Throne Room | S: ace hibana / A: sledge buck twitch thatcher | S: smoke kaid / A: tachanka mira goyo tubarao
1F Lab, 1F Storage | S: thermite ace / A: buck iana zero thatcher | S: melusi echo / A: mira kaid aruni valkyrie
villa
map | thermite ace buck iana | mira kaid valkyrie maestro
2F Aviator Room, 2F Games Room | S: buck sledge / A: thermite ace flores zofia | S: castle bandit / A: kaid mira azami goyo
2F Trophy Room, 2F Statuary Room | S: ace hibana / A: thermite twitch iana zero | S: maestro azami / A: mira kaid melusi valkyrie
1F Living Room, 1F Library | S: ace hibana / A: buck twitch iana thatcher | S: goyo mira / A: kaid melusi smoke maestro
1F Dining Room, 1F Kitchen | S: thermite buck / A: sledge flores ace capitao | S: smoke melusi / A: tachanka kaid mira goyo
lair
map | ace thermite hibana zero | mira kaid azami echo
2F Master Office, 2F R6 Room | S: thermite hibana / A: buck ace zofia sledge | S: castle azami / A: kaid bandit mira solis
1F Bunks, 1F Briefing | S: ace zero / A: twitch iana brava thatcher | S: smoke goyo / A: mira kaid tachanka melusi
1F Armory, 1F Lab Support | S: hibana ace / A: sledge buck thatcher iana | S: kaid mira / A: melusi aruni azami tubarao
B Lab, B Weapon Maintenance | S: thatcher thermite / A: ace capitao gridlock buck | S: echo smoke / A: frost goyo kaid mira
nighthaven
map | ace hibana thermite brava | mira kaid azami maestro
2F Command Center, 2F Server Room | S: thermite hibana / A: buck ace sledge zofia | S: castle kaid / A: azami bandit mira mute
1F Kitchen, 1F Cafeteria | S: ace zero / A: twitch iana brava thatcher | S: goyo smoke / A: mira kaid tachanka melusi
1F Storage, 1F Assembly | S: hibana ace / A: sledge zofia buck iana | S: melusi mira / A: maestro kaid aruni valkyrie
B Tank, B Assembly | S: thatcher thermite / A: ace capitao gridlock buck | S: echo smoke / A: frost goyo kaid mira
emerald
map | ace thermite buck iana | mira kaid azami melusi
2F CEO Office, 2F Administration | S: buck thermite / A: hibana ace sledge flores | S: castle bandit / A: azami kaid mira smoke
2F Gallery, 2F Meeting | S: ace hibana / A: twitch iana zero kali | S: maestro mira / A: melusi kaid valkyrie azami
1F Bar, 1F Lounge | S: ace sledge / A: zofia buck thatcher twitch | S: goyo smoke / A: mira kaid tachanka tubarao
1F Kitchen, 1F Dining | S: thermite buck / A: sledge ace flores capitao | S: melusi tachanka / A: kaid smoke goyo mira
plane
map | buck sledge ace iana | goyo smoke castle mira
2F Meeting Room, 2F Executive Office | S: buck sledge / A: ace glaz iana flores | S: castle mira / A: goyo smoke kaid tubarao
2F Staff Section, 2F Executive Bedroom | S: buck sledge / A: glaz ace zofia twitch | S: smoke goyo / A: castle mira frost tachanka
1F Cargo Hold, 1F Luggage Hold | S: buck thatcher / A: sledge ace capitao gridlock | S: smoke echo / A: goyo frost kaid mira
`

export interface TierPicks { S: string[]; A: string[] }
export interface MapPicks { map: { attack: string[]; defense: string[] }; sites: Record<string, { attack: TierPicks; defense: TierPicks }> }

function tiers(part: string): TierPicks {
  const out: TierPicks = { S: [], A: [] }
  for (const seg of part.split('/')) {
    const m = /^\s*([SA]):\s*(.+)$/.exec(seg)
    if (m) out[m[1] as 'S' | 'A'] = m[2]!.trim().split(/\s+/)
  }
  return out
}

export const SITE_PICKS: Record<string, MapPicks> = (() => {
  const out: Record<string, MapPicks> = {}
  let cur: MapPicks | null = null
  for (const line of RAW.trim().split('\n')) {
    if (!line.includes('|')) { cur = { map: { attack: [], defense: [] }, sites: {} }; out[line.trim()] = cur; continue }
    const [name, atk, def] = line.split('|').map((s) => s.trim()) as [string, string, string]
    if (name === 'map') cur!.map = { attack: atk.split(/\s+/), defense: def.split(/\s+/) }
    else cur!.sites[name] = { attack: tiers(atk), defense: tiers(def) }
  }
  return out
})()

/** Kind of site, from its floor prefix ("B …" basement, "2F/3F …" upper, else ground). */
export type SiteKind = 'basement' | 'upper' | 'ground'
export const siteKind = (site: string): SiteKind => (/^\s*B\d?\s/i.test(site) ? 'basement' : /^\s*[2-9]F\s/i.test(site) ? 'upper' : 'ground')

/** Operators that generally fit a kind of site even when not a named specialist there
 *  (e.g. Fuze clusters / Capitão plant denial for basements, vertical play for upper floors). */
export const KIND_FIT: Record<'attack' | 'defense', Record<SiteKind, string[]>> = {
  attack: {
    basement: ['fuze', 'capitao', 'gridlock', 'thatcher', 'nomad', 'ying', 'glaz', 'solidsnake'],
    upper: ['buck', 'sledge', 'zofia', 'ram', 'flores', 'blackbeard', 'ash', 'hibana'],
    ground: ['buck', 'sledge', 'zofia', 'kali', 'iq', 'ying', 'finka', 'striker', 'montagne', 'deimos']
  },
  defense: {
    basement: ['echo', 'goyo', 'smoke', 'frost', 'lesion', 'tachanka', 'kapkan', 'ela', 'denari'],
    upper: ['castle', 'bandit', 'kaid', 'melusi', 'aruni', 'thorn', 'sentry', 'fenrir', 'noor'],
    ground: ['tachanka', 'valkyrie', 'maestro', 'wamai', 'jager', 'mute', 'thunderbird', 'rook', 'doc', 'skopos']
  }
}

/** Room names without floor prefixes, for matching replay-learned site names to curated ones. */
const rooms = (site: string) => site.split(',').map((h) => h.trim().replace(/^(\d+F|B\d?|RF)\s+/i, '').toLowerCase().replace(/[^a-z]/g, ''))

/** Curated tiers for a site, tolerant of small naming differences between seed and replay names. */
export function sitePicksFor(mapKey: string, site: string): { attack: TierPicks; defense: TierPicks } | undefined {
  const m = SITE_PICKS[mapKey]
  if (!m) return undefined
  if (m.sites[site]) return m.sites[site]
  const want = rooms(site)
  let best: { picks: { attack: TierPicks; defense: TierPicks }; overlap: number } | undefined
  for (const [name, picks] of Object.entries(m.sites)) {
    const overlap = rooms(name).filter((r) => want.includes(r)).length
    if (overlap > (best?.overlap ?? 0)) best = { picks, overlap }
  }
  return best?.picks
}

// ---- Researched data first (scripts/research → meta.json), curated tiers above as fallback ----
import { meta, type MetaSite } from './meta'
import { SEED_SITES } from './maps'

/** Researched site entry matching a (replay or seed) site name. */
function metaSite(mapKey: string, site: string): MetaSite | undefined {
  const sites = meta().maps[mapKey]?.sites ?? []
  const want = rooms(site)
  let best: { s: MetaSite; overlap: number } | undefined
  for (const s of sites) {
    const overlap = rooms(s.name).filter((r) => want.includes(r)).length
    if (overlap > (best?.overlap ?? 0)) best = { s, overlap }
  }
  return best?.s
}

/** S/A tiers for a site and side: researched lineups when there are ≥2, else curated judgment. */
export function siteTiersFor(mapKey: string, site: string, side: 'attack' | 'defense'): (TierPicks & { source: 'research' | 'curated'; confidence: number }) | undefined {
  const m = metaSite(mapKey, site)
  // Confidence: 5+ lineups count fully, 2 lineups ~70%; curated judgment counts 70%.
  if (m && m.evidence[side] >= 2 && (m[side].S.length || m[side].A.length)) return { ...m[side], source: 'research', confidence: Math.min(1, 0.5 + m.evidence[side] / 10) }
  const c = sitePicksFor(mapKey, site)?.[side]
  return c ? { ...c, source: 'curated', confidence: 0.7 } : undefined
}

/** Operators strong on a map (pro must-bans + common in lineups), else the curated map list. */
export function mapStrongFor(mapKey: string, side: 'attack' | 'defense'): string[] {
  const researched = meta().maps[mapKey]?.strong[side] ?? []
  return researched.length ? researched : SITE_PICKS[mapKey]?.map[side] ?? []
}

/** Pro ban rate per operator key on a map (share of pro games). */
export const proBansFor = (mapKey: string): Record<string, number> => meta().maps[mapKey]?.proBans.rates ?? {}

export const siteKindFor = (mapKey: string, site: string): SiteKind => metaSite(mapKey, site)?.kind ?? siteKind(site)

/** Default site list for a map (researched names, else seeds). */
export function seedSitesFor(mapKey: string): string[] {
  const researched = meta().maps[mapKey]?.sites.map((s) => s.name) ?? []
  // Seed sites whose rooms the research did not cover (e.g. maps with few lineups).
  const extra = (SEED_SITES[mapKey] ?? []).filter((seed) => !researched.some((r) => rooms(r).some((x) => rooms(seed).includes(x))))
  return [...researched, ...extra]
}

/** Current ranked map pool (from researched data). Empty = unknown. */
export const rankedPool = (): string[] => meta().rankedPool

/** Maps to offer in pickers: the ranked pool when known, else every map. */
export const pickerMaps = <T extends { key: string }>(all: T[]): T[] => { const pool = rankedPool(); return pool.length ? all.filter((m) => pool.includes(m.key)) : all }

/** Which map a replay site belongs to, from its room names (for map ids the catalog doesn't know yet,
 *  e.g. reworked maps). Returns null unless one map clearly matches better than every other. */
export function mapForSite(site: string): string | null {
  const want = rooms(site).filter((r) => r.length > 2)
  if (!want.length) return null
  const keys = new Set([...Object.keys(SEED_SITES), ...Object.keys(meta().maps), ...Object.keys(SITE_PICKS)])
  const scored = [...keys].map((key) => {
    const known = new Set([...seedSitesFor(key), ...Object.keys(SITE_PICKS[key]?.sites ?? {})].flatMap(rooms))
    return { key, score: want.filter((r) => known.has(r)).length }
  }).sort((a, b) => b.score - a.score)
  const [best, second] = scored
  return best && best.score > 0 && best.score > (second?.score ?? 0) ? best.key : null
}
