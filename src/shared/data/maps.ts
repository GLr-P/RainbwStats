// Map seed data keyed by Dissect world ID. Several IDs can share one display name (reworks).
// Sites are learned from replays at runtime; seed sites only give names before any data exists.

export interface MapInfo {
  key: string
  name: string
  ids: string[]
}

// key | display name | world ids
const RAW = `
bank|Bank|355496559878,413779563590
border|Border|305979357167,407987100456
chalet|Chalet|259816839773,407558616688
clubhouse|Clubhouse|837214085,407193663917
coastline|Coastline|42090092951
consulate|Consulate|379218689149,2609221242,418126004176
emerald|Emerald Plains|365284490964
favela|Favela|329867321446
fortress|Fortress|126196841359
hereford|Hereford Base|127951053400
house|House|237873412352
kafe|Kafe Dostoyevsky|1378191338,413845419788
kanal|Kanal|1460220617
lair|Lair|388073319671,417890697769
nighthaven|Nighthaven Labs|378595635123,418119057546
oregon|Oregon|231702797556
outback|Outback|362605108559
plane|Presidential Plane|2609218856,439976373310
skyscraper|Skyscraper|276279025182
stadium|Stadium Bravo|270063334510,405306299908
themepark|Theme Park|199824623654
tower|Tower|53627213396
university|Bartlett University|2697268122
villa|Villa|88107330328
yacht|Yacht|1767965020
casino|Calypso Casino|
`

export const MAPS: MapInfo[] = RAW.trim().split('\n').map((line) => {
  const [key, name, ids] = line.split('|') as [string, string, string]
  return { key, name, ids: ids ? ids.split(',') : [] }
})

/** Approximate bomb-site names per map, used only until real names are learned from replays
 *  (simulator, site breakdown on maps you have no replays for). Format matches replay site strings. */
export const SEED_SITES: Record<string, string[]> = {
  bank: ['2F Executive Lounge, 2F CEO Office', '1F Staff Room, 1F Open Area', '1F Teller\'s Office, 1F Archives', 'B Lockers, B CCTV Room'],
  border: ['2F Armory Lockers, 2F Archives', '1F Ventilation Room, 1F Workshop', '1F Customs Inspection, 1F Supply Room', '1F Bathroom, 1F Tellers'],
  chalet: ['2F Master Bedroom, 2F Office', '1F Bar, 1F Gaming Room', '1F Dining Room, 1F Kitchen', 'B Wine Cellar, B Snowmobile Garage'],
  clubhouse: ['2F Gym, 2F Bedroom', '2F CCTV Room, 2F Cash Room', '1F Bar, 1F Stock Room', 'B Church, B Arsenal Room'],
  coastline: ['2F Hookah Lounge, 2F Billiards Room', '2F Penthouse, 2F Theater', '1F Service Entrance, 1F Kitchen', '1F Blue Bar, 1F Sunrise Bar'],
  consulate: ['2F Consul Office, 2F Meeting Room', '1F Lobby, 1F Press Room', 'B Archives, B Tellers', 'B Cafeteria, B Garage'],
  kafe: ['3F Bar, 3F Cocktail Lounge', '2F Fireplace Hall, 2F Mining Room', '2F Reading Room, 2F Fireplace Hall', '1F Kitchen Cooking, 1F Kitchen Service'],
  kanal: ['2F Security Room, 2F Map Room', '1F Kitchen, 1F Projector Room', '1F Coast Guard Meeting Room, 1F Lounge', 'B Supply Room, B Kayaks'],
  oregon: ['2F Kids Dorms, 2F Dorms Main Hall', '1F Kitchen, 1F Dining Hall', '1F Meeting Hall, 1F Kitchen', 'B Laundry Room, B Supply Room'],
  outback: ['2F Laundry Room, 2F Games Room', '2F Party Room, 2F Office', '1F Nature Room, 1F Bushranger Room', '1F Compressor Room, 1F Gear Store'],
  skyscraper: ['2F Karaoke, 2F Tea Room', '2F Exhibition Room, 2F Office', '1F BBQ, 1F Kitchen', '1F Bedroom, 1F Bathroom'],
  themepark: ['2F Initiation Room, 2F Office', '2F Day Care, 2F Cafe', '1F Armory, 1F Throne Room', '1F Lab, 1F Storage'],
  villa: ['2F Aviator Room, 2F Games Room', '2F Trophy Room, 2F Statuary Room', '1F Living Room, 1F Library', '1F Dining Room, 1F Kitchen'],
  lair: ['2F Master Office, 2F R6 Room', '1F Bunks, 1F Briefing', '1F Armory, 1F Lab Support', 'B Lab, B Weapon Maintenance'],
  nighthaven: ['2F Command Center, 2F Server Room', '1F Kitchen, 1F Cafeteria', '1F Storage, 1F Assembly', 'B Tank, B Assembly'],
  emerald: ['2F CEO Office, 2F Administration', '2F Gallery, 2F Meeting', '1F Bar, 1F Lounge', '1F Kitchen, 1F Dining'],
  plane: ['2F Meeting Room, 2F Executive Office', '2F Staff Section, 2F Executive Bedroom', '1F Cargo Hold, 1F Luggage Hold']
}

/** OCR / display vocabulary for map names (uppercase as shown in game). */
export const MAP_NAMES = MAPS.map((m) => m.name)
