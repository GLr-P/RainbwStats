// Persistent Windows OCR worker: one PowerShell process using the built-in Windows.Media.Ocr
// engine (no downloads, no native modules). Send a PNG path, receive the recognized lines.
import { constants, setPriority } from 'node:os'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve as resolvePath } from 'node:path'

const SCRIPT = `
$ErrorActionPreference = 'Stop'
# UTF-8 both ways: OEM code pages turn OCR'd non-ASCII text into control bytes that break the JSON,
# and paths can contain non-ASCII user names.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RsFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'
[Console]::Out.WriteLine('READY')
while ($true) {
  $path = [Console]::In.ReadLine()
  if ($null -eq $path) { break }
  if ($path -eq '?fg') {
    # Process name of the foreground window (OCR only runs while Siege is in front).
    $procId = [uint32]0
    [void][RsFg]::GetWindowThreadProcessId([RsFg]::GetForegroundWindow(), [ref]$procId)
    $name = ''
    try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @($name)))
    continue
  }
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    # Screen captures are 24-bit RGB PNGs; OcrEngine silently returns nothing unless it gets BGRA8.
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $stream.Dispose()
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @($result.Lines | ForEach-Object { $_.Text })))
  } catch { [Console]::Error.WriteLine($_.Exception.Message); [Console]::Out.WriteLine('[]') }
}
`

export class OcrWorker {
  private proc: ChildProcessWithoutNullStreams | null = null
  private queue: ((lines: string[]) => void)[] = []
  private ready: Promise<void> | null = null

  private boot(): Promise<void> {
    if (this.ready) return this.ready
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true })
    this.proc = proc
    // Never compete with the game for CPU.
    try { if (proc.pid) setPriority(proc.pid, constants.priority.PRIORITY_BELOW_NORMAL) } catch { /* not allowed: keep default */ }
    const rl = createInterface({ input: proc.stdout })
    if (process.env['RS_OCR_DEBUG']) proc.stderr.pipe(process.stderr)
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('OCR worker did not start')), 15000)
      rl.on('line', (line) => {
        if (line === 'READY') { clearTimeout(timer); resolve(); return }
        let lines: string[] = []
        try { const v: unknown = JSON.parse(line.replace(/[\u0000-\u001f]/g, ' ')); lines = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [] } catch (e) { if (process.env['RS_OCR_DEBUG']) console.error('OCR-PARSE', (e as Error).message) }
        this.queue.shift()?.(lines)
      })
    })
    proc.on('exit', () => { this.proc = null; this.ready = null; for (const q of this.queue.splice(0)) q([]) })
    return this.ready
  }

  async recognize(pngPath: string): Promise<string[]> {
    await this.boot()
    return new Promise((resolve) => {
      this.queue.push(resolve)
      this.proc?.stdin.write(resolvePath(pngPath) + '\n') // WinRT needs backslash paths
    })
  }

  /** Process name of the window in the foreground (e.g. "RainbowSix"), '' if unknown. */
  async foreground(): Promise<string> {
    await this.boot()
    return new Promise((resolve) => {
      this.queue.push((lines) => resolve(lines[0] ?? ''))
      this.proc?.stdin.write('?fg\n')
    })
  }

  dispose(): void { this.proc?.kill(); this.proc = null; this.ready = null }
}
