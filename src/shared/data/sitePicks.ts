// Curated map/site specialists (baseline knowledge, Y11S3). Gives recommendations a map- and
// site-specific signal before you have replay data there. Replaceable via the remote dataset.
// Format: a map key line, then "map | attackers | defenders" and "<site> | attackers | defenders".
// Operator keys are lowercase names without spaces/accents. Site names match SEED_SITES / replays.

const RAW = `
bank
map | thermite hibana ace thatcher dokkaebi | mira kaid valkyrie echo bandit
2F Executive Lounge, 2F CEO Office | buck sledge thermite | castle bandit kaid
1F Staff Room, 1F Open Area | ace hibana twitch | maestro mira goyo
1F Teller's Office, 1F Archives | thermite ace zofia | kaid smoke melusi
B Lockers, B CCTV Room | thatcher thermite hibana | echo mira smoke
border
map | ace thermite hibana buck iana | mira kaid valkyrie azami mute
2F Armory Lockers, 2F Archives | buck sledge ace | castle bandit kaid
1F Ventilation Room, 1F Workshop | hibana zofia ace | maestro mira melusi
1F Customs Inspection, 1F Supply Room | thermite iana ace | goyo kaid azami
1F Bathroom, 1F Tellers | thermite twitch sledge | mira melusi lesion
chalet
map | thermite ace buck sledge iana | mira kaid valkyrie echo vigil
2F Master Bedroom, 2F Office | buck sledge flores | castle goyo bandit
1F Bar, 1F Gaming Room | ace thermite zero | melusi mira kaid
1F Dining Room, 1F Kitchen | buck sledge thatcher | smoke goyo tachanka
B Wine Cellar, B Snowmobile Garage | thermite thatcher ace | echo smoke kaid
clubhouse
map | ace thermite hibana thatcher zero | mira kaid azami smoke caveira
2F Gym, 2F Bedroom | thermite hibana buck | castle azami kaid
2F CCTV Room, 2F Cash Room | ace twitch hibana | mute maestro mira
1F Bar, 1F Stock Room | hibana ace sledge | mira kaid goyo
B Church, B Arsenal Room | thatcher thermite ace | echo smoke frost
coastline
map | ace hibana buck sledge zero | mira kaid valkyrie melusi oryx
2F Hookah Lounge, 2F Billiards Room | ace hibana buck | melusi mira kaid
2F Penthouse, 2F Theater | buck sledge flores | castle goyo bandit
1F Service Entrance, 1F Kitchen | thermite iana zofia | smoke tachanka kaid
1F Blue Bar, 1F Sunrise Bar | ace hibana twitch | mira melusi maestro
consulate
map | thermite ace hibana thatcher iana | mira kaid echo valkyrie vigil
2F Consul Office, 2F Meeting Room | buck thermite hibana | castle bandit kaid
1F Lobby, 1F Press Room | ace zero twitch | melusi mira maestro
B Archives, B Tellers | thermite sledge hibana | echo kaid mira
B Cafeteria, B Garage | thatcher ace thermite | echo smoke goyo
kafe
map | thermite ace buck sledge hibana | mira kaid valkyrie echo jager
3F Bar, 3F Cocktail Lounge | thermite hibana buck | castle smoke bandit
2F Fireplace Hall, 2F Mining Room | ace sledge twitch | maestro mira kaid
2F Reading Room, 2F Fireplace Hall | ace hibana buck | melusi mira aruni
1F Kitchen Cooking, 1F Kitchen Service | buck sledge thermite | goyo smoke tachanka
kanal
map | thermite ace buck iana ying | mira kaid maestro valkyrie jager
2F Security Room, 2F Map Room | buck thermite hibana | castle bandit kaid
1F Kitchen, 1F Projector Room | ace iana zero | goyo mira wamai
1F Coast Guard Meeting Room, 1F Lounge | hibana zofia ace | smoke melusi kaid
B Supply Room, B Kayaks | thatcher thermite ace | echo smoke frost
oregon
map | thermite ace buck sledge iana | mira kaid echo goyo vigil
2F Kids Dorms, 2F Dorms Main Hall | buck sledge flores | castle bandit goyo
1F Kitchen, 1F Dining Hall | ace zero buck | smoke tachanka mira
1F Meeting Hall, 1F Kitchen | thermite hibana ace | melusi kaid mira
B Laundry Room, B Supply Room | thatcher thermite ace | echo goyo frost
outback
map | ace buck sledge thermite iana | mira kaid melusi smoke oryx
2F Laundry Room, 2F Games Room | buck sledge ace | castle bandit kaid
2F Party Room, 2F Office | ace thermite iana | goyo smoke mira
1F Nature Room, 1F Bushranger Room | thermite hibana buck | melusi mira aruni
1F Compressor Room, 1F Gear Store | ace sledge zofia | goyo kaid tachanka
skyscraper
map | ace hibana buck zero flores | mira kaid valkyrie melusi pulse
2F Karaoke, 2F Tea Room | ace hibana buck | melusi mira kaid
2F Exhibition Room, 2F Office | ace thermite zero | goyo mira maestro
1F BBQ, 1F Kitchen | buck sledge flores | smoke melusi tachanka
1F Bedroom, 1F Bathroom | hibana thermite buck | castle kaid bandit
themepark
map | thermite ace iana buck hibana | mira kaid melusi smoke vigil
2F Initiation Room, 2F Office | thermite hibana buck | castle bandit kaid
2F Day Care, 2F Cafe | ace thermite iana | goyo mira melusi
1F Armory, 1F Throne Room | ace hibana sledge | smoke kaid tachanka
1F Lab, 1F Storage | thermite ace buck | melusi mira echo
villa
map | thermite ace buck sledge iana | mira kaid valkyrie maestro caveira
2F Aviator Room, 2F Games Room | buck sledge thermite | castle bandit kaid
2F Trophy Room, 2F Statuary Room | ace hibana thermite | maestro mira azami
1F Living Room, 1F Library | ace hibana buck | goyo mira melusi
1F Dining Room, 1F Kitchen | thermite buck sledge | smoke melusi tachanka
lair
map | ace thermite hibana zero iana | mira kaid azami echo solis
2F Master Office, 2F R6 Room | thermite hibana buck | castle azami kaid
1F Bunks, 1F Briefing | ace zero twitch | smoke goyo mira
1F Armory, 1F Lab Support | hibana ace sledge | kaid mira melusi
B Lab, B Weapon Maintenance | thatcher thermite ace | echo smoke frost
nighthaven
map | ace hibana thermite iana brava | mira kaid azami maestro mozzie
2F Command Center, 2F Server Room | thermite hibana buck | castle kaid azami
1F Kitchen, 1F Cafeteria | ace zero twitch | goyo smoke mira
1F Storage, 1F Assembly | hibana ace sledge | melusi mira maestro
B Tank, B Assembly | thatcher thermite ace | echo smoke frost
emerald
map | ace thermite buck iana hibana | mira kaid azami melusi vigil
2F CEO Office, 2F Administration | buck thermite hibana | castle bandit azami
2F Gallery, 2F Meeting | ace hibana twitch | maestro mira melusi
1F Bar, 1F Lounge | ace sledge zofia | goyo smoke mira
1F Kitchen, 1F Dining | thermite buck sledge | melusi tachanka kaid
plane
map | buck sledge ace iana glaz | goyo smoke castle mira frost
2F Meeting Room, 2F Executive Office | buck sledge ace | castle mira goyo
2F Staff Section, 2F Executive Bedroom | buck sledge glaz | smoke goyo castle
1F Cargo Hold, 1F Luggage Hold | buck thatcher sledge | smoke echo goyo
`

export interface SidePicks { attack: string[]; defense: string[] }
export interface MapPicks { map: SidePicks; sites: Record<string, SidePicks> }

export const SITE_PICKS: Record<string, MapPicks> = (() => {
  const out: Record<string, MapPicks> = {}
  let cur: MapPicks | null = null
  for (const line of RAW.trim().split('\n')) {
    if (!line.includes('|')) { cur = { map: { attack: [], defense: [] }, sites: {} }; out[line.trim()] = cur; continue }
    const [name, atk, def] = line.split('|').map((s) => s.trim()) as [string, string, string]
    const picks = { attack: atk.split(/\s+/), defense: def.split(/\s+/) }
    if (name === 'map') cur!.map = picks
    else cur!.sites[name] = picks
  }
  return out
})()

/** Room names without floor prefixes, for matching replay-learned site names to curated ones. */
const rooms = (site: string) => site.split(',').map((h) => h.trim().replace(/^(\d+F|B\d?|RF)\s+/i, '').toLowerCase().replace(/[^a-z]/g, ''))

/** Curated picks for a site, tolerant of small naming differences between seed and replay names. */
export function sitePicksFor(mapKey: string, site: string): SidePicks | undefined {
  const m = SITE_PICKS[mapKey]
  if (!m) return undefined
  if (m.sites[site]) return m.sites[site]
  const want = rooms(site)
  let best: { picks: SidePicks; overlap: number } | undefined
  for (const [name, picks] of Object.entries(m.sites)) {
    const overlap = rooms(name).filter((r) => want.includes(r)).length
    if (overlap > (best?.overlap ?? 0)) best = { picks, overlap }
  }
  return best?.picks
}
