// Turns noisy OCR lines into {map, side, site} using a fixed vocabulary. Pure and unit-tested.
import { allMaps } from '../../shared/catalog'
import type { Side } from '../../shared/types'

export interface Detection { mapKey?: string; side?: Side; site?: string }

const norm = (s: string) => s.toUpperCase().normalize('NFKD').replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[b.length]! / Math.max(a.length, b.length)
}

/** Best vocabulary match for a line: whole line, or any word window of the same length. */
function bestMatch(line: string, vocab: string[]): { word: string; score: number } | null {
  const words = line.split(' ')
  let best: { word: string; score: number } | null = null
  for (const v of vocab) {
    const n = v.split(' ').length
    for (let i = 0; i + n <= words.length; i++) {
      const sc = similarity(words.slice(i, i + n).join(' '), v)
      if (!best || sc > best.score) best = { word: v, score: sc }
    }
  }
  return best
}

const SIDE_WORDS: Record<string, Side> = { ATTACK: 'attack', ATTACKERS: 'attack', ATTACKING: 'attack', DEFENSE: 'defense', DEFENCE: 'defense', DEFENDERS: 'defense', DEFENDING: 'defense' }

export function detect(lines: string[], sitesByMap: (mapKey: string) => string[] = () => []): Detection {
  const L = lines.map(norm).filter((l) => l.length >= 3)
  const maps = allMaps().map((m) => ({ key: m.key, name: norm(m.name), short: norm(m.name.split(' ')[0]!) }))
  const out: Detection = {}

  // Map: full names first ("THEME PARK"), then distinctive first words ("KAFE", "NIGHTHAVEN").
  let mapScore = 0
  for (const l of L) {
    for (const m of maps) {
      const full = bestMatch(l, [m.name])?.score ?? 0
      const short = m.short.length >= 5 ? (bestMatch(l, [m.short])?.score ?? 0) - 0.05 : 0
      const sc = Math.max(full, short)
      if (sc > mapScore && sc >= 0.82) { mapScore = sc; out.mapKey = m.key }
    }
  }

  for (const l of L) {
    const m = bestMatch(l, Object.keys(SIDE_WORDS))
    if (m && m.score >= 0.85 && l.split(' ').length <= 4) { out.side = SIDE_WORDS[m.word]; break }
  }

  if (out.mapKey) {
    // Replay site names look like "2F Meeting Room, 2F Executive Office"; match either half.
    const sites = sitesByMap(out.mapKey)
    let siteScore = 0
    for (const site of sites) {
      for (const part of site.split(', ').map(norm)) {
        for (const l of L) {
          const sc = similarity(l, part)
          if (sc > siteScore && sc >= 0.85) { siteScore = sc; out.site = site }
        }
      }
    }
  }
  return out
}
