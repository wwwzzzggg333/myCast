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
  if (!window.mycast) {
    throw new Error(
      'preload 未注入 window.mycast。请确认 Electron sandbox=false 且 preload 已加载（DevTools Console 可查）。',
    )
  }
  return window.mycast
}

export function hasMycastApi(): boolean {
  return typeof window.mycast?.getSession === 'function'
}

/** Strip Electron IPC invoke wrapper so UI can show the Chinese CastError message. */
export function formatIpcInvokeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const m = raw.match(
    /Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]+)$/i,
  )
  const msg = (m?.[1] ?? raw).trim()
  return msg || '操作失败，请重试。'
}
