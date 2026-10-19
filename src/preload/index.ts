import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type LiveState, type RsApi, type UpdateStatus } from '../shared/ipc'

const api = Object.fromEntries(API_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`rs:${m}`, ...args)])) as Omit<RsApi, 'onLive' | 'onUpdate'>

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: unknown, v: T) => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

contextBridge.exposeInMainWorld('rs', {
  ...api,
  onLive: (cb: (s: LiveState) => void) => on('rs:live', cb),
  onUpdate: (cb: (s: UpdateStatus) => void) => on('rs:update', cb)
} satisfies RsApi)
