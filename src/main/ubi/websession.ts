// Pure helpers for the Ubisoft web login capture (no Electron imports, unit-tested).
import type { WebSession } from './client'

/** Parses a sessions response body into a WebSession (exported for tests). */
export function sessionFromBody(body: string, appId: string): WebSession | null {
  try {
    const d = JSON.parse(body) as Record<string, unknown>
    const ticket = typeof d['ticket'] === 'string' ? d['ticket'] : ''
    if (!ticket) return null
    const rm = typeof d['rememberMeTicket'] === 'string' && d['rememberMeTicket'] ? d['rememberMeTicket'] : undefined
    return { ticket, appId, rememberMeTicket: rm }
  } catch { return null }
}

/** Extracts a ticket from request headers (exported for tests). */
export function sessionFromHeaders(h: Record<string, string>): WebSession | null {
  const auth = Object.entries(h).find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? ''
  const appId = Object.entries(h).find(([k]) => k.toLowerCase() === 'ubi-appid')?.[1] ?? ''
  const m = /^Ubi_v1 t=(.+)$/i.exec(auth)
  return m && appId ? { ticket: m[1]!, appId } : null
}
