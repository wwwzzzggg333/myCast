import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { createAirplayBackend, mapAirplayStderr } from '../electron/session/backends/airplay-backend'
import type { SpawnFn } from '../electron/session/backends/usb-backend'
import { CastError } from '../electron/session/errors'

function fakeChild(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  child.stdout = stdout as ChildProcess['stdout']
  child.stderr = stderr as ChildProcess['stderr']
  child.pid = 5151
  child.kill = vi.fn(() => true) as ChildProcess['kill']
  return child
}

describe('mapAirplayStderr', () => {
  it('detects port in use', () => {
    expect(mapAirplayStderr('bind: Address already in use')).toBeInstanceOf(CastError)
    expect(mapAirplayStderr('bind: Address already in use')?.code).toBe('AIRPLAY_PORT_IN_USE')
  })

  it('returns null for unrelated logs', () => {
    expect(mapAirplayStderr('Initialized GStreamer')).toBeNull()
  })
})

describe('AirplayBackend', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('throws AIRPLAY_BINARY_MISSING when uxplay is absent', async () => {
    const backend = createAirplayBackend({
      uxplayPath: 'vendor/uxplay/uxplay.exe',
      onCrash: () => {},
      binaryExists: () => false,
    })

    await expect(backend.start({ airplayName: 'myCast' })).rejects.toMatchObject({
      code: 'AIRPLAY_BINARY_MISSING',
    })
  })

  it('start resolves with null viewerUrl after settle period', async () => {
    const spawn: SpawnFn = () => fakeChild()
    const backend = createAirplayBackend({
      uxplayPath: 'uxplay.exe',
      onCrash: () => {},
      spawn,
      killTree: async () => {},
      startupSettleMs: 100,
      binaryExists: () => true,
    })

    const resultPromise = backend.start({ airplayName: 'myCast' })
    await vi.advanceTimersByTimeAsync(100)
    await expect(resultPromise).resolves.toEqual({ viewerUrl: null })
  })

  it('start rejects on port-in-use stderr', async () => {
    let spawned: (ChildProcess & EventEmitter) | null = null
    const killTree = vi.fn(async () => {})
    const spawn: SpawnFn = () => {
      spawned = fakeChild()
      queueMicrotask(() => {
        spawned!.stderr!.emit('data', Buffer.from('bind: Address already in use\n'))
      })
      return spawned
    }

    const backend = createAirplayBackend({
      uxplayPath: 'uxplay.exe',
      onCrash: () => {},
      spawn,
      killTree,
      startupSettleMs: 1000,
      binaryExists: () => true,
    })

    await expect(backend.start({ airplayName: 'myCast' })).rejects.toMatchObject({
      code: 'AIRPLAY_PORT_IN_USE',
    })

    expect(killTree).toHaveBeenCalledWith(5151)
    expect(spawned!.kill).toHaveBeenCalled()
  })

  it('clears child after start failure so a retry can spawn again', async () => {
    let spawnCount = 0
    const killTree = vi.fn(async () => {})
    const spawn: SpawnFn = () => {
      spawnCount += 1
      const child = fakeChild()
      if (spawnCount === 1) {
        queueMicrotask(() => {
          child.stderr!.emit('data', Buffer.from('bind: Address already in use\n'))
        })
      }
      return child
    }

    const backend = createAirplayBackend({
      uxplayPath: 'uxplay.exe',
      onCrash: () => {},
      spawn,
      killTree,
      startupSettleMs: 50,
      binaryExists: () => true,
    })

    await expect(backend.start({ airplayName: 'myCast' })).rejects.toMatchObject({
      code: 'AIRPLAY_PORT_IN_USE',
    })
    expect(killTree).toHaveBeenCalledTimes(1)

    const retryPromise = backend.start({ airplayName: 'myCast' })
    await vi.advanceTimersByTimeAsync(50)
    await expect(retryPromise).resolves.toEqual({ viewerUrl: null })
    expect(spawnCount).toBe(2)
  })

  it('spawns uxplay with name and no-hud flags', async () => {
    let cmd = ''
    let args: readonly string[] = []
    let stdio: unknown
    const spawn: SpawnFn = (command, spawnArgs, options) => {
      cmd = command
      args = spawnArgs
      stdio = options?.stdio
      return fakeChild()
    }

    const backend = createAirplayBackend({
      uxplayPath: 'C:\\uxplay\\uxplay.exe',
      onCrash: () => {},
      spawn,
      killTree: async () => {},
      startupSettleMs: 50,
      binaryExists: () => true,
    })

    const resultPromise = backend.start({ airplayName: 'myCast' })
    await vi.advanceTimersByTimeAsync(50)
    await resultPromise

    expect(cmd).toBe('C:\\uxplay\\uxplay.exe')
    expect(args).toEqual(['-n', 'myCast', '-nh'])
    expect(stdio).toEqual(['ignore', 'ignore', 'pipe'])
  })

  it('unexpected exit after start calls onCrash', async () => {
    const onCrash = vi.fn()
    let spawned: (ChildProcess & EventEmitter) | null = null
    const spawn: SpawnFn = () => {
      spawned = fakeChild()
      return spawned
    }

    const backend = createAirplayBackend({
      uxplayPath: 'uxplay.exe',
      onCrash,
      spawn,
      killTree: async () => {},
      startupSettleMs: 10,
      binaryExists: () => true,
    })

    const startPromise = backend.start({ airplayName: 'myCast' })
    await vi.advanceTimersByTimeAsync(10)
    await startPromise
    spawned!.emit('exit', 1, null)
    expect(onCrash).toHaveBeenCalledTimes(1)
  })
})
