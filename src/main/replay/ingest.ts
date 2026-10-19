import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db'
import { parseRound, type ReplayRound } from './parser'
import { normalizeRound } from './normalize'
import { applyCatalogOverrides, mapKeyForWorldId, mapName, operatorById, operatorByKey, sideOfOperator, type CatalogOverrides } from '../../shared/catalog'
import { mapForSite } from '../../shared/data/sitePicks'
import { RECRUIT_ID } from '../../shared/data/operators'
import type { RoundRecord } from '../../shared/types'

export const parseFile = (path: string, headerOnly = false): ReplayRound =>
  parseRound(readFileSync(path), { sideOf: sideOfOperator, sideOfName: (n) => operatorByKey(n.toLowerCase().replace(/[^a-z0-9]/g, ''))?.side ?? null, headerOnly })

/** Parses and stores one round file. Skips files already ingested at the same mtime. */
export function ingestFile(db: Db, path: string, force = false): RoundRecord | null {
  const mtime = Math.floor(statSync(path).mtimeMs)
  const prev = db.fileStatus(path)
  if (!force && prev && prev.mtime_ms === mtime) return null
  try {
    const parsed = parseFile(path)
    if (learnOperators(db, parsed)) Object.assign(parsed, parseFile(path)) // re-derive sides with new knowledge
    learnMap(db, parsed.mapId, parsed.site)
    const rec = normalizeRound(parsed)
    db.saveRound(rec)
    db.markFile(path, mtime)
    return rec
  } catch (e) {
    db.markFile(path, mtime, e instanceof Error ? e.message : String(e))
    return null
  }
}

export const listRoundFiles = (matchDir: string): string[] =>
  readdirSync(matchDir).filter((f) => /\.rec$/i.test(f)).sort().map((f) => join(matchDir, f))

/** Ingests every Match-* folder under a MatchReplay root. Returns number of new rounds stored.
 *  Async and yields between files so a large first import never freezes the UI. */
export async function ingestReplayRoot(db: Db, root: string): Promise<number> {
  let n = 0
  let dirs: string[] = []
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(root, d.name)) } catch { return 0 }
  for (const dir of dirs) {
    for (const f of listRoundFiles(dir)) {
      if (ingestFile(db, f)) n++
      await new Promise((r) => setImmediate(r))
    }
  }
  return n
}

type Learned = NonNullable<CatalogOverrides['operators']>

/** Learns names of operators the catalog doesn't know (new seasons) from the replay header. */
export function learnOperators(db: Db, r: ReplayRound): boolean {
  const learned = db.getJson<Learned>('learnedOperators') ?? []
  let changed = false
  for (const p of r.players) {
    if (p.operatorId === RECRUIT_ID || operatorById(p.operatorId) || !p.roleName) continue
    const side = r.teams[p.teamIndex].role
    if (!side || learned.some((l) => l.id === p.operatorId)) continue
    const name = p.roleName.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
    learned.push({ id: p.operatorId, name, side })
    changed = true
  }
  if (changed) { db.setJson('learnedOperators', learned); applyCatalogOverrides({ operators: learned }) }
  return changed
}

type LearnedMaps = NonNullable<CatalogOverrides['maps']>

/** Map ids the catalog doesn't know (reworked maps get new ids) are learned from the site's room names. */
export function learnMap(db: Db, worldId: string, site: string): string | null {
  if (!worldId || !mapKeyForWorldId(worldId).startsWith('unknown:')) return null
  const key = mapForSite(site)
  if (!key) return null
  const learned = db.getJson<LearnedMaps>('learnedMaps') ?? []
  const entry = learned.find((m) => m.key === key)
  if (entry) entry.ids = [...new Set([...entry.ids, worldId])]
  else learned.push({ key, name: mapName(key), ids: [worldId] })
  db.setJson('learnedMaps', learned)
  applyCatalogOverrides({ maps: learned })
  // Rounds already stored with this unknown id get the real map.
  db.raw.prepare(`UPDATE rounds SET map_key = ? WHERE map_key = ?`).run(key, `unknown:${worldId}`)
  return key
}

/** Applies previously learned operators and maps at startup, and repairs rounds stored with unknown maps. */
export function applyLearned(db: Db): void {
  applyCatalogOverrides({ operators: db.getJson<Learned>('learnedOperators') ?? [], maps: db.getJson<LearnedMaps>('learnedMaps') ?? [] })
  const unknown = db.raw.prepare(`SELECT map_key k, site FROM rounds WHERE map_key LIKE 'unknown:%' AND site != '' GROUP BY map_key, site`).all() as { k: string; site: string }[]
  for (const u of unknown) if (mapKeyForWorldId(u.k.slice(8)).startsWith('unknown:')) learnMap(db, u.k.slice(8), u.site)
  else db.raw.prepare(`UPDATE rounds SET map_key = ? WHERE map_key = ?`).run(mapKeyForWorldId(u.k.slice(8)), u.k)
}
