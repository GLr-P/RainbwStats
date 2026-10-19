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

/** OCR / display vocabulary for map names (uppercase as shown in game). */
export const MAP_NAMES = MAPS.map((m) => m.name)
