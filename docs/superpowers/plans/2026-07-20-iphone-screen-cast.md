# myCast iPhone Screen Cast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop app that mirrors an iPhone screen over USB and Wi‑Fi (AirPlay), view-only, with clear connection status and errors.

**Architecture:** Electron main process owns a Session Manager and two backends (USB / AirPlay). USB uses a Python sidecar on top of `pymobiledevice3` that serves a local HTTP viewer; the renderer embeds that viewer. AirPlay spawns a bundled/configured UxPlay process; Electron owns lifecycle and status while UxPlay renders video. Same-time only one active session.

**Tech Stack:** Electron + Vite + React + TypeScript; Vitest; Python 3.11+ with `pymobiledevice3`; UxPlay (AirPlay receiver); npm/`electron-builder` for packaging notes.

## Global Constraints

- Platform: Windows desktop window app only (v1)
- Scope: view-only video; no audio, recording, or reverse control
- Channels: USB + Wi‑Fi (AirPlay); user selects manually; one active session at a time
- Prefer wrapping mature tools over inventing protocols
- Default AirPlay receiver name: `myCast`
- USB path target: ~10s to first frame after device is trusted (excluding Trust tap time)
- User-facing copy for failures must be Chinese and actionable (见错误目录)
- Spec: `docs/superpowers/specs/2026-07-20-iphone-screen-cast-design.md`

---

## File Structure

```text
myCast/
  package.json
  electron.vite.config.ts
  tsconfig.json
  tsconfig.node.json
  vitest.config.ts
  index.html
  electron/
    main.ts
    preload.ts
    session/
      types.ts
      errors.ts
      session-manager.ts
      backends/
        types.ts
        mock-backend.ts
        usb-backend.ts
        airplay-backend.ts
    video/
      usb-video-view.ts
  src/
    main.tsx
    App.tsx
    styles.css
    components/
      DevicePanel.tsx
      ChannelPicker.tsx
      StatusBar.tsx
      VideoPane.tsx
    hooks/
      useSession.ts
    lib/
      ipc.ts
  sidecar/
    requirements.txt
    usb_mirror.py
  vendor/
    README.md
  tests/
    errors.test.ts
    session-manager.test.ts
    mock-backend.test.ts
    usb-backend.test.ts
    airplay-backend.test.ts
  README.md
```

**Responsibility notes:**

| Path | Responsibility |
|------|----------------|
| `electron/session/*` | Pure session orchestration (unit-tested, no Electron APIs in manager core) |
| `electron/session/backends/*` | Process adapters; map exit codes/stderr → `CastError` |
| `electron/video/usb-video-view.ts` | BrowserView hosting USB HTTP viewer |
| `sidecar/usb_mirror.py` | Device list + local HTTP mirror for USB |
| `src/*` | Renderer UI only; talks via preload IPC |
| `vendor/` | Where to place UxPlay / notes for Apple Mobile Device Support |

---

### Task 1: Scaffold project + error catalog + session types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vitest.config.ts`
- Create: `electron.vite.config.ts`
- Create: `index.html`
- Create: `electron/session/types.ts`
- Create: `electron/session/errors.ts`
- Create: `tests/errors.test.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: `SessionState`, `Channel`, `DeviceInfo`, `CastErrorCode`, `CastError`, `toUserMessage(error)`

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors.test.ts
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm install && npx vitest run tests/errors.test.ts`

Expected: FAIL with module not found / `CastError` not defined

- [ ] **Step 3: Write minimal implementation**

`package.json` (key fields):

```json
{
  "name": "mycast",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "out/main/main.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "electron": "^33.2.0",
    "electron-vite": "^2.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

```ts
// electron/session/types.ts
export type Channel = 'usb' | 'airplay'

export type SessionPhase =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'stopping'
  | 'error'

export interface DeviceInfo {
  udid: string
  name: string
  connectionType: 'usb' | 'network'
}

export interface SessionSnapshot {
  phase: SessionPhase
  channel: Channel | null
  device: DeviceInfo | null
  viewerUrl: string | null
  airplayName: string
  errorMessage: string | null
}
```

```ts
// electron/session/errors.ts
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
```

Also add minimal `tsconfig.json`, `vitest.config.ts` (`include: ['tests/**/*.ts', 'electron/**/*.ts']`), `electron.vite.config.ts` stubs, `index.html`, and a short `README.md` stating Windows + iTunes/Apple drivers + Python prerequisites.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json tsconfig.node.json vitest.config.ts electron.vite.config.ts index.html electron/session/types.ts electron/session/errors.ts tests/errors.test.ts README.md package-lock.json
git commit -m "feat: scaffold myCast with cast error catalog"
```

---

### Task 2: Session Manager state machine

**Files:**
- Create: `electron/session/backends/types.ts`
- Create: `electron/session/session-manager.ts`
- Create: `tests/session-manager.test.ts`

**Interfaces:**
- Consumes: `CastError`, `SessionSnapshot`, `Channel`, `DeviceInfo` from Task 1
- Produces:
  - `interface CastBackend { readonly channel: Channel; listDevices(): Promise<DeviceInfo[]>; start(options: StartOptions): Promise<StartResult>; stop(): Promise<void> }`
  - `interface StartOptions { deviceUdid?: string; airplayName: string }`
  - `interface StartResult { viewerUrl: string | null }`
  - `class SessionManager { getSnapshot(); onChange(cb); listUsbDevices(); start(channel, options); stop(); notifyDisconnected(); notifyBackendCrashed() }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/session-manager.test.ts
import { describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../electron/session/session-manager'
import type { CastBackend, StartResult } from '../electron/session/backends/types'
import { CastError } from '../electron/session/errors'

function makeBackend(channel: 'usb' | 'airplay', startImpl?: () => Promise<StartResult>): CastBackend {
  return {
    channel,
    listDevices: vi.fn(async () => [{ udid: 'u1', name: 'iPhone', connectionType: 'usb' as const }]),
    start: vi.fn(startImpl ?? (async () => ({ viewerUrl: 'http://127.0.0.1:17890/' }))),
    stop: vi.fn(async () => {}),
  }
}

describe('SessionManager', () => {
  it('starts usb session idle → connecting → streaming', async () => {
    const usb = makeBackend('usb')
    const airplay = makeBackend('airplay')
    const sm = new SessionManager({ usb, airplay })
    const phases: string[] = []
    sm.onChange((s) => phases.push(s.phase))

    await sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })

    expect(sm.getSnapshot().phase).toBe('streaming')
    expect(sm.getSnapshot().channel).toBe('usb')
    expect(sm.getSnapshot().viewerUrl).toBe('http://127.0.0.1:17890/')
    expect(phases).toContain('connecting')
    expect(phases).toContain('streaming')
  })

  it('rejects starting a second session while streaming', async () => {
    const sm = new SessionManager({
      usb: makeBackend('usb'),
      airplay: makeBackend('airplay'),
    })
    await sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })
    await expect(sm.start('airplay', { airplayName: 'myCast' })).rejects.toThrow(/active session/i)
  })

  it('stop returns to idle and calls backend.stop', async () => {
    const usb = makeBackend('usb')
    const sm = new SessionManager({ usb, airplay: makeBackend('airplay') })
    await sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })
    await sm.stop()
    expect(sm.getSnapshot().phase).toBe('idle')
    expect(usb.stop).toHaveBeenCalled()
  })

  it('maps backend start failure to error phase with user message', async () => {
    const usb = makeBackend('usb', async () => {
      throw new CastError('DEVICE_NOT_TRUSTED', 'pair')
    })
    const sm = new SessionManager({ usb, airplay: makeBackend('airplay') })
    await expect(sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })).rejects.toBeInstanceOf(CastError)
    expect(sm.getSnapshot().phase).toBe('error')
    expect(sm.getSnapshot().errorMessage).toContain('信任')
  })

  it('notifyDisconnected moves streaming → error with DISCONNECTED copy', async () => {
    const sm = new SessionManager({
      usb: makeBackend('usb'),
      airplay: makeBackend('airplay'),
    })
    await sm.start('usb', { airplayName: 'myCast', deviceUdid: 'u1' })
    sm.notifyDisconnected()
    expect(sm.getSnapshot().phase).toBe('error')
    expect(sm.getSnapshot().errorMessage).toContain('断开')
  })

  it('notifyBackendCrashed maps to BACKEND_CRASHED copy', async () => {
    const sm = new SessionManager({
      usb: makeBackend('usb'),
      airplay: makeBackend('airplay'),
    })
    await sm.start('airplay', { airplayName: 'myCast' })
    sm.notifyBackendCrashed()
    expect(sm.getSnapshot().errorMessage).toMatch(/异常|重试/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/session-manager.test.ts`

Expected: FAIL — `SessionManager` not found

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/session/backends/types.ts
import type { Channel, DeviceInfo } from '../types'

export interface StartOptions {
  deviceUdid?: string
  airplayName: string
}

export interface StartResult {
  /** Local HTTP viewer for USB; null when AirPlay owns its own window */
  viewerUrl: string | null
}

export interface CastBackend {
  readonly channel: Channel
  listDevices(): Promise<DeviceInfo[]>
  start(options: StartOptions): Promise<StartResult>
  stop(): Promise<void>
}
```

```ts
// electron/session/session-manager.ts
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
    if (this.snapshot.phase === 'streaming' || this.snapshot.phase === 'connecting') {
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

  notifyDisconnected(): void {
    void this.active?.stop()
    this.active = null
    this.set({
      phase: 'error',
      errorMessage: toUserMessage(new CastError('DISCONNECTED')),
      viewerUrl: null,
    })
  }

  notifyBackendCrashed(): void {
    void this.active?.stop()
    this.active = null
    this.set({
      phase: 'error',
      errorMessage: toUserMessage(new CastError('BACKEND_CRASHED')),
      viewerUrl: null,
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/session-manager.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/session/backends/types.ts electron/session/session-manager.ts tests/session-manager.test.ts
git commit -m "feat: add SessionManager state machine"
```

---

### Task 3: Mock backend + IPC bridge

**Files:**
- Create: `electron/session/backends/mock-backend.ts`
- Create: `tests/mock-backend.test.ts`
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `src/lib/ipc.ts`

**Interfaces:**
- Consumes: `CastBackend`, `SessionManager`
- Produces:
  - `createMockBackend(channel, opts?)`
  - IPC channels: `session:get`, `session:listUsb`, `session:start`, `session:stop`, `session:subscribe` (event `session:changed`)
  - Preload API: `window.mycast`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mock-backend.test.ts
import { describe, expect, it } from 'vitest'
import { createMockBackend } from '../electron/session/backends/mock-backend'
import { CastError } from '../electron/session/errors'

describe('createMockBackend', () => {
  it('returns a viewerUrl on usb start', async () => {
    const b = createMockBackend('usb')
    const r = await b.start({ airplayName: 'myCast', deviceUdid: 'u1' })
    expect(r.viewerUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
  })

  it('returns null viewerUrl on airplay start', async () => {
    const b = createMockBackend('airplay')
    const r = await b.start({ airplayName: 'myCast' })
    expect(r.viewerUrl).toBeNull()
  })

  it('can simulate DEVICE_NOT_TRUSTED', async () => {
    const b = createMockBackend('usb', { failWith: 'DEVICE_NOT_TRUSTED' })
    await expect(b.start({ airplayName: 'myCast', deviceUdid: 'u1' })).rejects.toMatchObject({
      code: 'DEVICE_NOT_TRUSTED',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mock-backend.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// electron/session/backends/mock-backend.ts
import type { CastBackend, StartOptions, StartResult } from './types'
import type { Channel, DeviceInfo } from '../types'
import { CastError, type CastErrorCode } from '../errors'

export interface MockBackendOptions {
  failWith?: CastErrorCode
  devices?: DeviceInfo[]
}

export function createMockBackend(channel: Channel, opts: MockBackendOptions = {}): CastBackend {
  let running = false
  return {
    channel,
    async listDevices() {
      return (
        opts.devices ?? [
          { udid: 'mock-udid', name: 'Mock iPhone', connectionType: 'usb' },
        ]
      )
    },
    async start(_options: StartOptions): Promise<StartResult> {
      if (opts.failWith) throw new CastError(opts.failWith, 'mock failure')
      running = true
      return {
        viewerUrl: channel === 'usb' ? 'http://127.0.0.1:17890/' : null,
      }
    },
    async stop() {
      running = false
    },
  }
}
```

Wire Electron main (dev default: mock backends via env `MYCAST_USE_MOCK=1`):

```ts
// electron/main.ts
import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { SessionManager } from './session/session-manager'
import { createMockBackend } from './session/backends/mock-backend'
import type { Channel } from './session/types'

const useMock = process.env.MYCAST_USE_MOCK !== '0'

function createSessionManager() {
  // Real backends replaced in Tasks 6–8; mock keeps UI unblocked.
  return new SessionManager({
    usb: createMockBackend('usb'),
    airplay: createMockBackend('airplay'),
  })
}

let sm = createSessionManager()
let mainWindow: BrowserWindow | null = null

function broadcast() {
  mainWindow?.webContents.send('session:changed', sm.getSnapshot())
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  sm.onChange(() => broadcast())

  ipcMain.handle('session:get', () => sm.getSnapshot())
  ipcMain.handle('session:listUsb', () => sm.listUsbDevices())
  ipcMain.handle('session:start', async (_e, channel: Channel, options) => {
    await sm.start(channel, options)
    return sm.getSnapshot()
  })
  ipcMain.handle('session:stop', async () => {
    await sm.stop()
    return sm.getSnapshot()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
})
```

```ts
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Channel, SessionSnapshot } from './session/types'

contextBridge.exposeInMainWorld('mycast', {
  getSession: (): Promise<SessionSnapshot> => ipcRenderer.invoke('session:get'),
  listUsbDevices: () => ipcRenderer.invoke('session:listUsb'),
  start: (channel: Channel, options: { deviceUdid?: string; airplayName: string }) =>
    ipcRenderer.invoke('session:start', channel, options),
  stop: () => ipcRenderer.invoke('session:stop'),
  onSessionChanged: (cb: (s: SessionSnapshot) => void) => {
    const listener = (_: unknown, s: SessionSnapshot) => cb(s)
    ipcRenderer.on('session:changed', listener)
    return () => ipcRenderer.removeListener('session:changed', listener)
  },
})
```

```ts
// src/lib/ipc.ts
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
  return window.mycast
}
```

Ensure `electron.vite.config.ts` builds main/preload/renderer entry points per electron-vite defaults (`electron/main.ts`, `electron/preload.ts`, `src/main.tsx`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mock-backend.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/session/backends/mock-backend.ts tests/mock-backend.test.ts electron/main.ts electron/preload.ts src/lib/ipc.ts electron.vite.config.ts
git commit -m "feat: add mock backends and Electron session IPC"
```

---

### Task 4: React UI shell (controls + status)

**Files:**
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src/hooks/useSession.ts`
- Create: `src/components/ChannelPicker.tsx`
- Create: `src/components/DevicePanel.tsx`
- Create: `src/components/StatusBar.tsx`
- Create: `src/components/VideoPane.tsx`

**Interfaces:**
- Consumes: `window.mycast` IPC
- Produces: UI that can start/stop USB or AirPlay against mock backends

- [ ] **Step 1: Write a render-level smoke assertion (optional lightweight)**

No React Testing Library required in v1. Manual gate in Step 4. Skip automated UI test; keep TDD on session layer.

- [ ] **Step 2: Implement UI**

```tsx
// src/hooks/useSession.ts
import { useEffect, useState } from 'react'
import { api } from '../lib/ipc'
import type { SessionSnapshot } from '../../electron/session/types'

export function useSession() {
  const [session, setSession] = useState<SessionSnapshot | null>(null)

  useEffect(() => {
    void api().getSession().then(setSession)
    return api().onSessionChanged(setSession)
  }, [])

  return session
}
```

`App.tsx` layout:

- Left: `ChannelPicker` (`usb` | `airplay`), `DevicePanel` (USB device list + refresh), Start / Stop / Retry buttons
- Center: `VideoPane` — if `viewerUrl` set, show `<iframe src={viewerUrl} />` with object-fit contain; if AirPlay streaming with null URL, show Chinese hint:「请在 iPhone 控制中心选择屏幕镜像 → myCast；画面由接收窗口显示」
- Bottom: `StatusBar` showing phase + `errorMessage`
- When USB devices exist and idle, show hint「推荐使用 USB（通常更稳）」but do not auto-start
- AirPlay name input default `myCast`

`styles.css`: dark charcoal panel + single composition workspace (not a dashboard of cards); keep simple, readable Chinese labels.

- [ ] **Step 3: Run app with mocks**

Run: `$env:MYCAST_USE_MOCK='1'; npm run dev`

Expected: Window opens; Start USB → status `streaming` and iframe points at mock URL; Stop → `idle`; simulated error path can be exercised by temporarily setting mock `failWith` in main.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx src/App.tsx src/styles.css src/hooks/useSession.ts src/components index.html
git commit -m "feat: add React UI for channel selection and session status"
```

---

### Task 5: USB Python sidecar (device list + HTTP viewer)

**Files:**
- Create: `sidecar/requirements.txt`
- Create: `sidecar/usb_mirror.py`
- Modify: `README.md` (Python setup)

**Interfaces:**
- Consumes: `pymobiledevice3` on PATH / venv
- Produces: CLI
  - `python usb_mirror.py list` → JSON array of `{udid,name,connectionType}`
  - `python usb_mirror.py serve --port 17890 [--udid UDID]` → blocking HTTP server
    - `GET /` HTML page with auto-refreshing or streamed frames
    - `GET /health` → `{"ok": true}`
    - stdout line when ready: `READY http://127.0.0.1:17890/`
  - Exit codes: `2` = not trusted / pair required; `3` = no device; `4` = driver/usbmux failure; other = unknown

- [ ] **Step 1: Write a sidecar contract test (Node spawning dry-run)**

```ts
// tests/usb-backend.test.ts (partial first — parse helpers)
import { describe, expect, it } from 'vitest'
import { mapUsbExitCode, parseReadyLine } from '../electron/session/backends/usb-backend'

describe('usb sidecar protocol', () => {
  it('parses READY line', () => {
    expect(parseReadyLine('READY http://127.0.0.1:17890/')).toBe('http://127.0.0.1:17890/')
  })

  it('maps exit code 2 to DEVICE_NOT_TRUSTED', () => {
    expect(mapUsbExitCode(2).code).toBe('DEVICE_NOT_TRUSTED')
  })

  it('maps exit code 3 to NO_DEVICE', () => {
    expect(mapUsbExitCode(3).code).toBe('NO_DEVICE')
  })

  it('maps exit code 4 to DRIVER_MISSING', () => {
    expect(mapUsbExitCode(4).code).toBe('DRIVER_MISSING')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/usb-backend.test.ts`

Expected: FAIL — helpers not exported yet

- [ ] **Step 3: Implement `usb_mirror.py` + export helpers from usb-backend stub**

`sidecar/requirements.txt`:

```text
pymobiledevice3>=4.20.0
Pillow>=10.0.0
```

`sidecar/usb_mirror.py` behavior:

1. `list`: use `pymobiledevice3` usbmux list API; print JSON to stdout
2. `serve`:
   - Connect lockdown for UDID (or first USB device)
   - On `PasswordRequiredError` / pair errors → exit 2
   - On no device → exit 3
   - On usbmux connection errors mentioning driver / Apple Mobile Device → exit 4
   - Start `ThreadingHTTPServer` on `127.0.0.1:port`
   - Prefer higher-FPS capture when available (DVT / screenshot service). Minimum viable: loop `screenshot` / springboard screenshot ≈5–15 FPS, encode JPEG, serve via multipart MJPEG at `/stream.mjpg` and an HTML `<img>` on `/`
   - Print `READY http://127.0.0.1:{port}/` flush stdout

Create helper exports in `electron/session/backends/usb-backend.ts` even before full process spawn:

```ts
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
```

Manual check on a machine with a phone:

```bash
cd sidecar
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python usb_mirror.py list
.\.venv\Scripts\python usb_mirror.py serve --port 17890
```

Expected: browser to `http://127.0.0.1:17890/` shows frames after Trust.

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run tests/usb-backend.test.ts`

Expected: PASS for protocol helpers

- [ ] **Step 5: Commit**

```bash
git add sidecar/requirements.txt sidecar/usb_mirror.py electron/session/backends/usb-backend.ts tests/usb-backend.test.ts README.md
git commit -m "feat: add USB mirror Python sidecar and exit-code mapping"
```

---

### Task 6: USB Electron backend (spawn sidecar + BrowserView)

**Files:**
- Modify: `electron/session/backends/usb-backend.ts` (full `UsbBackend` class)
- Create: `electron/video/usb-video-view.ts`
- Modify: `electron/main.ts` (use real USB backend when `MYCAST_USE_MOCK=0`)
- Modify: `src/components/VideoPane.tsx` (prefer main-process BrowserView; renderer shows placeholder when USB streaming)

**Interfaces:**
- Consumes: sidecar CLI protocol from Task 5; `SessionManager.notifyDisconnected` / `notifyBackendCrashed`
- Produces: `createUsbBackend(options: { pythonPath: string; scriptPath: string; onCrash: () => void; onDisconnect: () => void }): CastBackend`

- [ ] **Step 1: Extend tests for spawn lifecycle with mocked child_process**

```ts
// append to tests/usb-backend.test.ts
import { EventEmitter } from 'node:events'

it('start resolves when READY is printed', async () => {
  // Implement using dependency-injected spawn fn returning a fake ChildProcess
  // that emits stdout "READY http://127.0.0.1:17890/\n"
})
```

Implement `UsbBackend` with injectable `spawn` for tests.

- [ ] **Step 2: Run tests — fail then implement**

`UsbBackend.start`:

1. `stop` any previous child
2. Spawn: `pythonPath scriptPath serve --port <freePort> [--udid ...]`
3. Parse stdout lines until `READY`
4. On non-zero exit before READY → `mapUsbExitCode`
5. Attach `exit` handler → `onCrash` if session still active
6. Return `{ viewerUrl }`

`UsbBackend.listDevices`: spawn `list`, parse JSON, map errors via exit codes.

`UsbBackend.stop`: kill process tree on Windows (`taskkill /PID ... /T /F` fallback if needed), wait close.

`usb-video-view.ts`:

```ts
// Attach BrowserView to main window bottom/right content bounds when viewerUrl present
// setAutoResize({ width: true, height: true })
// loadURL(viewerUrl)
// destroy/hide on stop
```

Main process: on snapshot `streaming` + usb + viewerUrl → show BrowserView; on idle/error → hide.

- [ ] **Step 3: Manual verification**

Run (real device):

```powershell
$env:MYCAST_USE_MOCK='0'
npm run dev
```

Expected: list shows phone; Start → BrowserView shows MJPEG; unplug → disconnected message; Stop cleans process (no orphan `python` in Task Manager).

- [ ] **Step 4: Commit**

```bash
git add electron/session/backends/usb-backend.ts electron/video/usb-video-view.ts electron/main.ts src/components/VideoPane.tsx tests/usb-backend.test.ts
git commit -m "feat: wire USB backend spawn and BrowserView surface"
```

---

### Task 7: AirPlay backend via UxPlay

**Files:**
- Create: `electron/session/backends/airplay-backend.ts`
- Create: `tests/airplay-backend.test.ts`
- Create: `vendor/README.md`
- Modify: `electron/main.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: UxPlay executable path from env `MYCAST_UXPLAY` or `vendor/uxplay/uxplay.exe`
- Produces: `createAirplayBackend({ uxplayPath, onCrash }): CastBackend`
  - `start({ airplayName })` spawns `uxplay -n <name> -nh` (no HUD if supported) / documented flags
  - `viewerUrl: null`
  - Map stderr `Address already in use` → `AIRPLAY_PORT_IN_USE`
  - Document firewall mapping: if process runs but never receives clients, UI already shows waiting copy; optional timeout does **not** auto-error in v1

- [ ] **Step 1: Write failing tests for stderr mapping**

```ts
// tests/airplay-backend.test.ts
import { describe, expect, it } from 'vitest'
import { mapAirplayStderr } from '../electron/session/backends/airplay-backend'
import { CastError } from '../electron/session/errors'

describe('mapAirplayStderr', () => {
  it('detects port in use', () => {
    expect(mapAirplayStderr('bind: Address already in use')).toBeInstanceOf(CastError)
    expect(mapAirplayStderr('bind: Address already in use')?.code).toBe('AIRPLAY_PORT_IN_USE')
  })

  it('returns null for unrelated logs', () => {
    expect(mapAirplayStderr('Initialized GStreamer')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/airplay-backend.test.ts`

- [ ] **Step 3: Implement AirplayBackend**

```ts
export function mapAirplayStderr(line: string): CastError | null {
  if (/address already in use/i.test(line) || /eaddrinuse/i.test(line)) {
    return new CastError('AIRPLAY_PORT_IN_USE', line)
  }
  return null
}
```

`start`:

1. Resolve binary; if missing → throw `CastError('UNKNOWN', 'UxPlay not found')` and surface README install steps in `toUserMessage` by extending `UNKNOWN` detail **or** add code `AIRPLAY_BINARY_MISSING` with message「未找到 UxPlay。请按 vendor/README.md 安装并设置 MYCAST_UXPLAY。」
2. Prefer adding `AIRPLAY_BINARY_MISSING` to `CastErrorCode` + `MESSAGES` + a unit test in `tests/errors.test.ts` when introducing it
3. Spawn with `airplayName`
4. Consider start successful once process stays alive ~1s without mapped stderr error
5. `stop` kills process tree

`vendor/README.md`: how to obtain a Windows UxPlay build + GStreamer runtime; set `MYCAST_UXPLAY`.

UI waiting copy already in Task 4.

- [ ] **Step 4: Manual verification**

1. Start AirPlay channel in App  
2. iPhone Control Center → Screen Mirroring → `myCast`  
3. UxPlay window shows screen  
4. Stop in App ends process; phone disconnects  

- [ ] **Step 5: Commit**

```bash
git add electron/session/backends/airplay-backend.ts tests/airplay-backend.test.ts vendor/README.md electron/main.ts electron/session/errors.ts tests/errors.test.ts README.md
git commit -m "feat: add AirPlay backend wrapping UxPlay"
```

---

### Task 8: Production wiring, reconnect UX, QA checklist

**Files:**
- Modify: `electron/main.ts` (select mock vs real backends)
- Modify: `src/App.tsx` (Retry button calls start again with last options; keep last channel/udid/name in React state)
- Modify: `README.md` (full setup + manual QA)
- Modify: `docs/superpowers/specs/2026-07-20-iphone-screen-cast-design.md` status → Accepted / implementing

**Interfaces:**
- Consumes: all backends
- Produces: runnable v1 app for real hardware

- [ ] **Step 1: Backend factory**

```ts
function createBackends(hooks: { onCrash: () => void; onDisconnect: () => void }) {
  if (process.env.MYCAST_USE_MOCK === '1') {
    return {
      usb: createMockBackend('usb'),
      airplay: createMockBackend('airplay'),
    }
  }
  return {
    usb: createUsbBackend({
      pythonPath: process.env.MYCAST_PYTHON ?? 'python',
      scriptPath: path.join(app.getAppPath(), 'sidecar', 'usb_mirror.py'),
      onCrash: hooks.onCrash,
      onDisconnect: hooks.onDisconnect,
    }),
    airplay: createAirplayBackend({
      uxplayPath: process.env.MYCAST_UXPLAY ?? path.join(app.getAppPath(), 'vendor', 'uxplay', 'uxplay.exe'),
      onCrash: hooks.onCrash,
    }),
  }
}
```

Default for `npm run dev`: real backends; document `MYCAST_USE_MOCK=1` for UI-only.

- [ ] **Step 2: Retry UX**

When `phase === 'error'`, primary button label「重试」re-invokes `start` with last used `channel` + options. Secondary「断开/复位」calls `stop()` then clears error to idle.

- [ ] **Step 3: Manual QA checklist (run and tick in PR/commit notes)**

- [ ] USB trusted → first frame  
- [ ] Rotate phone → layout still usable  
- [ ] USB unplug mid-stream → 断开 copy, no zombie python  
- [ ] AirPlay discoverable as `myCast`  
- [ ] AirPlay stop from App cleans UxPlay  
- [ ] Start USB while thinking about AirPlay: second start rejected until stop  
- [ ] Untrusted device → 信任 copy  
- [ ] Disconnect/reconnect 5× stable  

- [ ] **Step 4: Run full unit suite**

Run: `npm test`

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts src/App.tsx README.md docs/superpowers/specs/2026-07-20-iphone-screen-cast-design.md
git commit -m "feat: finish v1 wiring, retry UX, and QA notes"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Windows desktop window app | Tasks 3–4 |
| USB mirror | Tasks 5–6 |
| Wi‑Fi AirPlay mirror | Task 7 |
| View-only; no audio/record/control | Global constraints; no tasks add them |
| Session Manager single active session | Task 2 |
| Error copy: trust / driver / port / firewall / crash / disconnect | Tasks 1, 7 (`AIRPLAY_BINARY_MISSING`), 8 |
| USB preferred hint, no auto-steal AirPlay | Task 4 |
| Video surface | Task 6 BrowserView; Task 7 UxPlay window (explicit v1) |
| Unit tests for state machine + mock backends | Tasks 2–3 |
| Manual device QA | Task 8 |

**Placeholder scan:** None intentional. Open env vars (`MYCAST_PYTHON`, `MYCAST_UXPLAY`, `MYCAST_USE_MOCK`) are concrete.

**Type consistency:** `CastBackend`, `StartOptions`, `StartResult`, `SessionSnapshot`, `CastErrorCode` names are stable across tasks. If Task 7 adds `AIRPLAY_BINARY_MISSING`, update Task 1 types in the same commit as noted.

**Known v1 tradeoff (explicit):** AirPlay video renders in UxPlay’s window rather than Electron BrowserView; USB uses in-app BrowserView. Matches “尽快稳定看画面”; embedding AirPlay can be a follow-up.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-20-iphone-screen-cast.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with executing-plans checkpoints  

Which approach?
