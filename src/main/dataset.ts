// Remote dataset (GitHub Pages) with disk cache: bundled → cached → fetched in background.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUNDLED_DATASET, type Dataset } from '../shared/data/dataset'
import { applyCatalogOverrides } from '../shared/catalog'
import { RANK_NAMES } from '../shared/ranks'
import { meta, setMeta, type MetaData } from '../shared/data/meta'

export function isDataset(v: unknown): v is Dataset {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return typeof d['version'] === 'string' && typeof d['season'] === 'string' && typeof d['baseline'] === 'object' && d['baseline'] !== null
}

export class DatasetStore {
  private current: Dataset = BUNDLED_DATASET
  private readonly file: string
  private readonly dir: string
  /** The researched meta of the previous patch (for "what changed"), once a newer one has been seen. */
  previousMeta: MetaData | null = null
  constructor(dir: string) {
    this.dir = dir
    this.file = join(dir, 'dataset.json')
    try {
      const cached: unknown = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : null
      if (isDataset(cached) && cached.version > BUNDLED_DATASET.version) this.current = cached
    } catch { /* corrupted cache → bundled */ }
    this.apply()
  }

  get(): Dataset { return this.current }

  private apply(): void {
    applyCatalogOverrides(this.current)
    setMeta(this.current.meta)
    this.trackPatch()
    if (this.current.rankNames?.length) RANK_NAMES.splice(0, RANK_NAMES.length, ...this.current.rankNames)
  }

  /** Remembers the last two distinct patches' meta (meta-seen.json → meta-prev.json). */
  private trackPatch(): void {
    const read = (name: string): MetaData | null => { try { const p = join(this.dir, name); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) as MetaData : null } catch { return null } }
    const now = meta()
    const seen = read('meta-seen.json')
    try {
      if (!seen) writeFileSync(join(this.dir, 'meta-seen.json'), JSON.stringify(now))
      else if (seen.version !== now.version) {
        if (seen.patch !== now.patch) writeFileSync(join(this.dir, 'meta-prev.json'), JSON.stringify(seen))
        writeFileSync(join(this.dir, 'meta-seen.json'), JSON.stringify(now))
      }
    } catch { /* read-only dir: no history */ }
    const prev = read('meta-prev.json')
    this.previousMeta = prev && prev.patch !== now.patch ? prev : null
  }

  /** Fetches the remote dataset; keeps the current one on any failure. */
  async refresh(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' })
      if (!res.ok) return false
      const data: unknown = await res.json()
      if (!isDataset(data) || data.version <= this.current.version) return false
      this.current = data
      writeFileSync(this.file, JSON.stringify(data))
      this.apply()
      return true
    } catch { return false }
  }
}
