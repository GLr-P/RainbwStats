import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import './styles.css'
import { applyCatalogOverrides } from '../../shared/catalog'
import type { UpdateStatus } from '../../shared/ipc'
import { Icon, applyTheme, rs, useData, useLive, useSettings } from './lib'
import { LivePage } from './pages/Live'
import { RosterPage } from './pages/Roster'
import { MetaPage, OperatorsPage } from './pages/Stats'
import { PlayersPage } from './pages/Players'
import { SettingsPage } from './pages/Settings'
import { MapsPage } from './pages/Maps'

const PAGES = [
  { id: 'live', label: 'Live', icon: Icon.live },
  { id: 'roster', label: 'Roster', icon: Icon.roster },
  { id: 'maps', label: 'Maps', icon: Icon.maps },
  { id: 'ops', label: 'Ops', icon: Icon.ops },
  { id: 'meta', label: 'Meta', icon: Icon.meta },
  { id: 'players', label: 'Players', icon: Icon.players },
  { id: 'settings', label: 'Settings', icon: Icon.settings }
] as const
type PageId = (typeof PAGES)[number]['id']

function App() {
  const [page, setPage] = useState<PageId>(() => (localStorageGet('page') as PageId) ?? 'live')
  const [settings, update] = useSettings()
  const live = useLive()
  const [status, refreshStatus] = useData(() => rs().status(), [live?.rounds.length, live?.phase])
  const [catalogReady, setCatalogReady] = useState(false)
  const lastPhase = useRef(live?.phase)

  useEffect(() => { void rs().catalog().then((c) => { applyCatalogOverrides(c); setCatalogReady(true) }) }, [])
  useEffect(() => { if (settings) applyTheme(settings.theme) }, [settings])
  useEffect(() => { localStorageSet('page', page) }, [page])
  // Zero interaction: jump to Live when a match starts.
  useEffect(() => {
    const p = live?.phase
    if (settings?.autoSwitchToLive && p !== lastPhase.current && (p === 'match' || p === 'loading')) setPage('live')
    lastPhase.current = p
  }, [live?.phase, settings?.autoSwitchToLive])

  const inMatch = live?.phase === 'match' || live?.phase === 'loading'
  const [appUpdate, setAppUpdate] = useState<UpdateStatus | null>(null)
  useEffect(() => { void rs().updateStatus().then(setAppUpdate); return rs().onUpdate(setAppUpdate) }, [])
  return (
    <div className="app" data-app-ready>
      <nav className="nav" aria-label="Main">
        <div className="brand">R6S</div>
        {PAGES.map((p) => (
          <button key={p.id} className={page === p.id ? 'on' : ''} onClick={() => setPage(p.id)} aria-current={page === p.id ? 'page' : undefined}>
            {p.icon}{p.label}
          </button>
        ))}
        <div className="spacer" />
        {inMatch && <div className="dot" title="Match in progress" />}
      </nav>
      <main className="page">
        {appUpdate?.state === 'ready' && !inMatch && (
          <div className="panel row" role="status">
            <span>RainbwStats <b>{appUpdate.next}</b> is ready. It installs when you close the app, or now:</span>
            <button className="btn primary" onClick={() => void rs().installUpdate()}>Restart now</button>
          </div>
        )}
        {!settings || !catalogReady ? null : page === 'live' ? <LivePage live={live} settings={settings} status={status} />
          : page === 'roster' ? <RosterPage settings={settings} update={update} />
          : page === 'maps' ? <MapsPage />
          : page === 'ops' ? <OperatorsPage />
          : page === 'meta' ? <MetaPage />
          : page === 'players' ? <PlayersPage />
          : <SettingsPage settings={settings} update={update} status={status} refreshStatus={refreshStatus} />}
      </main>
    </div>
  )
}

function localStorageGet(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } }
function localStorageSet(k: string, v: string): void { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

createRoot(document.getElementById('root')!).render(<App />)
