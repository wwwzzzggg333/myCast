import type { Channel, SessionPhase } from '../../electron/session/types'

interface VideoPaneProps {
  viewerUrl: string | null | undefined
  channel: Channel | null | undefined
  phase: SessionPhase | undefined
}

export function VideoPane({ viewerUrl, channel, phase }: VideoPaneProps) {
  if (viewerUrl) {
    return (
      <div className="video-pane">
        <iframe src={viewerUrl} title="投屏画面" className="video-frame" />
      </div>
    )
  }

  if (phase === 'streaming' && channel === 'airplay') {
    return (
      <div className="video-pane video-pane-hint">
        <p>请在 iPhone 控制中心选择屏幕镜像 → myCast；画面由接收窗口显示。</p>
      </div>
    )
  }

  return (
    <div className="video-pane video-pane-empty">
      <p>选择连接方式并点击「开始投屏」</p>
    </div>
  )
}
