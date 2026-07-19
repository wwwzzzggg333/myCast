import { describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../electron/session/session-manager'
import type { CastBackend, StartResult } from '../electron/session/backends/types'
import { CastError } from '../electron/session/errors'

function makeBackend(channel: 'usb' | 'airplay', startImpl?: () => Promise<StartResult>): CastBackend {
  return {
    channel,
    listDevices: vi.fn(async () => [{ udid: 'u1', name: 'iPhone', connectionType: 'usb' as const }]),
    start: vi.fn(startImpl ?? (async () => ({ viewerUrl: 'http://127.0.0.1:17890/' }))),
    stop: vi.fn(async () => {}),
  }
}

describe('SessionManager', () => {
  it('starts usb session idle → connecting → streaming', async () => {
    const usb = makeBackend('usb')
    const airplay = makeBackend('airplay')
    const sm = new SessionManager({ usb, airplay })
    const phases: string[] = []
    sm.onChange((s) => phases.push(s.phase))

    await sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })

    expect(sm.getSnapshot().phase).toBe('streaming')
    expect(sm.getSnapshot().channel).toBe('usb')
    expect(sm.getSnapshot().viewerUrl).toBe('http://127.0.0.1:17890/')
    expect(phases).toContain('connecting')
    expect(phases).toContain('streaming')
  })

  it('rejects starting a second session while streaming', async () => {
    const sm = new SessionManager({
      usb: makeBackend('usb'),
      airplay: makeBackend('airplay'),
    })
    await sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })
    await expect(sm.start('airplay', { airplayName: 'myCast' })).rejects.toThrow(/active session/i)
  })

  it('stop returns to idle and calls backend.stop', async () => {
    const usb = makeBackend('usb')
    const sm = new SessionManager({ usb, airplay: makeBackend('airplay') })
    await sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })
    await sm.stop()
    expect(sm.getSnapshot().phase).toBe('idle')
    expect(usb.stop).toHaveBeenCalled()
  })

  it('maps backend start failure to error phase with user message', async () => {
    const usb = makeBackend('usb', async () => {
      throw new CastError('DEVICE_NOT_TRUSTED', 'pair')
    })
    const sm = new SessionManager({ usb, airplay: makeBackend('airplay') })
    await expect(sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })).rejects.toBeInstanceOf(CastError)
    expect(sm.getSnapshot().phase).toBe('error')
    expect(sm.getSnapshot().errorMessage).toContain('信任')
  })

  it('notifyDisconnected moves streaming → error with DISCONNECTED copy', async () => {
    const sm = new SessionManager({
      usb: makeBackend('usb'),
      airplay: makeBackend('airplay'),
    })
    await sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })
    sm.notifyDisconnected()
    expect(sm.getSnapshot().phase).toBe('error')
    expect(sm.getSnapshot().errorMessage).toContain('断开')
  })

  it('notifyBackendCrashed maps to BACKEND_CRASHED copy', async () => {
    const sm = new SessionManager({
      usb: makeBackend('usb'),
      airplay: makeBackend('airplay'),
    })
    await sm.start('airplay', { airplayName: 'myCast' })
    sm.notifyBackendCrashed()
    expect(sm.getSnapshot().errorMessage).toMatch(/异常|重试/)
  })
})
