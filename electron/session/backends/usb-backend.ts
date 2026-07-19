import {
  spawn as defaultSpawn,
  execFile,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import { CastError } from '../errors'
import type { DeviceInfo } from '../types'
import type { CastBackend, StartOptions, StartResult } from './types'

const execFileAsync = promisify(execFile)

/** Parse sidecar stdout READY line → viewer URL. */
export function parseReadyLine(line: string): string | null {
  const m = line.trim().match(/^READY\s+(http:\/\/\S+)/i)
  return m?.[1] ?? null
}

export function mapUsbExitCode(code: number | null): CastError {
  if (code === 2) return new CastError('DEVICE_NOT_TRUSTED')
  if (code === 3) return new CastError('NO_DEVICE')
  if (code === 4) return new CastError('DRIVER_MISSING')
  return new CastError('BACKEND_CRASHED', `exit ${code}`)
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => ChildProcess

export interface UsbBackendOptions {
  pythonPath: string
  scriptPath: string
  onCrash: () => void
  onDisconnect: () => void
  /** Injectable for tests; defaults to `child_process.spawn`. */
  spawn?: SpawnFn
  allocatePort?: () => Promise<number>
  killTree?: (pid: number) => Promise<void>
}

export async function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('failed to allocate port'))
        return
      }
      const { port } = addr
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
    server.on('error', reject)
  })
}

export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'])
    } catch {
      // Process may already have exited.
    }
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Process may already have exited.
  }
}

export function createUsbBackend(options: UsbBackendOptions): CastBackend {
  return new UsbBackend(options)
}

class UsbBackend implements CastBackend {
  readonly channel = 'usb' as const

  private child: ChildProcess | null = null
  private stopping = false
  private sessionActive = false
  private readonly spawn: SpawnFn
  private readonly allocatePort: () => Promise<number>
  private readonly killTree: (pid: number) => Promise<void>

  constructor(private readonly opts: UsbBackendOptions) {
    this.spawn = opts.spawn ?? defaultSpawn
    this.allocatePort = opts.allocatePort ?? allocateFreePort
    this.killTree = opts.killTree ?? killProcessTree
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const { stdout, code } = await this.runToCompletion(['list'])
    if (code !== 0) throw mapUsbExitCode(code)
    const trimmed = stdout.trim()
    if (!trimmed) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new CastError('UNKNOWN', 'invalid device list JSON')
    }
    if (!Array.isArray(parsed)) throw new CastError('UNKNOWN', 'device list is not an array')
    return parsed.map((raw) => {
      const d = raw as Partial<DeviceInfo>
      return {
        udid: String(d.udid ?? ''),
        name: String(d.name ?? d.udid ?? ''),
        connectionType: d.connectionType === 'network' ? 'network' : 'usb',
      }
    })
  }

  async start(options: StartOptions): Promise<StartResult> {
    await this.stop()
    this.stopping = false

    const port = await this.allocatePort()
    const args = [this.opts.scriptPath, 'serve', '--port', String(port)]
    if (options.deviceUdid) {
      args.push('--udid', options.deviceUdid)
    }

    const child = this.spawn(this.opts.pythonPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child

    const viewerUrl = await this.waitForReady(child)
    this.sessionActive = true
    this.attachExitHandler(child)
    return { viewerUrl }
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      this.sessionActive = false
      return
    }
    if (this.stopping) return

    this.stopping = true
    this.sessionActive = false
    const pid = child.pid

    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      child.once('exit', done)
      child.once('close', done)

      const kill = async () => {
        if (pid != null) await this.killTree(pid)
        try {
          child.kill()
        } catch {
          // already dead
        }
      }
      void kill().finally(() => {
        setTimeout(done, 5000)
      })
    })

    if (this.child === child) this.child = null
    this.stopping = false
  }

  private waitForReady(child: ChildProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = ''
      let settled = false

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        child.stdout?.off('data', onStdout)
        child.off('exit', onExit)
        child.off('error', onError)
        fn()
      }

      const onStdout = (chunk: Buffer | string) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const url = parseReadyLine(line)
          if (url) {
            settle(() => resolve(url))
            return
          }
        }
      }

      const onExit = (code: number | null) => {
        settle(() => reject(mapUsbExitCode(code)))
      }

      const onError = (err: Error) => {
        settle(() => reject(new CastError('UNKNOWN', err.message)))
      }

      if (!child.stdout) {
        settle(() => reject(new CastError('UNKNOWN', 'sidecar stdout unavailable')))
        return
      }
      child.stdout.on('data', onStdout)
      child.once('exit', onExit)
      child.once('error', onError)
    })
  }

  private attachExitHandler(child: ChildProcess): void {
    child.once('exit', (code) => {
      const shouldNotify = this.sessionActive && !this.stopping
      if (this.child === child) this.child = null
      this.sessionActive = false
      if (!shouldNotify) return
      if (code === 3) this.opts.onDisconnect()
      else this.opts.onCrash()
    })
  }

  private runToCompletion(
    args: string[],
  ): Promise<{ stdout: string; code: number | null }> {
    return new Promise((resolve, reject) => {
      const child = this.spawn(this.opts.pythonPath, [this.opts.scriptPath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString()
      })
      child.on('error', (err) => reject(new CastError('UNKNOWN', err.message)))
      child.on('close', (code) => resolve({ stdout, code }))
    })
  }
}
