import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import type { Channel, DeviceInfo } from '../../electron/session/types'

interface DevicePanelProps {
  channel: Channel
  selectedUdid: string | null
  onSelectUdid: (udid: string | null) => void
  airplayName: string
  onAirplayNameChange: (name: string) => void
  onUsbDeviceCountChange?: (count: number) => void
  disabled?: boolean
}

export function DevicePanel({
  channel,
  selectedUdid,
  onSelectUdid,
  airplayName,
  onAirplayNameChange,
  onUsbDeviceCountChange,
  disabled,
}: DevicePanelProps) {
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api().listUsbDevices()
      setDevices(list)
      onUsbDeviceCountChange?.(list.length)
      if (list.length === 1) {
        onSelectUdid(list[0].udid)
      } else if (selectedUdid && !list.some((d) => d.udid === selectedUdid)) {
        onSelectUdid(null)
      }
    } finally {
      setLoading(false)
    }
  }, [onSelectUdid, onUsbDeviceCountChange, selectedUdid])

  useEffect(() => {
    if (channel === 'usb') {
      void refresh()
    }
  }, [channel, refresh])

  if (channel === 'airplay') {
    return (
      <div className="device-panel">
        <label className="field">
          <span className="panel-label">接收名称</span>
          <input
            type="text"
            value={airplayName}
            disabled={disabled}
            onChange={(e) => onAirplayNameChange(e.target.value)}
            placeholder="myCast"
          />
        </label>
        <p className="hint">iPhone 屏幕镜像时将显示此名称</p>
      </div>
    )
  }

  return (
    <div className="device-panel">
      <div className="device-panel-header">
        <span className="panel-label">USB 设备</span>
        <button type="button" className="btn-secondary" disabled={disabled || loading} onClick={() => void refresh()}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>
      {devices.length === 0 ? (
        <p className="hint">未检测到设备，请连接 iPhone 后刷新</p>
      ) : (
        <ul className="device-list">
          {devices.map((d) => (
            <li key={d.udid}>
              <label className={selectedUdid === d.udid ? 'device-item active' : 'device-item'}>
                <input
                  type="radio"
                  name="device"
                  value={d.udid}
                  checked={selectedUdid === d.udid}
                  disabled={disabled}
                  onChange={() => onSelectUdid(d.udid)}
                />
                <span className="device-name">{d.name}</span>
                <span className="device-udid">{d.udid}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
