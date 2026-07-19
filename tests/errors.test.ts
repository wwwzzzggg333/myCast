import { describe, expect, it } from 'vitest'
import { CastError, toUserMessage } from '../electron/session/errors'

describe('toUserMessage', () => {
  it('maps DEVICE_NOT_TRUSTED to Chinese trust instructions', () => {
    const err = new CastError('DEVICE_NOT_TRUSTED', 'pair dialog pending')
    expect(toUserMessage(err)).toContain('信任')
  })

  it('maps DRIVER_MISSING to Apple device support hint', () => {
    const err = new CastError('DRIVER_MISSING', 'Apple Mobile Device Support not found')
    expect(toUserMessage(err)).toMatch(/iTunes|Apple/)
  })

  it('maps DEVELOPER_MODE_REQUIRED to developer mode hint', () => {
    const err = new CastError('DEVELOPER_MODE_REQUIRED')
    expect(toUserMessage(err)).toMatch(/开发者模式/)
  })

  it('maps AIRPLAY_BINARY_MISSING to install hint', () => {
    const err = new CastError('AIRPLAY_BINARY_MISSING', 'vendor/uxplay/uxplay.exe')
    expect(toUserMessage(err)).toMatch(/UxPlay|vendor\/README/)
  })

  it('maps AIRPLAY_PORT_IN_USE to conflict hint', () => {
    const err = new CastError('AIRPLAY_PORT_IN_USE', 'EADDRINUSE')
    expect(toUserMessage(err)).toMatch(/端口|占用|名称/)
  })

  it('maps FIREWALL_BLOCKED to firewall hint', () => {
    const err = new CastError('FIREWALL_BLOCKED', 'bonjour blocked')
    expect(toUserMessage(err)).toMatch(/防火墙|组播/)
  })

  it('maps BACKEND_CRASHED to retry hint', () => {
    const err = new CastError('BACKEND_CRASHED', 'exit 1')
    expect(toUserMessage(err)).toMatch(/异常|重试/)
  })

  it('maps DISCONNECTED to disconnected status copy', () => {
    const err = new CastError('DISCONNECTED', 'device gone')
    expect(toUserMessage(err)).toContain('断开')
  })

  it('prefers UNKNOWN detail for missing Python deps', () => {
    const err = new CastError(
      'UNKNOWN',
      '缺少 Python 依赖。请执行：pip install -r sidecar/requirements.txt',
    )
    expect(toUserMessage(err)).toMatch(/pip install|requirements\.txt/)
  })
})
