// Credentials and Ubisoft sessions, encrypted with Electron safeStorage (Windows DPAPI).
// If encryption is unavailable we keep the password in memory only and never write it to disk.
import { safeStorage } from 'electron'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Credentials, StoredAuth } from './ubi/client'

export class SecureStore {
  private readonly dir: string
  private memCreds: Credentials | null = null
  constructor(dir: string) { this.dir = dir }

  private read<T>(name: string): T | null {
    const p = join(this.dir, name)
    if (!existsSync(p) || !safeStorage.isEncryptionAvailable()) return null
    try { return JSON.parse(safeStorage.decryptString(readFileSync(p))) as T } catch { return null }
  }
  private write(name: string, value: unknown): void {
    if (!safeStorage.isEncryptionAvailable()) return
    writeFileSync(join(this.dir, name), safeStorage.encryptString(JSON.stringify(value)))
  }

  loadCredentials = (): Credentials | null => this.memCreds ?? this.read<Credentials>('creds.bin')
  saveCredentials(c: Credentials): void { this.memCreds = c; this.write('creds.bin', c) }
  loadAuth = (): StoredAuth => this.read<StoredAuth>('auth.bin') ?? {}
  saveAuth = (a: StoredAuth): void => this.write('auth.bin', a)
  clear(): void {
    this.memCreds = null
    for (const f of ['creds.bin', 'auth.bin']) rmSync(join(this.dir, f), { force: true })
  }
}
