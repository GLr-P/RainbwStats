// Opt-in round-1 detection: grabs the primary screen, OCRs it, and reports map/side/site.
// Only runs while Siege is open and the engine still lacks round info (keeps CPU near zero otherwise).
import { app, desktopCapturer, screen } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OcrWorker } from './worker'
import { detect, type Detection } from './matcher'

const GAME_PROCESS = /^RainbowSix/i

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
  debugDir: string | null = null

  constructor(onDetect: (d: Detection, newMatch: boolean) => void) { this.onDetect = onDetect }

  start(intervalMs = 2000): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.worker.dispose()
  }

  private async tick(): Promise<void> {
    if (this.busy || !this.shouldRun()) return
    this.busy = true
    try {
      const d = screen.getPrimaryDisplay()
      const width = Math.min(1600, d.size.width)
      // Only while Siege is the foreground app: never read other apps (a code editor once "showed"
      // map Border). Checked via the OCR worker, so it works in fullscreen, borderless and windowed.
      if (!GAME_PROCESS.test(await this.worker.foreground())) { this.pending = null; return }
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height: Math.round((width * d.size.height) / d.size.width) } })
      const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0]
      if (!src || src.thumbnail.isEmpty()) { this.pending = null; return }
      const dir = this.debugDir ?? join(app.getPath('temp'), 'rainbwstats-ocr')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, this.debugDir ? `frame-${Date.now()}.png` : 'frame.png')
      writeFileSync(file, src.thumbnail.toPNG())
      const found = detect(await this.worker.recognize(file), this.sitesByMap)
      // Require the same reading in two consecutive frames before acting on it.
      const sig = `${found.mapKey ?? ''}|${found.side ?? ''}|${found.site ?? ''}`
      const confirmed = sig !== '||' && sig === this.pending
      this.pending = sig === '||' ? null : sig
      if (confirmed) {
        const newMatch = !!found.mapKey && found.mapKey !== this.lastMap
        if (found.mapKey) this.lastMap = found.mapKey
        this.onDetect(found, newMatch)
      }
    } catch { /* capture can fail (secure desktop, exclusive fullscreen): retry next tick */ } finally {
      this.busy = false
    }
  }

  /** Forget the last map so the next detection starts a new match. */
  reset(): void { this.lastMap = undefined }
}
