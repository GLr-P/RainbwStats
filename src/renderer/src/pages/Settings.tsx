import { useEffect, useState } from 'react'
import type { AppStatus, Settings, ThemeSettings, Weights } from '../../../shared/ipc'
import { rs, useData } from '../lib'

const DEFAULT_THEME: ThemeSettings = {
  accent: '#e8b23a', attack: '#d9761c', defense: '#4a93e0', bg: '#0b0e13', surface: '#141922', text: '#e6e9ef',
  fontScale: 1, density: 'comfortable', angled: true
}

/** Move your data between PCs (e.g. replays parsed on your main PC → laptop). */
function DataPanel() {
  const [msg, setMsg] = useState<string | null>(null)
  const run = async (kind: 'export' | 'import') => {
    setMsg(kind === 'export' ? 'Exporting…' : 'Importing…')
    const r = kind === 'export' ? await rs().exportData() : await rs().importData()
    if (!r.ok) return setMsg(r.error ? `Failed: ${r.error}` : null)
    if (kind === 'export') return setMsg(`Saved to ${r.path}`)
    const added = (r as { added?: Record<string, number> }).added ?? {}
    setMsg(`Imported: ${added['rounds'] ?? 0} new rounds, ${added['rank_snapshots'] ?? 0} rank checks, ${added['api_op_fetch'] ?? 0} player stat updates`)
  }
  return (
    <div className="panel">
      <h2>Your data</h2>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={() => void run('export')}>Export to file</button>
        <button className="btn" onClick={() => void run('import')}>Import from file</button>
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>
        Moves your parsed replays, rank history and operator stats to another PC. Importing only adds what's missing and never overwrites
        newer data. Login, settings and sharing stay on each PC.
      </div>
      {msg && <div className="small" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  )
}

export function SettingsPage({ settings: s, update, status, refreshStatus }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void>; status: AppStatus | undefined; refreshStatus: () => void }) {
  const theme = (p: Partial<ThemeSettings>) => update({ theme: { ...s.theme, ...p } })
  const weight = (k: keyof Weights, v: number) => update({ weights: { ...s.weights, [k]: v } })
  const Toggle = ({ k, label }: { k: 'alwaysOnTop' | 'autoSwitchToLive' | 'launchAtLogin' | 'ocrEnabled' | 'ocrDebug' | 'shareCrowd' | 'overlay'; label: string }) => (
    <label className="toggle"><input type="checkbox" checked={s[k]} onChange={(e) => void update({ [k]: e.target.checked })} />{label}</label>
  )
  const Panel = ({ k, label }: { k: keyof Settings['panels']; label: string }) => (
    <label className="toggle"><input type="checkbox" checked={s.panels[k]} onChange={(e) => void update({ panels: { ...s.panels, [k]: e.target.checked } })} />{label}</label>
  )
  return (
    <div className="settings">
      <Account status={status} refresh={refreshStatus} />
      <Updates />

      <div className="panel">
        <h2>Game & data</h2>
        <div className="field">Game folder<code className="faint">{s.gameDir ?? 'not found'}</code></div>
        <div className="row">
          <button className="btn" onClick={() => void rs().pickGameDir().then(refreshStatus)}>Change…</button>
          <button className="btn" onClick={() => void rs().rescan().then(refreshStatus)}>Rescan replays</button>
          <button className="btn" onClick={() => void rs().simulate()} title="Replays your last match into the Live page">Simulate last match</button>
        </div>
        {status && <div className="small muted">{status.rounds} rounds · {status.matches} matches · {status.players} players · dataset {status.datasetVersion}</div>}
        <div className="small muted">In Siege, turn on <b>Options → General → Match Replay</b> so every match is recorded.</div>
      </div>

      <div className="panel">
        <h2>Behaviour</h2>
        <Toggle k="autoSwitchToLive" label="Jump to Live when a match is detected" />
        <Toggle k="alwaysOnTop" label="Keep window on top" />
        <Toggle k="overlay" label="Overlay: small always-on-top window with picks, bans and the enemy team" />
        <div className="small muted">Drag it anywhere, resize it, and use − / + for transparency. It shows over Siege in borderless or windowed mode (not exclusive fullscreen) and never touches the game. Also in the tray menu.</div>
        <Toggle k="launchAtLogin" label="Start with Windows" />
        <Toggle k="ocrEnabled" label="Read map and side from screen before round 1 (OCR, beta)" />
        <div className="small muted">OCR only looks at your screen while Siege runs and round 1 info is missing. Nothing leaves your PC.</div>
        {s.ocrEnabled && (
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <Toggle k="ocrDebug" label="Keep the last 40 OCR frames (to report misreads)" />
            {s.ocrDebug && <button className="btn" onClick={() => void rs().openOcrDebug()}>Open folder</button>}
          </div>
        )}
      </div>

      <DataPanel />

      <div className="panel">
        <h2>Global database</h2>
        <Toggle k="shareCrowd" label="Share my lobbies' operator stats with the global database" />
        <div className="small muted">
          Everyone gets the global meta (Meta → Global). Sharing adds, for each player in your lobbies, their ranked operator rounds and wins
          this season plus rank band, and from your replays the map, site, side, operator and round result. No names are sent; player ids are
          replaced with a one-way hash. Custom games are ignored.
        </div>
      </div>

      <div className="panel">
        <h2>Live page</h2>
        <Panel k="recommendations" label="Your picks" />
        <Panel k="siteBreakdown" label="Picks by site" />
        <Panel k="teams" label="Lobby (ranks, K/D, operators)" />
        <Panel k="timeline" label="Round timeline" />
        <label className="field">Picks shown: {s.topN}<input type="range" min={1} max={6} value={s.topN} onChange={(e) => void update({ topN: Number(e.target.value) })} /></label>
      </div>

      <div className="panel">
        <h2>Recommendation weights</h2>
        <div className="small muted">Picks are ranked by estimated round win chance. Each slider scales one part of that estimate (×1 = normal, ×0 = ignore, ×2 = double).</div>
        {(['site', 'role', 'personal', 'meta', 'comfort'] as const).map((k) => (
          <label className="field" key={k}>
            {({
              site: 'Map/site specialists (curated tiers)',
              role: 'Hard breach / anti-breach need (only when your team lacks one)',
              personal: 'Your record with the operator',
              meta: 'Meta (replays, players you met)',
              comfort: 'Familiarity (how much you play it)'
            })[k]}: ×{(s.weights[k] ?? 1).toFixed(1)}
            <input type="range" min={0} max={2} step={0.1} value={s.weights[k] ?? 1} onChange={(e) => void weight(k, Number(e.target.value))} />
          </label>
        ))}
        <label className="field">Rounds before trusting your own stats: {s.minRounds}<input type="range" min={2} max={30} value={s.minRounds} onChange={(e) => void update({ minRounds: Number(e.target.value) })} /></label>
      </div>

      <div className="panel">
        <h2>Theme</h2>
        <div className="colors">
          {(['accent', 'attack', 'defense', 'bg', 'surface', 'text'] as const).map((k) => (
            <label key={k}><input type="color" value={s.theme[k]} onChange={(e) => void theme({ [k]: e.target.value })} />{k}</label>
          ))}
        </div>
        <label className="field">Text size: {Math.round(s.theme.fontScale * 100)}%<input type="range" min={0.85} max={1.4} step={0.05} value={s.theme.fontScale} onChange={(e) => void theme({ fontScale: Number(e.target.value) })} /></label>
        <label className="toggle"><input type="checkbox" checked={s.theme.density === 'compact'} onChange={(e) => void theme({ density: e.target.checked ? 'compact' : 'comfortable' })} />Compact spacing</label>
        <label className="toggle"><input type="checkbox" checked={s.theme.angled} onChange={(e) => void theme({ angled: e.target.checked })} />Angled corners</label>
        <button className="btn" onClick={() => void update({ theme: DEFAULT_THEME })}>Reset theme</button>
      </div>
    </div>
  )
}

function Account({ status, refresh }: { status: AppStatus | undefined; refresh: () => void }) {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [code, setCode] = useState('')
  const [need2fa, setNeed2fa] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<{ ok: boolean; twoFactor?: boolean; error?: string }>) => {
    setBusy(true); setMsg(null)
    const r = await fn()
    setBusy(false)
    if (r.twoFactor) { setNeed2fa(true); setMsg('Enter the code from your authenticator / email') }
    else if (!r.ok) setMsg(r.error ?? 'Login failed')
    else { setNeed2fa(false); setPw(''); setCode(''); refresh() }
  }
  const [showForm, setShowForm] = useState(false)
  return (
    <div className="panel">
      <h2>Ubisoft account</h2>
      {status?.loggedIn ? (
        <>
          <div>Connected{status.myName ? ` as ${status.myName}` : ''}{status.loginMethod === 'web' ? ' (signed in through Ubisoft, no password stored)' : ''}.</div>
          <div><button className="btn" onClick={() => void rs().logout().then(refresh)}>Log out</button></div>
        </>
      ) : !showForm ? (
        <>
          <button className="btn primary" disabled={busy} onClick={() => void run(() => rs().loginWithUbisoft())}>{busy ? 'Waiting for Ubisoft…' : 'Sign in with Ubisoft'}</button>
          <div className="small muted">Opens Ubisoft's official login page. Use <b>Xbox, PlayStation or Facebook</b> if they're linked, or your email. Forgot it? Click <b>Can't log in?</b> there. Ubisoft doesn't offer Steam sign-in. Your Ubisoft email is in the Ubisoft Connect app under Settings → Account.</div>
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setShowForm(true)}>Use email & password here instead</button>
        </>
      ) : (
        <form style={{ display: 'flex', flexDirection: 'column', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void run(need2fa ? () => rs().submitTwoFactor(code) : () => rs().login(email, pw)) }}>
          {!need2fa ? (
            <>
              <input type="text" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Ubisoft email" />
              <input type="password" autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Ubisoft password" />
            </>
          ) : <input type="text" inputMode="numeric" placeholder="2FA code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Two-factor code" autoFocus />}
          <div><button className="btn primary" disabled={busy}>{busy ? 'Connecting…' : need2fa ? 'Verify' : 'Log in'}</button></div>
        </form>
      )}
      {msg && <div className="warn small">{msg}</div>}
      <div className="small muted">Optional. Only used to fetch ranks and K/D for players in your lobby. You stay signed in automatically. This is a normal Ubisoft website login, so the game and anti-cheat never see it.</div>
    </div>
  )
}

export function Updates() {
  const [u, refresh] = useData(() => rs().updateStatus(), [])
  useEffect(() => rs().onUpdate(() => refresh()), [refresh])
  if (!u) return null
  const text = {
    idle: 'Checks automatically every 30 minutes.', checking: 'Checking…', upToDate: 'You have the latest version.',
    downloading: `Downloading ${u.next ?? 'update'}… ${u.percent ?? 0}%`, ready: `Version ${u.next} is ready.`,
    error: `Update check failed: ${u.error ?? 'unknown error'}`, unsupported: 'Auto-update is only available in the installed version (not portable/dev).'
  }[u.state]
  return (
    <div className="panel">
      <h2>Updates <span className="sub">v{u.current}</span></h2>
      <div className={u.state === 'error' ? 'warn' : u.state === 'ready' ? 'ok' : 'muted'}>{text}</div>
      <div className="row">
        {u.state === 'ready'
          ? <button className="btn primary" onClick={() => void rs().installUpdate()}>Restart & update</button>
          : <button className="btn" disabled={u.state === 'checking' || u.state === 'downloading' || u.state === 'unsupported'} onClick={() => void rs().checkForUpdates().then(refresh)}>Check for updates</button>}
      </div>
      <div className="small muted">Updates download in the background and install when you close the app.</div>
    </div>
  )
}
