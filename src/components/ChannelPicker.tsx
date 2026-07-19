import type { Channel } from '../../electron/session/types'

interface ChannelPickerProps {
  value: Channel
  onChange: (channel: Channel) => void
  disabled?: boolean
}

export function ChannelPicker({ value, onChange, disabled }: ChannelPickerProps) {
  return (
    <div className="channel-picker">
      <span className="panel-label">连接方式</span>
      <div className="channel-options">
        <label className={value === 'usb' ? 'channel-option active' : 'channel-option'}>
          <input
            type="radio"
            name="channel"
            value="usb"
            checked={value === 'usb'}
            disabled={disabled}
            onChange={() => onChange('usb')}
          />
          USB
        </label>
        <label className={value === 'airplay' ? 'channel-option active' : 'channel-option'}>
          <input
            type="radio"
            name="channel"
            value="airplay"
            checked={value === 'airplay'}
            disabled={disabled}
            onChange={() => onChange('airplay')}
          />
          AirPlay
        </label>
      </div>
    </div>
  )
}
