import { describe, expect, it } from 'vitest'
import { createMockBackend } from '../electron/session/backends/mock-backend'
import { CastError } from '../electron/session/errors'

describe('createMockBackend', () => {
  it('returns a viewerUrl on usb start', async () => {
    const b = createMockBackend('usb')
    const r = await b.start({ airplayName: 'myCast', deviceUdid: 'u1' })
    expect(r.viewerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
  })

  it('returns null viewerUrl on airplay start', async () => {
    const b = createMockBackend('airplay')
    const r = await b.start({ airplayName: 'myCast' })
    expect(r.viewerUrl).toBeNull()
  })

  it('can simulate DEVICE_NOT_TRUSTED', async () => {
    const b = createMockBackend('usb', { failWith: 'DEVICE_NOT_TRUSTED' })
    await expect(b.start({ airplayName: 'myCast', deviceUdid: 'u1' })).rejects.toMatchObject({
      code: 'DEVICE_NOT_TRUSTED',
    })
  })
})
