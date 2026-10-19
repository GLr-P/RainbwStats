import type { Db } from './db'
import type { Settings } from '../shared/ipc'

export const DEFAULT_SETTINGS: Settings = {
  gameDir: null,
  roster: { attack: [], defense: [] },
  weights: { personal: 1, meta: 1, site: 1, role: 1, comfort: 1 },
  theme: {
    accent: '#e8b23a', attack: '#d9761c', defense: '#4a93e0', bg: '#0b0e13', surface: '#141922', text: '#e6e9ef',
    fontScale: 1, density: 'comfortable', angled: true
  },
  panels: { recommendations: true, siteBreakdown: true, teams: true, timeline: true },
  topN: 3,
  minRounds: 8,
  alwaysOnTop: false,
  autoSwitchToLive: true,
  launchAtLogin: false,
  ocrEnabled: false,
  datasetUrl: 'https://glr-p.github.io/RainbwStats/data/meta/latest.json',
  shareCrowd: false,
  crowdPrompted: false,
  crowdUrl: 'https://rainbwstats-crowd.nanotechservices.workers.dev'
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Deep merge that only accepts keys (and value types) present in the base. */
export function mergeSettings<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in base)) continue
    const cur = (base as Record<string, unknown>)[k]
    if (isPlainObject(cur)) out[k] = mergeSettings(cur, v)
    else if (Array.isArray(cur) ? Array.isArray(v) : cur === null || v === null || typeof v === typeof cur) out[k] = v
  }
  return out as T
}

export class SettingsStore {
  private value: Settings
  private readonly db: Db
  constructor(db: Db) {
    this.db = db
    this.value = mergeSettings(DEFAULT_SETTINGS, db.getJson('settings') ?? {})
    // v0.3.0: weights became multipliers on win-chance parts; older stored weights are reset.
    const stored = db.getJson<{ weights?: Record<string, number> }>('settings')
    if (stored?.weights && stored.weights['role'] === undefined) this.value = { ...this.value, weights: DEFAULT_SETTINGS.weights }
  }
  get(): Settings { return this.value }
  set(patch: Partial<Settings>): Settings {
    this.value = mergeSettings(this.value, patch)
    this.db.setJson('settings', this.value)
    return this.value
  }
}
