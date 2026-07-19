import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import {
  createUsbBackend,
  mapUsbExitCode,
  mapUsbSidecarFailure,
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
  child.exitCode = null
  child.signalCode = null
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

  it('maps exit code 5 to DEVELOPER_MODE_REQUIRED', () => {
    expect(mapUsbExitCode(5).code).toBe('DEVELOPER_MODE_REQUIRED')
  })

  it('maps missing-module stderr to UNKNOWN with pip hint', () => {
    const err = mapUsbSidecarFailure(
      4,
      'ModuleNotFoundError: No module named pymobiledevice3\n请执行: pip install -r sidecar/requirements.txt',
    )
    expect(err.code).toBe('UNKNOWN')
    expect(err.message).toMatch(/pip install|requirements\.txt/)
  })

  it('does not treat pymobiledevice3 traceback paths as missing deps', () => {
    const err = mapUsbSidecarFailure(
      5,
      'File ".../site-packages/pymobiledevice3/services/dvt/instruments/screenshot.py"\nInvalidService',
    )
    expect(err.code).toBe('DEVELOPER_MODE_REQUIRED')
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

  it('listDevices maps missing Python deps via stderr', async () => {
    const spawn: SpawnFn = () => {
      const child = fakeChild()
      queueMicrotask(() => {
        child.stderr!.emit(
          'data',
          Buffer.from('ModuleNotFoundError: No module named pymobiledevice3\n'),
        )
        child.emit('close', 4, null)
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

    await expect(backend.listDevices()).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: expect.stringMatching(/pip install|requirements\.txt/),
    })
  })

  it('start rejects when process exits immediately after READY (missed exit event)', async () => {
    const onCrash = vi.fn()
    const spawn: SpawnFn = () => {
      const child = fakeChild()
      queueMicrotask(() => {
        child.stdout!.emit('data', Buffer.from('READY http://127.0.0.1:17890/\n'))
        // Simulate exit after waitForReady removed its listener but before attachExitHandler.
        child.exitCode = 1
        child.emit('exit', 1, null)
      })
      return child
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

    await expect(backend.start({ airplayName: 'myCast' })).rejects.toMatchObject({
      code: 'BACKEND_CRASHED',
    })
    expect(onCrash).not.toHaveBeenCalled()
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

  it('exit code 3 after READY calls onDisconnect', async () => {
    const onDisconnect = vi.fn()
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
      onDisconnect,
      spawn,
      allocatePort: async () => 17890,
      killTree: async () => {},
    })

    await backend.start({ airplayName: 'myCast' })
    spawned!.emit('exit', 3, null)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onCrash).not.toHaveBeenCalled()
  })
})
