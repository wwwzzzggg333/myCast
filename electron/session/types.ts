export type Channel = 'usb' | 'airplay'

export type SessionPhase =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'stopping'
  | 'error'

export interface DeviceInfo {
  udid: string
  name: string
  connectionType: 'usb' | 'network'
}

export interface SessionSnapshot {
  phase: SessionPhase
  channel: Channel | null
  device: DeviceInfo | null
  viewerUrl: string | null
  airplayName: string
  errorMessage: string | null
}
