import type { Channel, DeviceInfo, SessionSnapshot } from '../../electron/session/types'

export interface MycastApi {
  getSession(): Promise<SessionSnapshot>
  listUsbDevices(): Promise<DeviceInfo[]>
  start(channel: Channel, options: { deviceUdid?: string; airplayName: string }): Promise<SessionSnapshot>
  stop(): Promise<SessionSnapshot>
  onSessionChanged(cb: (s: SessionSnapshot) => void): () => void
}

declare global {
  interface Window {
    mycast: MycastApi
  }
}

export function api(): MycastApi {
  return window.mycast
}
