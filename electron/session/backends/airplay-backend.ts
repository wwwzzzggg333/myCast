import {

  spawn as defaultSpawn,

  type ChildProcess,

  type SpawnOptions,

} from 'node:child_process'

import fs from 'node:fs'

import { CastError } from '../errors'

import type { DeviceInfo } from '../types'

import type { CastBackend, StartOptions, StartResult } from './types'

import { killProcessTree, type SpawnFn } from './usb-backend'



const DEFAULT_STARTUP_SETTLE_MS = 1000



/** Map UxPlay stderr lines to typed cast errors. */

export function mapAirplayStderr(line: string): CastError | null {

  if (/address already in use/i.test(line) || /eaddrinuse/i.test(line)) {

    return new CastError('AIRPLAY_PORT_IN_USE', line)

  }

  return null

}



export interface AirplayBackendOptions {

  uxplayPath: string

  onCrash: () => void

  /** Injectable for tests; defaults to `child_process.spawn`. */

  spawn?: SpawnFn

  killTree?: (pid: number) => Promise<void>

  /** How long the process must stay alive before start succeeds. */

  startupSettleMs?: number

  /** Injectable for tests; defaults to `fs.existsSync`. */

  binaryExists?: (path: string) => boolean

}



export function createAirplayBackend(options: AirplayBackendOptions): CastBackend {

  return new AirplayBackend(options)

}



class AirplayBackend implements CastBackend {

  readonly channel = 'airplay' as const



  private child: ChildProcess | null = null

  private stopping = false

  private sessionActive = false

  private readonly spawn: SpawnFn

  private readonly killTree: (pid: number) => Promise<void>

  private readonly startupSettleMs: number

  private readonly binaryExists: (path: string) => boolean



  constructor(private readonly opts: AirplayBackendOptions) {

    this.spawn = opts.spawn ?? defaultSpawn

    this.killTree = opts.killTree ?? killProcessTree

    this.startupSettleMs = opts.startupSettleMs ?? DEFAULT_STARTUP_SETTLE_MS

    this.binaryExists = opts.binaryExists ?? fs.existsSync

  }



  async listDevices(): Promise<DeviceInfo[]> {

    return []

  }



  async start(options: StartOptions): Promise<StartResult> {

    await this.stop()

    this.stopping = false



    if (!this.binaryExists(this.opts.uxplayPath)) {

      throw new CastError('AIRPLAY_BINARY_MISSING', this.opts.uxplayPath)

    }



    const args = ['-n', options.airplayName, '-nh']

    const child = this.spawn(this.opts.uxplayPath, args, {

      stdio: ['ignore', 'ignore', 'pipe'],

      windowsHide: true,

    } as SpawnOptions)

    this.child = child



    try {

      await this.waitForStartup(child)

    } catch (err) {

      await this.cleanupFailedStart(child)

      throw err

    }



    this.attachStderrDrain(child)

    this.sessionActive = true

    this.attachExitHandler(child)

    return { viewerUrl: null }

  }



  private async cleanupFailedStart(child: ChildProcess): Promise<void> {

    const pid = child.pid

    if (pid != null) await this.killTree(pid)

    try {

      child.kill()

    } catch {

      // already dead

    }

    if (this.child === child) this.child = null

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



  private waitForStartup(child: ChildProcess): Promise<void> {

    return new Promise((resolve, reject) => {

      let settled = false

      let stderrBuffer = ''

      let settleTimer: ReturnType<typeof setTimeout> | null = null



      const cleanup = () => {

        child.stderr?.off('data', onStderr)

        child.off('exit', onExit)

        child.off('error', onError)

        if (settleTimer != null) clearTimeout(settleTimer)

      }



      const settle = (fn: () => void) => {

        if (settled) return

        settled = true

        cleanup()

        fn()

      }



      const fail = (err: CastError) => {

        settle(() => reject(err))

      }



      const onStderr = (chunk: Buffer | string) => {

        stderrBuffer += chunk.toString()

        const lines = stderrBuffer.split(/\r?\n/)

        stderrBuffer = lines.pop() ?? ''

        for (const line of lines) {

          const mapped = mapAirplayStderr(line)

          if (mapped) {

            fail(mapped)

            return

          }

        }

      }



      const onExit = (code: number | null) => {

        for (const line of stderrBuffer.split(/\r?\n/)) {

          const mapped = mapAirplayStderr(line)

          if (mapped) {

            fail(mapped)

            return

          }

        }

        fail(new CastError('BACKEND_CRASHED', `exit ${code}`))

      }



      const onError = (err: Error) => {

        fail(new CastError('UNKNOWN', err.message))

      }



      child.stderr?.on('data', onStderr)

      child.once('exit', onExit)

      child.once('error', onError)



      settleTimer = setTimeout(() => {

        settle(() => resolve())

      }, this.startupSettleMs)

    })

  }



  private attachStderrDrain(child: ChildProcess): void {

    child.stderr?.on('data', (chunk: Buffer | string) => {

      for (const line of chunk.toString().split(/\r?\n/)) {

        if (line) mapAirplayStderr(line)

      }

    })

  }



  private attachExitHandler(child: ChildProcess): void {

    child.once('exit', () => {

      const shouldNotify = this.sessionActive && !this.stopping

      if (this.child === child) this.child = null

      this.sessionActive = false

      if (shouldNotify) this.opts.onCrash()

    })

  }

}


