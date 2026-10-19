import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

const isSmoke = process.argv.includes('--smoke')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0e13',
    show: false,
    autoHideMenuBar: true,
    title: 'RainbwStats',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.once('ready-to-show', () => !isSmoke && win.show())
  // Open external links in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(() => {
  const win = createWindow()
  if (isSmoke) {
    const fail = setTimeout(() => { console.error('SMOKE FAIL: timeout'); app.exit(1) }, 20000)
    win.webContents.once('did-finish-load', async () => {
      const ok = await win.webContents.executeJavaScript('new Promise(r => setTimeout(() => r(!!document.querySelector("[data-app-ready]")), 1500))')
      clearTimeout(fail)
      console.log(ok ? 'SMOKE OK' : 'SMOKE FAIL: app root missing')
      app.exit(ok ? 0 : 1)
    })
  }
})

app.on('window-all-closed', () => app.quit())
