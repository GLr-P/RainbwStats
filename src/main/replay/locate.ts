// Finds the Siege install (Steam or Ubisoft Connect) and its MatchReplay folder.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'

const GAME_DIR = "Tom Clancy's Rainbow Six Siege"

function regQuery(key: string, value: string): string | null {
  try {
    const out = execFileSync('reg', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })
    return /REG_\w+\s+(.+)$/m.exec(out)?.[1]?.trim() ?? null
  } catch { return null }
}

/** Parses Steam's libraryfolders.vdf for library paths. */
export function steamLibraries(vdf: string): string[] {
  return [...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1]!.replace(/\\\\/g, '\\'))
}

export function findGameDirs(): string[] {
  const found = new Map<string, string>() // lowercased path → path
  const steam = regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath')
  const steamRoots = [steam, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean) as string[]
  for (const root of steamRoots) {
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf')
    const libs = existsSync(vdf) ? steamLibraries(readFileSync(vdf, 'utf8')) : []
    for (const lib of [root, ...libs]) {
      const dir = normalize(join(lib, 'steamapps', 'common', GAME_DIR))
      if (existsSync(dir)) found.set(dir.toLowerCase(), dir)
    }
  }
  const ubi = regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\635', 'InstallDir')
  for (const dir of [ubi, `C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games\\${GAME_DIR}`]) {
    const d = dir && normalize(dir.replace(/[\\/]+$/, ''))
    if (d && existsSync(d)) found.set(d.toLowerCase(), d)
  }
  return [...found.values()]
}

export const replayRootOf = (gameDir: string): string => join(gameDir, 'MatchReplay')
