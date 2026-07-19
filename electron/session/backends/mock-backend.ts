import type { CastBackend, StartOptions, StartResult } from './types'
import type { Channel, DeviceInfo } from '../types'
import { CastError, type CastErrorCode } from '../errors'

export interface MockBackendOptions {
  failWith?: CastErrorCode
  devices?: DeviceInfo[]
}

export function createMockBackend(channel: Channel, opts: MockBackendOptions = {}): CastBackend {
  let running = false
  return {
    channel,
    async listDevices() {
      return (
        opts.devices ?? [
          { udid: 'mock-udid', name: 'Mock iPhone', connectionType: 'usb' },
        ]
      )
    },
    async start(_options: StartOptions): Promise<StartResult> {
      if (opts.failWith) throw new CastError(opts.failWith, 'mock failure')
      running = true
      return {
        viewerUrl: channel === 'usb' ? 'http://127.0.0.1:17890/' : null,
      }
    },
    async stop() {
      running = false
    },
  }
}
