export type CastErrorCode =
  | 'DEVICE_NOT_TRUSTED'
  | 'DRIVER_MISSING'
  | 'AIRPLAY_PORT_IN_USE'
  | 'FIREWALL_BLOCKED'
  | 'BACKEND_CRASHED'
  | 'DISCONNECTED'
  | 'NO_DEVICE'
  | 'UNKNOWN'

export class CastError extends Error {
  readonly code: CastErrorCode
  constructor(code: CastErrorCode, detail?: string) {
    super(detail ?? code)
    this.code = code
    this.name = 'CastError'
  }
}

const MESSAGES: Record<CastErrorCode, string> = {
  DEVICE_NOT_TRUSTED: '请在 iPhone 上点「信任此电脑」，然后重试。',
  DRIVER_MISSING:
    '未检测到 Apple 设备支持组件。请安装 Microsoft Store 版 iTunes（或 Apple Mobile Device Support）后重试。',
  AIRPLAY_PORT_IN_USE: 'AirPlay 端口或名称冲突。请关闭占用程序，或在设置里更换接收名称后重试。',
  FIREWALL_BLOCKED: '可能被防火墙拦截。请允许 myCast 通过专用/专用网络，并放行相关组播发现。',
  BACKEND_CRASHED: '投屏异常退出。请点击重试；若反复失败，请重新插拔 USB 或重启 App。',
  DISCONNECTED: '连接已断开。',
  NO_DEVICE: '未检测到 iPhone。请确认 USB 已连接且手机已解锁。',
  UNKNOWN: '发生未知错误，请重试。',
}

export function toUserMessage(error: CastError): string {
  return MESSAGES[error.code] ?? MESSAGES.UNKNOWN
}
