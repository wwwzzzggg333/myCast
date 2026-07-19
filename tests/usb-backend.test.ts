import { describe, expect, it } from 'vitest'
import { mapUsbExitCode, parseReadyLine } from '../electron/session/backends/usb-backend'

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
