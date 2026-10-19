// Auto-update from GitHub Releases: checks on launch and every 30 min, downloads in the background,
// installs on quit, or right away when the user clicks "Restart now".
import { app } from 'electron'
import updater from 'electron-updater'
import type { UpdateStatus } from '../shared/ipc'

const { autoUpdater } = updater
const EVERY_MS = 30 * 60_000

export class Updater {
  private state: UpdateStatus = { state: 'idle', current: app.getVersion() }
  private readonly onChange: (s: UpdateStatus) => void
  /** Portable builds and dev runs can't self-update. */
  readonly supported = app.isPackaged && !process.env['PORTABLE_EXECUTABLE_DIR']

  constructor(onChange: (s: UpdateStatus) => void) {
    this.onChange = onChange
    if (!this.supported) { this.set({ state: 'unsupported' }); return }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'upToDate', checkedAt: new Date().toISOString() }))
    autoUpdater.on('update-available', (i) => this.set({ state: 'downloading', next: i.version, percent: 0 }))
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (i) => this.set({ state: 'ready', next: i.version }))
    autoUpdater.on('error', (e) => this.set({ state: 'error', error: e instanceof Error ? e.message.split('\n')[0] : String(e) }))
  }

  get status(): UpdateStatus { return this.state }

  private set(p: Partial<UpdateStatus>): void {
    this.state = { ...this.state, ...p, current: app.getVersion() }
    if (p.state && p.state !== 'error') delete this.state.error
    this.onChange(this.state)
  }

  start(): void {
    if (!this.supported) return
    void this.check()
    setInterval(() => { if (this.state.state !== 'ready' && this.state.state !== 'downloading') void this.check() }, EVERY_MS)
  }

  async check(): Promise<UpdateStatus> {
    if (this.supported) await autoUpdater.checkForUpdates().catch(() => undefined)
    return this.state
  }

  install(): void {
    if (this.state.state === 'ready') autoUpdater.quitAndInstall(true, true) // silent install, relaunch
  }
}
