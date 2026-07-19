import { CastError, toUserMessage } from './errors'
import type { CastBackend, StartOptions } from './backends/types'
import type { Channel, SessionSnapshot } from './types'

export interface SessionManagerDeps {
  usb: CastBackend
  airplay: CastBackend
}

type Listener = (snapshot: SessionSnapshot) => void

export class SessionManager {
  private readonly backends: Record<Channel, CastBackend>
  private snapshot: SessionSnapshot = {
    phase: 'idle',
    channel: null,
    device: null,
    viewerUrl: null,
    airplayName: 'myCast',
    errorMessage: null,
  }
  private listeners = new Set<Listener>()
  private active: CastBackend | null = null

  constructor(deps: SessionManagerDeps) {
    this.backends = { usb: deps.usb, airplay: deps.airplay }
  }

  getSnapshot(): SessionSnapshot {
    return { ...this.snapshot }
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private set(partial: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial }
    for (const cb of this.listeners) cb(this.getSnapshot())
  }

  async listUsbDevices() {
    return this.backends.usb.listDevices()
  }

  async start(channel: Channel, options: StartOptions): Promise<void> {
    if (
      this.snapshot.phase === 'streaming' ||
      this.snapshot.phase === 'connecting' ||
      this.snapshot.phase === 'stopping'
    ) {
      throw new Error('An active session already exists')
    }
    const backend = this.backends[channel]
    this.active = backend
    this.set({
      phase: 'connecting',
      channel,
      errorMessage: null,
      airplayName: options.airplayName,
      viewerUrl: null,
    })
    try {
      const result = await backend.start(options)
      this.set({
        phase: 'streaming',
        viewerUrl: result.viewerUrl,
        device: options.deviceUdid
          ? { udid: options.deviceUdid, name: 'iPhone', connectionType: channel === 'usb' ? 'usb' : 'network' }
          : null,
      })
    } catch (e) {
      const err = e instanceof CastError ? e : new CastError('UNKNOWN', String(e))
      this.active = null
      this.set({
        phase: 'error',
        errorMessage: toUserMessage(err),
        viewerUrl: null,
      })
      throw err
    }
  }

  async stop(): Promise<void> {
    if (!this.active) {
      this.set({ phase: 'idle', channel: null, viewerUrl: null, errorMessage: null, device: null })
      return
    }
    this.set({ phase: 'stopping' })
    try {
      await this.active.stop()
    } finally {
      this.active = null
      this.set({
        phase: 'idle',
        channel: null,
        viewerUrl: null,
        errorMessage: null,
        device: null,
      })
    }
  }

  async notifyDisconnected(): Promise<void> {
    try {
      await this.active?.stop()
    } finally {
      this.active = null
      this.set({
        phase: 'error',
        errorMessage: toUserMessage(new CastError('DISCONNECTED')),
        viewerUrl: null,
        channel: null,
        device: null,
      })
    }
  }

  async notifyBackendCrashed(): Promise<void> {
    try {
      await this.active?.stop()
    } finally {
      this.active = null
      this.set({
        phase: 'error',
        errorMessage: toUserMessage(new CastError('BACKEND_CRASHED')),
        viewerUrl: null,
        channel: null,
        device: null,
      })
    }
  }
}
