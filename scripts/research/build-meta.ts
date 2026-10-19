// Builds src/shared/data/meta.json (bundled) and site/data/meta/latest.json (downloaded by the app)
// from research/cache (siegestrats.json, liquipedia.json) and research/manual (ranked.json, patch.json).
//   npx tsx scripts/research/build-meta.ts
// See docs/META-RESEARCH.md for the full procedure and the tier rules.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { operatorByKey } from '../../src/shared/catalog'
import type { MetaData, MetaSite } from '../../src/shared/data/meta'

const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const patch = read<{ season: string; patch: string; date: string; rankedPool: string[]; proPool: string[]; notes: string[]; sources: string[] }>('research/manual/patch.json')
const ranked = read<{ source: string; scope: string; bans: Record<'attack' | 'defense', Record<string, number>>; winDelta: Record<'attack' | 'defense', Record<string, number>> }>('research/manual/ranked.json')
const ss = read<{ fetchedAt: string; strats: { map: string; side: string; site: string; ops: string[]; modified?: string; url: string }[]; floors: Record<string, Record<string, string>> }>('research/cache/siegestrats.json')
const lp = existsSync('research/cache/liquipedia.json') ? read<{ fetchedAt: string; pages: string[]; games: { map: string; bans: string[] }[] }>('research/cache/liquipedia.json') : null

const MAP_KEYS: Record<string, string> = {
  Bank: 'bank', Border: 'border', Chalet: 'chalet', Clubhouse: 'clubhouse', Coastline: 'coastline', Consulate: 'consulate',
  'Kafe Dostoyevsky': 'kafe', Kanal: 'kanal', Oregon: 'oregon', Outback: 'outback', Skyscraper: 'skyscraper', 'Theme Park': 'themepark',
  Villa: 'villa', Lair: 'lair', 'Nighthaven Labs': 'nighthaven', 'Emerald Plains': 'emerald', Fortress: 'fortress',
  'Calypso Casino': 'casino', Casino: 'casino', 'Presidential Plane': 'plane'
}
const NAME_FIX: Record<string, string> = { solosnake: 'solidsnake', snake: 'solidsnake' }
const opKey = (name: string) => { const k = name.toLowerCase().replace(/ø/g, 'o').normalize('NFKD').replace(/[^a-z0-9]/g, ''); return NAME_FIX[k] ?? k }
const problems: string[] = []
const known = (k: string, side: 'attack' | 'defense', where: string) => {
  const op = operatorByKey(k)
  if (!op) { problems.push(`unknown operator "${k}" (${where})`); return false }
  if (op.side !== side) { problems.push(`${k} listed on ${side} (${where})`); return false }
  return true
}

/** "Church / Arsenal Room" + floor "B" → "B Church, B Arsenal Room" (replay format). */
const replayName = (site: string, floor: string) => site.split('/').map((h) => h.trim()).map((h) => (/^(B|\dF)\s/.test(h) ? h : `${floor} ${h}`)).join(', ')

const S_SHARE = 0.45, A_SHARE = 0.2, MIN_LINEUPS = 2, PRO_STRONG = 0.25
const now = Date.parse(ss.fetchedAt)
const maps: MetaData['maps'] = {}

// Site tiers from lineups.
const groups = new Map<string, typeof ss.strats>()
for (const s of ss.strats) {
  const key = MAP_KEYS[s.map]
  if (!key) { problems.push(`unknown map ${s.map}`); continue }
  if (!patch.rankedPool.includes(key)) continue // only the current ranked pool matters
  const g = `${key}|${s.site}`
  groups.set(g, [...(groups.get(g) ?? []), s])
}
for (const [g, strats] of groups) {
  const [mapKey, site] = g.split('|') as [string, string]
  const mapName = strats[0]!.map
  const floor = ss.floors[mapName]?.[site] ?? '1F'
  const entry: MetaSite = { name: replayName(site, floor), kind: floor === 'B' ? 'basement' : floor === '1F' ? 'ground' : 'upper', evidence: { attack: 0, defense: 0 }, attack: { S: [], A: [] }, defense: { S: [], A: [] } }
  for (const side of ['attack', 'defense'] as const) {
    const lineups = strats.filter((s) => s.side === side)
    entry.evidence[side] = lineups.length
    if (lineups.length < MIN_LINEUPS) continue
    const votes = new Map<string, number>()
    let total = 0
    for (const s of lineups) {
      const w = s.modified && now - Date.parse(s.modified) < 183 * 86_400_000 ? 1 : 0.5
      total += w
      for (const name of s.ops) { const k = opKey(name); if (known(k, side, `${mapName} / ${site}`)) votes.set(k, (votes.get(k) ?? 0) + w) }
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1])
    // A tier needs at least two lineups agreeing; S needs three and a big share.
    entry[side].S = ranked.filter(([, v]) => v >= 3 && v / total >= S_SHARE).map(([k]) => k)
    entry[side].A = ranked.filter(([k, v]) => v >= 2 && v / total >= A_SHARE && !entry[side].S.includes(k)).map(([k]) => k)
  }
  ;(maps[mapKey] ??= { sites: [], strong: { attack: [], defense: [] }, proBans: { games: 0, rates: {} } }).sites.push(entry)
}

// Manual expert overrides (research/manual/overrides.json) are added on top and recorded.
const overrides = existsSync('research/manual/overrides.json') ? read<{ sites: Record<string, Record<string, Record<string, unknown>>> }>('research/manual/overrides.json') : { sites: {} }
for (const [mapKey, sites] of Object.entries(overrides.sites)) for (const [name, sides] of Object.entries(sites)) {
  const entry = maps[mapKey]?.sites.find((x) => x.name === name)
  if (!entry) { problems.push(`override for unknown site ${mapKey}/${name}`); continue }
  for (const side of ['attack', 'defense'] as const) {
    const add = sides[side] as { S?: string[]; A?: string[] } | undefined
    for (const t of ['S', 'A'] as const) for (const k of add?.[t] ?? []) if (known(k, side, `override ${name}`) && !entry[side][t].includes(k)) entry[side][t].push(k)
    if (add) entry.evidence[side] = Math.max(entry.evidence[side], 2)
  }
}

// Map-level: pro bans per map + operators common across the map's lineups.
if (lp) {
  const perMap = new Map<string, { games: number; counts: Map<string, number> }>()
  for (const game of lp.games) {
    const key = MAP_KEYS[game.map]
    if (!key || !patch.rankedPool.includes(key)) continue
    const m = perMap.get(key) ?? { games: 0, counts: new Map() }
    m.games++
    for (const b of new Set(game.bans.map(opKey))) if (operatorByKey(b)) m.counts.set(b, (m.counts.get(b) ?? 0) + 1)
    perMap.set(key, m)
  }
  for (const [key, m] of perMap) {
    const entry = (maps[key] ??= { sites: [], strong: { attack: [], defense: [] }, proBans: { games: 0, rates: {} } })
    entry.proBans.games = m.games
    for (const [k, c] of [...m.counts].sort((a, b) => b[1] - a[1])) entry.proBans.rates[k] = Math.round((c / m.games) * 1000) / 1000
  }
}
for (const [key, entry] of Object.entries(maps)) {
  for (const side of ['attack', 'defense'] as const) {
    const lineups = ss.strats.filter((s) => MAP_KEYS[s.map] === key && s.side === side)
    const counts = new Map<string, number>()
    for (const s of lineups) for (const n of s.ops) { const k = opKey(n); if (operatorByKey(k)?.side === side) counts.set(k, (counts.get(k) ?? 0) + 1) }
    const common = [...counts].filter(([, c]) => lineups.length >= 4 && c / lineups.length >= 0.3).map(([k]) => k)
    const proStrong = Object.entries(entry.proBans.rates).filter(([k, r]) => r >= PRO_STRONG && entry.proBans.games >= 8 && operatorByKey(k)?.side === side).map(([k]) => k)
    entry.strong[side] = [...new Set([...proStrong, ...common])]
  }
}

const meta: MetaData = {
  version: `${patch.date.replace(/-/g, '.')}-${patch.patch}`,
  season: patch.season, patch: patch.patch, generatedAt: new Date().toISOString(),
  rankedPool: patch.rankedPool, notes: patch.notes,
  ranked: { scope: ranked.scope, bans: ranked.bans, winDelta: ranked.winDelta },
  maps,
  sources: [
    { name: 'siegestrats.com site lineups', detail: `${ss.strats.length} lineups, fetched ${ss.fetchedAt.slice(0, 10)}`, url: 'https://siegestrats.com/strats' },
    ...(lp ? [{ name: 'Liquipedia pro matches (operator bans per map)', detail: `${lp.games.length} games: ${lp.pages.join(', ')}`, url: 'https://liquipedia.net/rainbowsix/' }] : []),
    { name: `Ubisoft Designer's Notes (${ranked.scope})`, detail: 'ban rates + win delta', url: ranked.source },
    ...patch.sources.map((url) => ({ name: 'Patch notes', detail: patch.patch, url }))
  ]
}

writeFileSync('src/shared/data/meta.json', JSON.stringify(meta, null, 1) + '\n')

// Coverage report.
console.log(`meta ${meta.version}: ${Object.keys(maps).length} maps`)
for (const key of patch.rankedPool) {
  const m = maps[key]
  if (!m) { console.log(`  ${key.padEnd(10)} NO DATA → curated fallback`); continue }
  const thin = m.sites.filter((s) => s.evidence.attack < MIN_LINEUPS || s.evidence.defense < MIN_LINEUPS).map((s) => `${s.name} (${s.evidence.attack}a/${s.evidence.defense}d)`)
  console.log(`  ${key.padEnd(10)} ${m.sites.length} sites, pro games ${m.proBans.games}, strong atk [${m.strong.attack.join(' ')}] def [${m.strong.defense.join(' ')}]${thin.length ? `\n             thin: ${thin.join('; ')}` : ''}`)
}
if (problems.length) console.log(`\nproblems (${problems.length}):\n  ${[...new Set(problems)].join('\n  ')}`)
