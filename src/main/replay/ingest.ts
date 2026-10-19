import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../db'
import { parseRound, type ReplayRound } from './parser'
import { normalizeRound } from './normalize'
import { sideOfOperator } from '../../shared/catalog'
import type { RoundRecord } from '../../shared/types'

export const parseFile = (path: string, headerOnly = false): ReplayRound =>
  parseRound(readFileSync(path), { sideOf: sideOfOperator, headerOnly })

/** Parses and stores one round file. Skips files already ingested at the same mtime. */
export function ingestFile(db: Db, path: string, force = false): RoundRecord | null {
  const mtime = Math.floor(statSync(path).mtimeMs)
  const prev = db.fileStatus(path)
  if (!force && prev && prev.mtime_ms === mtime) return null
  try {
    const rec = normalizeRound(parseFile(path))
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

/** Ingests every Match-* folder under a MatchReplay root. Returns number of new rounds stored. */
export function ingestReplayRoot(db: Db, root: string): number {
  let n = 0
  let dirs: string[] = []
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(root, d.name)) } catch { return 0 }
  for (const dir of dirs) for (const f of listRoundFiles(dir)) if (ingestFile(db, f)) n++
  return n
}
