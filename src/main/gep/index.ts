// Overwolf GEP loader. Active only when the app runs on @overwolf/ow-electron with the "gep" package
// (package.json "overwolf": { "packages": ["gep"] }) and Overwolf has enabled R6 for this app.
// On plain Electron `app.overwolf` doesn't exist and this does nothing.
import { app } from 'electron'
import { GEP_FEATURES, GepState, R6_GAME_ID, type GepSnapshot } from './adapter'

interface GepPackage {
  on(ev: 'game-detected', cb: (e: { enable(): void }, gameId: number, name: string) => void): void
  on(ev: 'new-info-update' | 'new-game-event', cb: (e: unknown, gameId: number, data: { feature?: string; category?: string; key?: string; value?: unknown }) => void): void
  on(ev: 'error', cb: (e: unknown, gameId: number, error: string) => void): void
  setRequiredFeatures(gameId: number, features: string[]): Promise<void>
}
interface OwPackages { on(ev: 'ready', cb: (e: unknown, name: string, version: string) => void): void; gep?: GepPackage }

export const gepAvailable = (): boolean => !!(app as unknown as { overwolf?: { packages?: OwPackages } }).overwolf?.packages

/** Starts listening; `onChange` gets the latest snapshot and whether it's a new match. */
export function startGep(onChange: (s: GepSnapshot, newMatch: boolean) => void, log: (m: string) => void = () => undefined): boolean {
  const packages = (app as unknown as { overwolf?: { packages?: OwPackages } }).overwolf?.packages
  if (!packages) return false
  const state = new GepState()
  let lastMatch: string | null = null
  const push = () => {
    const s = state.snapshot()
    const newMatch = s.matchId !== lastMatch
    lastMatch = s.matchId
    onChange(s, newMatch)
  }
  packages.on('ready', (_e, name, version) => {
    if (name !== 'gep' || !packages.gep) return
    const gep = packages.gep
    log(`GEP ${version} ready`)
    gep.on('game-detected', (e, gameId) => {
      if (gameId !== R6_GAME_ID) return
      e.enable()
      gep.setRequiredFeatures(R6_GAME_ID, GEP_FEATURES).catch((err) => log(`GEP features: ${String(err)}`))
    })
    gep.on('new-info-update', (_e, gameId, data) => { if (gameId === R6_GAME_ID && state.info(data)) push() })
    gep.on('new-game-event', (_e, gameId, data) => { if (gameId === R6_GAME_ID && state.event(data)) push() })
    gep.on('error', (_e, gameId, error) => log(`GEP error (${gameId}): ${error}`))
  })
  return true
}
