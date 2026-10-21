// Turns noisy OCR lines into {map, side, site} using a fixed vocabulary. Pure and unit-tested.
import { allMaps, allOperators } from '../../shared/catalog'
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

/** Operator display names (uppercased like Siege's UI), cached per call site. */
const OP_NAMES = () => (['attack', 'defense'] as const).flatMap((side) => allOperators(side).map((o) => ({ name: norm(o.name), side })))

const SIDE_WORDS: Record<string, Side> = { ATTACK: 'attack', ATTACKERS: 'attack', ATTACKING: 'attack', DEFENSE: 'defense', DEFENCE: 'defense', DEFENDERS: 'defense', DEFENDING: 'defense' }

export function detect(lines: string[], sitesByMap: (mapKey: string) => string[] = () => []): Detection {
  const L = lines.map(norm).filter((l) => l.length >= 3)
  const maps = allMaps().map((m) => ({ key: m.key, name: norm(m.name), short: norm(m.name.split(' ')[0]!) }))
  const out: Detection = {}

  // Siege shows map and side as short standalone labels. Words inside longer lines (chat, menus,
  // code on another window: "border: 1px solid") must never count.
  const words = (l: string) => l.split(' ').length

  // Map: full names first ("THEME PARK"), then distinctive first words ("KAFE", "NIGHTHAVEN").
  // Several map names on screen = the map vote ("MAP SELECTION"), not the map being played (2026-10-20 frames).
  let mapScore = 0
  const seen = new Set<string>()
  for (const l of L) {
    let lineBest: { key: string; sc: number } | null = null
    for (const m of maps) {
      if (words(l) > words(m.name) + 1) continue
      // Whole line with spaces dropped ("CLUB HOUSE" = Clubhouse) beats a word inside it ("HOUSE" = House).
      const whole = similarity(l.replace(/ /g, ''), m.name.replace(/ /g, ''))
      const full = (bestMatch(l, [m.name])?.score ?? 0) - (l === m.name ? 0 : 0.03)
      const short = m.short.length >= 5 ? (bestMatch(l, [m.short])?.score ?? 0) - 0.05 : 0
      const sc = Math.max(whole, full, short)
      if (sc >= 0.82 && (!lineBest || sc > lineBest.sc)) lineBest = { key: m.key, sc }
      if (sc > mapScore && sc >= 0.82) { mapScore = sc; out.mapKey = m.key }
    }
    if (lineBest) seen.add(lineBest.key)
  }
  if (seen.size > 1 || L.some((l) => l.replace(/ /g, '').includes('MAPSELECTION'))) delete out.mapKey

  // Side: standalone label only; a frame showing both ATTACK and DEFENSE labels is ambiguous.
  // Round results ("ATTACKERS WIN", "DEFENDERS ELIMINATED") and ban screens name *other* sides: no side from them.
  const NOT_MINE = new Set(['WIN', 'WINS', 'WON', 'LOST', 'LOSE', 'ELIMINATED', 'VICTORY', 'DEFEAT', 'BAN', 'BANS', 'BANNED', 'MVP'])
  // OCR often runs the ban heading together ("BANA DEFENDER", 2026-10-19 frames), so match it as a phrase too.
  // OCR may also drop "BAN" entirely ("A DEFENDER"), so the ban rule text marks the screen too.
  const banScreen = L.some((l) => /(^| )(BAN ?)?AN? ?(ATTACKER|DEFENDER)$|^(BAN ?)?AN? ?(ATTACKER|DEFENDER)/.test(l) || /UNTIL ?ROLE ?SWAP|CANT BE USED UNTIL/.test(l))
  // End-of-match lineup: OCR often misses "VICTORY" but reads the menu around it.
  const endScreen = L.some((l) => /MATCHRECAP|TEAMLINEUP|COMMENDAGAIN|TOCOMMEND|NEWMATCH|FINDANOTHERMATCH|KEEPPLAYING/.test(l.replace(/ /g, '')))
  const resultScreen = banScreen || endScreen || L.some((l) => l.split(' ').some((w) => NOT_MINE.has(w)))
  const sides = new Set<Side>()
  for (const l of resultScreen ? [] : L) {
    if (words(l) > 2) continue
    const m = bestMatch(l, Object.keys(SIDE_WORDS))
    if (m && m.score >= 0.85) sides.add(SIDE_WORDS[m.word]!)
  }
  if (sides.size === 1) out.side = [...sides][0]
  else if (sides.size === 0) {
    // Operator select lists only your side's operators: their names give your side. Ban screens show
    // the enemy's, so frames mentioning bans are skipped.
    if (!resultScreen && !L.some((l) => l.split(' ').some((w) => w === 'BAN' || w === 'BANS' || w === 'BANNED'))) {
      const vote = { attack: 0, defense: 0 }
      for (const l of L) {
        if (words(l) > 2) continue
        const hit = OP_NAMES().find((o) => similarity(l, o.name) >= 0.88)
        if (hit) vote[hit.side]++
      }
      const total = vote.attack + vote.defense
      if (total >= 3 && Math.max(vote.attack, vote.defense) / total >= 0.8) out.side = vote.attack > vote.defense ? 'attack' : 'defense'
    }
  }

  if (out.mapKey) {
    // Replay site names look like "2F Meeting Room, 2F Executive Office"; match either half.
    // Several sites on screen means the full BOMB SITES list (ban/operator select), not a chosen site.
    const found = new Set<string>()
    for (const site of sitesByMap(out.mapKey)) {
      if (site.split(', ').map(norm).some((part) => L.some((l) => similarity(l, part) >= 0.85))) found.add(site)
    }
    if (found.size === 1) out.site = [...found][0]
  }
  return out
}
