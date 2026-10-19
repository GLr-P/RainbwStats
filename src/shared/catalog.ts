// Single lookup point for operators and maps. Seeded from src/shared/data, overridable by the
// remote dataset (new season IDs) via applyCatalogOverrides().
import { OPERATORS, RECRUIT_ID, type OperatorInfo, type RoleTag } from './data/operators'
import { MAPS, type MapInfo } from './data/maps'
import type { Side } from './types'

export interface CatalogOverrides {
  operators?: { id: string; name: string; side: 'attack' | 'defense'; roles?: RoleTag[] }[]
  maps?: { key: string; name: string; ids: string[] }[]
}

const opsById = new Map<string, OperatorInfo>()
const opsByKey = new Map<string, OperatorInfo>()
const mapsById = new Map<string, MapInfo>()
const mapsByKey = new Map<string, MapInfo>()

function index(): void {
  opsById.clear(); opsByKey.clear(); mapsById.clear(); mapsByKey.clear()
  for (const o of OPERATORS) { opsById.set(o.id, o); opsByKey.set(o.key, o) }
  for (const m of MAPS) { mapsByKey.set(m.key, m); for (const id of m.ids) mapsById.set(id, m) }
}
index()

export function applyCatalogOverrides(o: CatalogOverrides): void {
  for (const op of o.operators ?? []) {
    const key = op.name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const existing = opsByKey.get(key)
    const info: OperatorInfo = { id: op.id, key, name: op.name, side: op.side, roles: op.roles ?? existing?.roles ?? [] }
    if (existing && existing.id !== op.id) opsById.delete(existing.id)
    const i = OPERATORS.findIndex((x) => x.key === key)
    if (i >= 0) OPERATORS[i] = info; else OPERATORS.push(info)
  }
  for (const m of o.maps ?? []) {
    const i = MAPS.findIndex((x) => x.key === m.key)
    if (i >= 0) MAPS[i] = { ...m, ids: [...new Set([...MAPS[i]!.ids, ...m.ids])] }; else MAPS.push(m)
  }
  index()
}

export const operatorById = (id: string): OperatorInfo | undefined => opsById.get(id)
export const operatorByKey = (key: string): OperatorInfo | undefined => opsByKey.get(key)
export const allOperators = (side?: Side): OperatorInfo[] => (side ? OPERATORS.filter((o) => o.side === side) : OPERATORS)
export const sideOfOperator = (id: string): Side | null => (id === RECRUIT_ID ? null : opsById.get(id)?.side ?? null)
export const operatorName = (id: string): string => (id === RECRUIT_ID ? 'Recruit' : opsById.get(id)?.name ?? `Unknown(${id})`)

export const mapByKey = (key: string): MapInfo | undefined => mapsByKey.get(key)
export const allMaps = (): MapInfo[] => MAPS
/** Map key for a Dissect world ID; unknown IDs get a stable "unknown:<id>" key. */
export const mapKeyForWorldId = (id: string): string => mapsById.get(id)?.key ?? `unknown:${id}`
export const mapName = (key: string): string => mapsByKey.get(key)?.name ?? (key.startsWith('unknown:') ? `Unknown map ${key.slice(8)}` : key)

/** "Y11S3_Alpha04" → "Y11S3" */
export const seasonOf = (gameVersion: string): string => /Y\d+S\d+/.exec(gameVersion)?.[0] ?? 'unknown'
