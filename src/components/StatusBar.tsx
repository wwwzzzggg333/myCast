import type { SessionPhase } from '../../electron/session/types'

const PHASE_LABELS: Record<SessionPhase, string> = {
  idle: '空闲',
  connecting: '连接中',
  streaming: '投屏中',
  stopping: '停止中',
  error: '错误',
}

interface StatusBarProps {
  phase: SessionPhase | undefined
  errorMessage: string | null | undefined
}

export function StatusBar({ phase, errorMessage }: StatusBarProps) {
  const label = phase ? PHASE_LABELS[phase] : '…'

  return (
    <footer className="status-bar">
      <span className="status-phase">状态：{label}</span>
      {errorMessage && <span className="status-error">{errorMessage}</span>}
    </footer>
  )
}
