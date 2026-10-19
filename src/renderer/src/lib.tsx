import { useCallback, useEffect, useState } from 'react'
import type { LiveState, RsApi, Settings, ThemeSettings } from '../../shared/ipc'
import type { Agg, Side } from '../../shared/types'
import { operatorById, operatorName, sideOfOperator } from '../../shared/catalog'
import { rankColor, rankName } from '../../shared/ranks'

declare global { interface Window { rs: RsApi } }
export const rs = (): RsApi => window.rs

export function useLive(): LiveState | null {
  const [s, set] = useState<LiveState | null>(null)
  useEffect(() => {
    void rs().getLive().then(set)
    return rs().onLive(set)
  }, [])
  return s
}

/** Loads async data; re-runs when deps change. */
export function useData<T>(fn: () => Promise<T>, deps: unknown[]): [T | undefined, () => void] {
  const [v, set] = useState<T>()
  const [n, bump] = useState(0)
  useEffect(() => {
    let alive = true
    void fn().then((x) => alive && set(x))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return [v, useCallback(() => bump((x) => x + 1), [])]
}

export function applyTheme(t: ThemeSettings): void {
  const r = document.documentElement
  const set = (k: string, v: string) => r.style.setProperty(k, v)
  set('--accent', t.accent); set('--attack', t.attack); set('--defense', t.defense)
  set('--bg', t.bg); set('--surface', t.surface); set('--text', t.text)
  set('--surface-2', `color-mix(in srgb, ${t.surface} 82%, ${t.text} 6%)`)
  set('--line', `color-mix(in srgb, ${t.surface} 75%, ${t.text} 14%)`)
  set('--muted', `color-mix(in srgb, ${t.text} 62%, ${t.bg})`)
  set('--faint', `color-mix(in srgb, ${t.text} 40%, ${t.bg})`)
  set('--font-scale', String(t.fontScale))
  r.dataset['density'] = t.density
  r.dataset['angled'] = String(t.angled)
}

export const pct = (x: number, digits = 0) => (Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : '–')
export const ratio = (a: number, b: number) => (b > 0 ? (a / b).toFixed(2) : a > 0 ? a.toFixed(2) : '–')
export const wr = (a: Agg) => (a.rounds ? pct(a.wins / a.rounds) : '–')

export function SideTag({ side, lg }: { side: Side | null; lg?: boolean }) {
  if (!side) return <span className="badge">side ?</span>
  return <span className={`side ${side}${lg ? ' lg' : ''}`}>{side === 'attack' ? 'ATK' : 'DEF'}</span>
}

export function RankBadge({ rank, rp }: { rank: number; rp?: number }) {
  return (
    <span className="rankb">
      <i style={{ background: rankColor(rank) }} />
      {rankName(rank)}
      {rp !== undefined && rank > 0 && <span className="faint num">{rp}</span>}
    </span>
  )
}

export function OpChip({ id, title }: { id: string; title?: string }) {
  const side = sideOfOperator(id)
  return <span className={`opchip ${side ?? ''}`} title={title}>{operatorName(id)}</span>
}

export function Meter({ value }: { value: number }) {
  return <div className="meter" aria-hidden><span style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></div>
}

export function Bar({ value }: { value: number }) {
  return <span className="bar"><span style={{ width: `${Math.max(1, Math.min(100, value * 100))}%` }} /></span>
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => <button key={o.v} className={o.v === value ? 'on' : ''} role="radio" aria-checked={o.v === value} onClick={() => onChange(o.v)}>{o.label}</button>)}
    </div>
  )
}

export function useSettings(): [Settings | undefined, (p: Partial<Settings>) => Promise<void>] {
  const [s, set] = useState<Settings>()
  useEffect(() => { void rs().getSettings().then(set) }, [])
  const update = useCallback(async (p: Partial<Settings>) => {
    const next = await rs().setSettings(p)
    set(next)
    applyTheme(next.theme)
  }, [])
  return [s, update]
}

export const opRoles = (id: string): string => (operatorById(id)?.roles ?? []).join(' · ')

/** Minimal inline icons (no icon font, nothing fetched). */
export const Icon = {
  live: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M5 12a7 7 0 0 1 14 0M2 12a10 10 0 0 1 20 0" /></svg>,
  roster: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>,
  ops: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  meta: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg>,
  players: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5" /></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
}
