import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type LiveState, type RsApi } from '../shared/ipc'

const api = Object.fromEntries(API_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`rs:${m}`, ...args)])) as Omit<RsApi, 'onLive'>

contextBridge.exposeInMainWorld('rs', {
  ...api,
  onLive: (cb: (s: LiveState) => void) => {
    const h = (_e: unknown, s: LiveState) => cb(s)
    ipcRenderer.on('rs:live', h)
    return () => ipcRenderer.removeListener('rs:live', h)
  }
} satisfies RsApi)
