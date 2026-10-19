import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('rs', { version: '0.1.0' })
