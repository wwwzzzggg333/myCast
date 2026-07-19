import { useCallback, useEffect, useState } from 'react'
import { ChannelPicker } from './components/ChannelPicker'
import { DevicePanel } from './components/DevicePanel'
import { StatusBar } from './components/StatusBar'
import { VideoPane } from './components/VideoPane'
import { useSession } from './hooks/useSession'
import { api } from './lib/ipc'
import type { Channel } from '../electron/session/types'

export function App() {
  const session = useSession()
  const [channel, setChannel] = useState<Channel>('usb')
  const [selectedUdid, setSelectedUdid] = useState<string | null>(null)
  const [airplayName, setAirplayName] = useState('myCast')
  const [usbDeviceCount, setUsbDeviceCount] = useState(0)
  const [busy, setBusy] = useState(false)

  const phase = session?.phase
  const isActive = phase === 'connecting' || phase === 'streaming' || phase === 'stopping'
  const controlsDisabled = isActive || busy

  useEffect(() => {
    void api()
      .listUsbDevices()
      .then((devices) => setUsbDeviceCount(devices.length))
  }, [phase])

  const handleStart = useCallback(async () => {
    setBusy(true)
    try {
      await api().start(channel, {
        deviceUdid: channel === 'usb' ? (selectedUdid ?? undefined) : undefined,
        airplayName,
      })
    } catch {
      // error state reflected via session snapshot
    } finally {
      setBusy(false)
    }
  }, [channel, selectedUdid, airplayName])

  const handleStop = useCallback(async () => {
    setBusy(true)
    try {
      await api().stop()
    } finally {
      setBusy(false)
    }
  }, [])

  const handleRetry = useCallback(async () => {
    await handleStart()
  }, [handleStart])

  const showUsbHint =
    phase === 'idle' && usbDeviceCount > 0 && channel !== 'usb'

  const canStart =
    !controlsDisabled &&
    (channel === 'airplay' || (channel === 'usb' && selectedUdid !== null))

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="app-title">myCast</h1>
        <ChannelPicker value={channel} onChange={setChannel} disabled={controlsDisabled} />
        <DevicePanel
          channel={channel}
          selectedUdid={selectedUdid}
          onSelectUdid={setSelectedUdid}
          airplayName={airplayName}
          onAirplayNameChange={setAirplayName}
          disabled={controlsDisabled}
        />
        {showUsbHint && <p className="usb-hint">推荐使用 USB（通常更稳）</p>}
        <div className="controls">
          <button type="button" className="btn-primary" disabled={!canStart} onClick={() => void handleStart()}>
            开始投屏
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!isActive || busy}
            onClick={() => void handleStop()}
          >
            停止
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={phase !== 'error' || busy}
            onClick={() => void handleRetry()}
          >
            重试
          </button>
        </div>
      </aside>
      <main className="workspace">
        <VideoPane viewerUrl={session?.viewerUrl} channel={session?.channel ?? channel} phase={phase} />
      </main>
      <StatusBar phase={phase} errorMessage={session?.errorMessage} />
    </div>
  )
}
