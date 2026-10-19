// `--selftest-weblogin`: runs the real login window against a local fake Ubisoft endpoint and checks
// both capture paths (sessions response with remember-me, and Authorization header fallback).
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { ubisoftWebLogin } from './ubi/weblogin'

const PAGE = (withSessionsCall: boolean) => `<!doctype html><title>fake login</title><script>
(async () => {
  ${withSessionsCall ? "await fetch('/v3/profiles/sessions', { method: 'POST', headers: { 'Ubi-AppId': 'fake-web-app', 'Content-Type': 'application/json' }, body: '{}' })" : ''}
  await fetch('/v1/profiles/me', { headers: { Authorization: 'Ubi_v1 t=HEADER_TICKET', 'Ubi-AppId': 'fake-web-app' } })
})()
</script>`

export async function selftestWebLogin(): Promise<boolean> {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url?.startsWith('/v') ? 'application/json' : 'text/html')
    if (req.url === '/v3/profiles/sessions') return res.end(JSON.stringify({ ticket: 'BODY_TICKET', rememberMeTicket: 'REMEMBER', sessionId: 's' }))
    if (req.url?.startsWith('/v1/')) return res.end('{}')
    res.end(PAGE(req.url !== '/header-only'))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const a = await ubisoftWebLogin({ silent: true, url: `${base}/`, partition: 'selftest-a', timeoutMs: 15000 })
  const b = await ubisoftWebLogin({ silent: true, url: `${base}/header-only`, partition: 'selftest-b', timeoutMs: 15000 })
  server.close()
  const okA = a?.ticket === 'BODY_TICKET' && a.rememberMeTicket === 'REMEMBER' && a.appId === 'fake-web-app'
  const okB = b?.ticket === 'HEADER_TICKET' && b.appId === 'fake-web-app'
  console.log(`WEBLOGIN body+remember: ${okA ? 'OK' : 'FAIL ' + JSON.stringify(a)} · header fallback: ${okB ? 'OK' : 'FAIL ' + JSON.stringify(b)}`)
  return okA && okB
}
