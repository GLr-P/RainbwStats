// Sign in through Ubisoft's own login page (Xbox / PlayStation / Facebook / email, plus "Can't log in?").
// We never see a password: we only read the session Ubisoft's page creates. Two capture paths:
//  1. the POST /v3/profiles/sessions response (has the remember-me ticket → stays signed in), via CDP;
//  2. any later ubiservices request's "Authorization: Ubi_v1 t=…" header (fallback, ~3 h session).
import { BrowserWindow, session as electronSession, type WebContents } from 'electron'
import type { WebSession } from './client'
import { sessionFromBody, sessionFromHeaders } from './websession'

export const WEB_APP_ID = '314d4fef-e568-454a-ae06-43e3bece12a6' // ubisoft.com
export const LOGIN_URL = `https://connect.ubisoft.com/login?appId=${WEB_APP_ID}&lang=en-US&nextUrl=${encodeURIComponent('https://www.ubisoft.com/en-us/game/rainbow-six/siege/stats')}`
const PARTITION = 'persist:ubisoft-login'

export interface WebLoginOptions {
  parent?: BrowserWindow
  /** Hidden attempt that only succeeds if Ubisoft still remembers this PC ("Keep me logged"). */
  silent?: boolean
  timeoutMs?: number
  url?: string
  partition?: string
}

export function ubisoftWebLogin(o: WebLoginOptions = {}): Promise<WebSession | null> {
  return new Promise((resolve) => {
    const ses = electronSession.fromPartition(o.partition ?? PARTITION)
    const win = new BrowserWindow({
      width: 520, height: 780, parent: o.parent, modal: !!o.parent && !o.silent, show: !o.silent, autoHideMenuBar: true,
      title: 'Sign in with Ubisoft', webPreferences: { partition: o.partition ?? PARTITION, sandbox: true, contextIsolation: true }
    })
    let done = false
    let fallback: WebSession | null = null
    const finish = (s: WebSession | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      ses.webRequest.onBeforeSendHeaders(null)
      if (!win.isDestroyed()) { win.webContents.stop(); setImmediate(() => !win.isDestroyed() && win.destroy()) }
      resolve(s)
    }
    const timer = setTimeout(() => finish(fallback), o.timeoutMs ?? (o.silent ? 20_000 : 15 * 60_000))

    // Path 1: read the sessions response (includes rememberMeTicket) with the DevTools protocol.
    const watch = (wc: WebContents) => {
      const pending = new Map<string, string>() // requestId → app id
      try { wc.debugger.attach('1.3') } catch { return }
      void wc.debugger.sendCommand('Network.enable').catch(() => undefined)
      wc.debugger.on('message', (_e, method, params: Record<string, any>) => {
        if (method === 'Network.requestWillBeSent' && /\/v3\/profiles\/sessions(\?|$)/.test(params['request']?.url ?? '') && params['request']?.method === 'POST') {
          const h = (params['request']?.headers ?? {}) as Record<string, string>
          pending.set(params['requestId'], Object.entries(h).find(([k]) => k.toLowerCase() === 'ubi-appid')?.[1] ?? WEB_APP_ID)
        }
        if (method === 'Network.loadingFinished' && pending.has(params['requestId'])) {
          const appId = pending.get(params['requestId'])!
          void wc.debugger.sendCommand('Network.getResponseBody', { requestId: params['requestId'] })
            .then((r: { body: string }) => { const s = sessionFromBody(r.body, appId); if (s?.rememberMeTicket) finish(s); else if (s) fallback ??= s })
            .catch(() => undefined)
        }
      })
    }
    watch(win.webContents)
    if (process.env['RS_DEBUG_LOGIN']) {
      win.webContents.on('console-message', (e) => console.log('PAGE', (e as unknown as { message: string }).message))
      win.webContents.on('did-finish-load', () => console.log('LOADED', win.webContents.getURL()))
    }
    // Xbox / PlayStation / Facebook open popups: keep them in the same session and watch them too.
    win.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: o.partition ?? PARTITION, sandbox: true } } }))
    win.webContents.on('did-create-window', (child) => watch(child.webContents))

    // Path 2: the signed-in page calls ubiservices with the ticket in a header.
    ses.webRequest.onBeforeSendHeaders((d, cb) => { // dedicated login session: only Ubisoft pages load here
      if (process.env['RS_DEBUG_LOGIN']) console.log('HDR', d.url, JSON.stringify(d.requestHeaders))
      const s = sessionFromHeaders(d.requestHeaders)
      if (s) { fallback ??= s; setTimeout(() => finish(fallback), 4000) } // give path 1 a moment to deliver remember-me
      cb({ requestHeaders: d.requestHeaders })
    })

    win.on('closed', () => finish(fallback))
    const load = (retries: number): void => {
      void win.loadURL(o.url ?? LOGIN_URL).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        if (process.env['RS_DEBUG_LOGIN']) console.log('LOADERR', msg)
        if (done || win.isDestroyed()) return
        // Redirect-driven logins abort the first navigation (ERR_ABORTED): not a failure.
        if (/ERR_ABORTED/.test(msg)) return
        // Transient network-service hiccups (ERR_FAILED) right after another window closed: retry.
        if (retries > 0) setTimeout(() => load(retries - 1), 500)
        else finish(null)
      })
    }
    load(2)
  })
}
