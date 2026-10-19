// Research crawler: collects site-tagged strat lineups (map, side, site, operators, dates, sources)
// from siegestrats.com's public strat pages (robots.txt allows everything except /api/).
// Polite: one request at a time with a delay, identifies itself, caches pages locally.
//
//   node scripts/research/siegestrats.mjs            → research/cache/siegestrats.json
//
// Only facts are kept (no strat text). Rerun each patch; see docs/META-RESEARCH.md.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

const UA = 'RainbwStats-research/1.0 (+https://github.com/GLr-P/RainbwStats)'
const OUT = 'research/cache'
const DELAY_MS = 700
mkdirSync(`${OUT}/pages`, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url) {
  const file = `${OUT}/pages/${url.replace(/[^a-z0-9]+/gi, '_').slice(-150)}.html`
  if (existsSync(file) && !process.argv.includes('--refresh')) return readFileSync(file, 'utf8')
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } }).catch(() => null)
    if (res?.ok) { const html = await res.text(); writeFileSync(file, html); await sleep(DELAY_MS); return html }
    await sleep(3000 * (attempt + 1))
  }
  throw new Error(`failed: ${url}`)
}

const sitemap = await get('https://siegestrats.com/sitemap.xml')
const urls = [...sitemap.matchAll(/<loc>(https:\/\/siegestrats\.com\/strats\/[^<]+)<\/loc>/g)].map((m) => m[1])
console.log(`${urls.length} strat pages`)

const strats = []
for (const [i, url] of urls.entries()) {
  const html = await get(url)
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]) } catch { return null } })
  const graph = ld.flatMap((x) => x?.['@graph'] ?? (x ? [x] : []))
  const article = graph.find((g) => g['@type'] === 'Article')
  const crumbs = graph.find((g) => g['@type'] === 'BreadcrumbList')?.itemListElement ?? []
  if (!article?.keywords) continue
  // keywords: "Map, side, Site, Op1, Op2, ..."
  const [map, side, site, ...ops] = article.keywords.split(',').map((s) => s.trim())
  strats.push({
    url, map: crumbs[1]?.name ?? map, side: side.toLowerCase(), site, ops,
    title: article.headline, published: article.datePublished, modified: article.dateModified,
    sources: (article.citation ?? []).map((c) => ({ name: c.name, author: c.author, url: c.url }))
  })
  if ((i + 1) % 25 === 0) console.log(`${i + 1}/${urls.length}`)
}
// Floors per site come from the map pages ("2F CCTV Room / Cash Room", "Basement Church / Arsenal Room").
const floors = {}
const mapUrls = [...sitemap.matchAll(/<loc>(https:\/\/siegestrats\.com\/maps\/[a-z0-9-]+)<\/loc>/g)].map((m) => m[1])
for (const url of mapUrls) {
  const html = await get(url)
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]) } catch { return null } })
  const crumbs = ld.flatMap((x) => x?.['@graph'] ?? (x ? [x] : [])).find((g) => g['@type'] === 'BreadcrumbList')?.itemListElement ?? []
  const mapName = crumbs[1]?.name
  if (!mapName) continue
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const sites = new Set(strats.filter((s) => s.map === mapName).map((s) => s.site))
  for (const site of sites) {
    const esc = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`(Basement|B|1F|2F|3F|4F)\\s+${esc}`).exec(text)
    if (m) (floors[mapName] ??= {})[site] = m[1] === 'Basement' ? 'B' : m[1]
  }
}
writeFileSync(`${OUT}/siegestrats.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), strats, floors }, null, 1))
console.log(`saved ${strats.length} strats → ${OUT}/siegestrats.json`)
