// Research crawler: pro-play operator bans per map from Liquipedia match pages (official API,
// identified User-Agent, action=parse limited to one request per 30 s per Liquipedia's API terms).
//
//   node scripts/research/liquipedia.mjs [page ...]   → research/cache/liquipedia.json
//
// Default pages = the latest pro events; update the list each season (see docs/META-RESEARCH.md).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

const UA = 'RainbwStats-research/1.0 (https://github.com/GLr-P/RainbwStats; contact via GitHub issues)'
const OUT = 'research/cache'
const PARSE_DELAY_MS = 31_000
const DEFAULT_PAGES = [
  'Europe_MENA_League/2026/Stage_2', 'Europe_MENA_League/2026/Stage_2/Group_Stage',
  'North_America_League/2026/Stage_2', 'North_America_League/2026/Stage_2/Group_Stage',
  'South_America_League/2026/Stage_2', 'South_America_League/2026/Stage_2/Group_Stage',
  'Asia_Pacific_League/2026/Stage_2/APAC_North/Group_Stage', 'Asia_Pacific_League/2026/Stage_2/Asia/Group_Stage',
  'Asia_Pacific_League/2026/Stage_2/Oceania/Group_Stage',
  'BLAST_Major/2026/May', 'BLAST_Major/2026/May/Phase_2'
]
const MAPS = ['Bank', 'Border', 'Chalet', 'Clubhouse', 'Coastline', 'Consulate', 'Kafe Dostoyevsky', 'Kanal', 'Oregon', 'Outback',
  'Skyscraper', 'Theme Park', 'Villa', 'Lair', 'Nighthaven Labs', 'Emerald Plains', 'Fortress', 'Calypso Casino', 'Casino', 'Presidential Plane']

mkdirSync(`${OUT}/liquipedia`, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PAGES

async function parsePage(page) {
  const file = `${OUT}/liquipedia/${page.replace(/[^a-z0-9]+/gi, '_')}.json`
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const url = `https://liquipedia.net/rainbowsix/api.php?action=parse&page=${encodeURIComponent(page)}&format=json&prop=text`
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } })
  const json = await res.json()
  writeFileSync(file, JSON.stringify(json))
  await sleep(PARSE_DELAY_MS)
  return json
}

const games = []
for (const page of pages) {
  const json = await parsePage(page)
  if (json.error) { console.log(`skip ${page}: ${json.error.info}`); continue }
  const html = json.parse.text['*']
  const bodies = html.split('brkts-popup-body"').slice(1)
  for (const body of bodies) {
    // Tokenize: map links, operator icons, and the Bans / Game markers, in document order.
    const tokens = [...body.matchAll(/<a [^>]*title="([^"]+)"[^>]*>|<img[^>]*?alt="([^"]*)"[^>]*>|(Bans)\s*<|(Game)&#160;(\d+)/g)]
    let map = null, inBans = false, bans = []
    const flush = () => { if (map && bans.length) games.push({ page, map, bans }); bans = []; inBans = false }
    for (const t of tokens) {
      if (t[1] && MAPS.includes(t[1]) && !inBans) map = t[1]
      else if (t[3]) inBans = true
      else if (t[4]) flush()
      else if (inBans && t[2]) bans.push(t[2])
      else if (inBans && t[1] && !t[2] && !MAPS.includes(t[1]) && /^[A-Z][\w ’'ÄäÖöÜüÃãÓó.-]+$/.test(t[1])) { /* operator link text precedes icon; icon carries the name */ }
    }
    flush()
  }
  console.log(`${page}: ${games.filter((g) => g.page === page).length} games with bans`)
}
writeFileSync(`${OUT}/liquipedia.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), pages, games }, null, 1))
console.log(`saved ${games.length} games → ${OUT}/liquipedia.json`)
