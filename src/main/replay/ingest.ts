import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db'
import { parseRound, type ReplayRound } from './parser'
import { normalizeRound } from './normalize'
import { applyCatalogOverrides, operatorById, sideOfOperator, type CatalogOverrides } from '../../shared/catalog'
import { RECRUIT_ID } from '../../shared/data/operators'
import type { RoundRecord } from '../../shared/types'

export const parseFile = (path: string, headerOnly = false): ReplayRound =>
  parseRound(readFileSync(path), { sideOf: sideOfOperator, headerOnly })

/** Parses and stores one round file. Skips files already ingested at the same mtime. */
export function ingestFile(db: Db, path: string, force = false): RoundRecord | null {
  const mtime = Math.floor(statSync(path).mtimeMs)
  const prev = db.fileStatus(path)
  if (!force && prev && prev.mtime_ms === mtime) return null
  try {
    const parsed = parseFile(path)
    if (learnOperators(db, parsed)) Object.assign(parsed, parseFile(path)) // re-derive sides with new knowledge
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

/** Applies previously learned operators at startup. */
export const applyLearned = (db: Db): void => applyCatalogOverrides({ operators: db.getJson<Learned>('learnedOperators') ?? [] })
