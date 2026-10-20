// Opt-in round-1 detection: grabs the primary screen, OCRs it, and reports map/side/site.
// Only runs while Siege is open and the engine still lacks round info (keeps CPU near zero otherwise).
import { app, desktopCapturer, screen } from 'electron'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OcrWorker } from './worker'
import { detect, type Detection } from './matcher'

const GAME_PROCESS = /^RainbowSix/i

/** Siege's main menu (top bar PLAY / OPERATORS / BATTLEPASS / LOCKER, "BROWSE PLAYLISTS"). */
export function isMenu(lines: unknown): boolean {
  const text = (Array.isArray(lines) ? lines : []).map((l) => (typeof l === 'string' ? l : typeof l === 'object' && l && 'text' in l ? String((l as { text: unknown }).text) : '')).join(' ').toUpperCase()
  return text.includes('BROWSE PLAYLISTS') || ['OPERATORS', 'BATTLEPASS', 'LOCKER', 'CAREER'].filter((w) => text.includes(w)).length >= 3
}

/** Keep debug output bounded even when OCR itself fails before a text sidecar can be written. */
export function trimDebugFrames(dir: string): void {
  const frames = readdirSync(dir).filter((f) => /^frame-\d+\.(png|txt)$/.test(f)).sort()
  for (const f of frames.slice(0, Math.max(0, frames.length - 80))) rmSync(join(dir, f), { force: true })
}

export class OcrDetector {
  private timer: NodeJS.Timeout | null = null
  private worker = new OcrWorker()
  private busy = false
  private lastMap: string | undefined
  private pending: string | null = null
  private readonly onDetect: (d: Detection, newMatch: boolean) => void
  /** Engine-provided gate: true when the game runs and round info is missing. */
  shouldRun: () => boolean = () => true
  sitesByMap: (mapKey: string) => string[] = () => []
  /** Pacing: slow in Siege's menus, quick between the menu and round 1, then gives up after 2 minutes
   *  without a reading (so a missed round 1 never keeps capturing during play). */
  private lastRun = 0
  private nextDelay = 0
  private activeSince: number | null = null
  /** Called when a frame shows Siege's main menu. */
  onMenu: () => void = () => undefined
  debugDir: string | null = null

  constructor(onDetect: (d: Detection, newMatch: boolean) => void) { this.onDetect = onDetect }

  start(intervalMs = 2000): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), Math.min(intervalMs, 1000))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.worker.dispose()
  }

  private async tick(): Promise<void> {
    if (!this.shouldRun()) { this.activeSince = null; this.nextDelay = 0; return }
    if (this.busy || Date.now() - this.lastRun < this.nextDelay) return
    this.busy = true
    this.lastRun = Date.now()
    try {
      const d = screen.getPrimaryDisplay()
      const width = Math.min(1280, d.size.width) // small capture: enough for Siege's large labels, cheap to grab
      // Only while Siege is the foreground app: never read other apps (a code editor once "showed"
      // map Border). Checked via the OCR worker, so it works in fullscreen, borderless and windowed.
      if (!GAME_PROCESS.test(await this.worker.foreground())) { this.pending = null; this.nextDelay = 3000; return }
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height: Math.round((width * d.size.height) / d.size.width) } })
      const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0]
      if (!src || src.thumbnail.isEmpty()) { this.pending = null; return }
      const dir = this.debugDir ?? join(app.getPath('temp'), 'rainbwstats-ocr')
      mkdirSync(dir, { recursive: true })
      const stamp = Date.now()
      const file = join(dir, this.debugDir ? `frame-${stamp}.png` : 'frame.png')
      writeFileSync(file, src.thumbnail.toPNG())
      const lines = await this.worker.recognize(file)
      const found = detect(lines, this.sitesByMap)
      const menu = isMenu(lines)
      if (menu) { this.pending = null; this.onMenu(); this.activeSince = null; this.nextDelay = 6000 }
      else {
        this.activeSince ??= Date.now()
        this.nextDelay = Date.now() - this.activeSince > 120_000 ? 30_000 : 1500
      }
      // Main-menu frames are useless for debugging and would push out the interesting ones (ban phase, loading).
      if (this.debugDir) { if (menu) rmSync(file, { force: true }); else this.keepDebug(dir, stamp, lines, found) }
      // Require the same reading in two consecutive frames before acting on it.
      const sig = `${found.mapKey ?? ''}|${found.side ?? ''}|${found.site ?? ''}`
      const confirmed = sig !== '||' && sig === this.pending
      this.pending = sig === '||' ? null : sig
      if (confirmed) {
        const newMatch = !!found.mapKey && found.mapKey !== this.lastMap
        if (found.mapKey) this.lastMap = found.mapKey
        this.onDetect(found, newMatch)
      }
    } catch {
      // A failed OCR run has no text sidecar, so it would otherwise bypass keepDebug's 40-frame cap.
      if (this.debugDir) trimDebugFrames(this.debugDir)
    } finally {
      this.busy = false
    }
  }

  /** Debug mode: next to each frame, what was read and detected; only the newest 40 frames are kept. */
  private keepDebug(dir: string, stamp: number, lines: unknown, found: Detection): void {
    writeFileSync(join(dir, `frame-${stamp}.txt`), `${JSON.stringify(found)}\n\n${JSON.stringify(lines, null, 1)}`)
    trimDebugFrames(dir)
  }

  /** Forget the last map so the next detection starts a new match. */
  reset(): void { this.lastMap = undefined }
}
