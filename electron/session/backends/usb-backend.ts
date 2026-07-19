import { CastError } from '../errors'

/** Parse sidecar stdout READY line → viewer URL. Full UsbBackend spawn lands in Task 6. */
export function parseReadyLine(line: string): string | null {
  const m = line.trim().match(/^READY\s+(http:\/\/\S+)/i)
  return m?.[1] ?? null
}

export function mapUsbExitCode(code: number | null): CastError {
  if (code === 2) return new CastError('DEVICE_NOT_TRUSTED')
  if (code === 3) return new CastError('NO_DEVICE')
  if (code === 4) return new CastError('DRIVER_MISSING')
  return new CastError('BACKEND_CRASHED', `exit ${code}`)
}
