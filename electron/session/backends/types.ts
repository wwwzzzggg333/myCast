import type { Channel, DeviceInfo } from '../types'

export interface StartOptions {
  deviceUdid?: string
  airplayName: string
}

export interface StartResult {
  /** Local HTTP viewer for USB; null when AirPlay owns its own window */
  viewerUrl: string | null
}

export interface CastBackend {
  readonly channel: Channel
  listDevices(): Promise<DeviceInfo[]>
  start(options: StartOptions): Promise<StartResult>
  stop(): Promise<void>
}
