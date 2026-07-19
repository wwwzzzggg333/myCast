import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import {
  createUsbBackend,
  mapUsbExitCode,
  parseReadyLine,
  type SpawnFn,
} from '../electron/session/backends/usb-backend'

function fakeChild(): ChildProcess & EventEmitter {
  const child = new EventEmitter() as ChildProcess & EventEmitter
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  child.stdout = stdout as ChildProcess['stdout']
  child.stderr = stderr as ChildProcess['stderr']
  child.pid = 4242
  child.kill = vi.fn(() => true) as ChildProcess['kill']
  return child
}

describe('usb sidecar protocol', () => {
  it('parses READY line', () => {
    expect(parseReadyLine('READY http://127.0.0.1:17890/')).toBe('http://127.0.0.1:17890/')
  })

  it('maps exit code 2 to DEVICE_NOT_TRUSTED', () => {
    expect(mapUsbExitCode(2).code).toBe('DEVICE_NOT_TRUSTED')
  })

  it('maps exit code 3 to NO_DEVICE', () => {
    expect(mapUsbExitCode(3).code).toBe('NO_DEVICE')
  })

  it('maps exit code 4 to DRIVER_MISSING', () => {
    expect(mapUsbExitCode(4).code).toBe('DRIVER_MISSING')
  })
})

describe('UsbBackend spawn lifecycle', () => {
  it('start resolves when READY is printed', async () => {
    let spawned: (ChildProcess & EventEmitter) | null = null
    const spawn: SpawnFn = () => {
      spawned = fakeChild()
      queueMicrotask(() => {
        spawned!.stdout!.emit('data', Buffer.from('READY http://127.0.0.1:17890/\n'))
      })
      return spawned
    }

    const backend = createUsbBackend({
      pythonPath: 'python',
      scriptPath: 'usb_mirror.py',
      onCrash: () => {},
      onDisconnect: () => {},
      spawn,
      allocatePort: async () => 17890,
      killTree: async () => {},
    })

    const result = await backend.start({ airplayName: 'myCast', deviceUdid: 'abc' })
    expect(result.viewerUrl).toBe('http://127.0.0.1:17890/')
  })

  it('start rejects with mapped exit code when process exits before READY', async () => {
    const spawn: SpawnFn = () => {
      const child = fakeChild()
      queueMicrotask(() => {
        child.emit('exit', 2, null)
        child.emit('close', 2, null)
      })
      return child
    }

    const backend = createUsbBackend({
      pythonPath: 'python',
      scriptPath: 'usb_mirror.py',
      onCrash: () => {},
      onDisconnect: () => {},
      spawn,
      allocatePort: async () => 17890,
      killTree: async () => {},
    })

    await expect(backend.start({ airplayName: 'myCast' })).rejects.toMatchObject({
      code: 'DEVICE_NOT_TRUSTED',
    })
  })

  it('listDevices parses JSON from list command', async () => {
    const spawn: SpawnFn = (_cmd, args) => {
      const child = fakeChild()
      expect(args).toContain('list')
      queueMicrotask(() => {
        child.stdout!.emit(
          'data',
          Buffer.from(
            JSON.stringify([
              { udid: 'u1', name: 'iPhone', connectionType: 'usb' },
            ]),
          ),
        )
        child.emit('close', 0, null)
      })
      return child
    }

    const backend = createUsbBackend({
      pythonPath: 'python',
      scriptPath: 'usb_mirror.py',
      onCrash: () => {},
      onDisconnect: () => {},
      spawn,
    })

    await expect(backend.listDevices()).resolves.toEqual([
      { udid: 'u1', name: 'iPhone', connectionType: 'usb' },
    ])
  })

  it('unexpected exit after READY calls onCrash', async () => {
    const onCrash = vi.fn()
    let spawned: (ChildProcess & EventEmitter) | null = null
    const spawn: SpawnFn = () => {
      spawned = fakeChild()
      queueMicrotask(() => {
        spawned!.stdout!.emit('data', Buffer.from('READY http://127.0.0.1:17890/\n'))
      })
      return spawned
    }

    const backend = createUsbBackend({
      pythonPath: 'python',
      scriptPath: 'usb_mirror.py',
      onCrash,
      onDisconnect: () => {},
      spawn,
      allocatePort: async () => 17890,
      killTree: async () => {},
    })

    await backend.start({ airplayName: 'myCast' })
    spawned!.emit('exit', 1, null)
    expect(onCrash).toHaveBeenCalledTimes(1)
  })
})
