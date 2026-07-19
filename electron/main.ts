import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { SessionManager } from './session/session-manager'
import { createAirplayBackend } from './session/backends/airplay-backend'
import { createMockBackend } from './session/backends/mock-backend'
import { createUsbBackend } from './session/backends/usb-backend'
import { CastError, toUserMessage } from './session/errors'
import { createUsbVideoView } from './video/usb-video-view'
import type { CastBackend } from './session/backends/types'
import type { Channel, SessionSnapshot } from './session/types'

function resolvePreloadPath(): string {
  const base = path.join(__dirname, '../preload/preload')
  if (fs.existsSync(`${base}.mjs`)) return `${base}.mjs`
  return `${base}.js`
}

function resolvePythonPath(): string {
  if (process.env.MYCAST_PYTHON) return process.env.MYCAST_PYTHON
  const venvPy = path.join(app.getAppPath(), 'sidecar', '.venv', 'Scripts', 'python.exe')
  if (fs.existsSync(venvPy)) return venvPy
  return 'python'
}

/** Default: real backends. Set `MYCAST_USE_MOCK=1` for UI-only. */
function createBackends(hooks: {
  onCrash: () => void
  onDisconnect: () => void
}): { usb: CastBackend; airplay: CastBackend } {
  if (process.env.MYCAST_USE_MOCK === '1') {
    return {
      usb: createMockBackend('usb'),
      airplay: createMockBackend('airplay'),
    }
  }
  const pythonPath = resolvePythonPath()
  console.log('[myCast] python:', pythonPath)
  return {
    usb: createUsbBackend({
      pythonPath,
      scriptPath:
        process.env.MYCAST_USB_SCRIPT ??
        path.join(app.getAppPath(), 'sidecar', 'usb_mirror.py'),
      onCrash: hooks.onCrash,
      onDisconnect: hooks.onDisconnect,
    }),
    airplay: createAirplayBackend({
      uxplayPath:
        process.env.MYCAST_UXPLAY ??
        path.join(app.getAppPath(), 'vendor', 'uxplay', 'uxplay.exe'),
      onCrash: hooks.onCrash,
    }),
  }
}

function createSessionManager(): SessionManager {
  let sm!: SessionManager
  const backends = createBackends({
    onCrash: () => {
      void sm.notifyBackendCrashed()
    },
    onDisconnect: () => {
      void sm.notifyDisconnected()
    },
  })
  sm = new SessionManager(backends)
  return sm
}

let sm = createSessionManager()
let mainWindow: BrowserWindow | null = null
const usbVideo = createUsbVideoView()

function broadcast() {
  mainWindow?.webContents.send('session:changed', sm.getSnapshot())
}

function syncUsbVideo(snapshot: SessionSnapshot) {
  if (!mainWindow) return
  if (
    snapshot.phase === 'streaming' &&
    snapshot.channel === 'usb' &&
    snapshot.viewerUrl
  ) {
    usbVideo.show(mainWindow, snapshot.viewerUrl)
  } else {
    usbVideo.hide()
  }
}

app.whenReady().then(() => {
  const preloadPath = resolvePreloadPath()
  console.log('[myCast] preload:', preloadPath, 'exists=', fs.existsSync(preloadPath))
  console.log('[myCast] ELECTRON_RENDERER_URL=', process.env.ELECTRON_RENDERER_URL ?? '(none)')

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#1a1a1c',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // ESM (.mjs) preload requires unsandboxed preload per Electron / electron-vite docs
      sandbox: false,
    },
  })

  sm.onChange((snapshot) => {
    broadcast()
    syncUsbVideo(snapshot)
  })

  ipcMain.handle('session:get', () => sm.getSnapshot())
  ipcMain.handle('session:listUsb', async () => {
    try {
      return await sm.listUsbDevices()
    } catch (e) {
      const err = e instanceof CastError ? e : new CastError('UNKNOWN', String(e))
      const wrapped = new Error(toUserMessage(err)) as Error & { code: string }
      wrapped.code = err.code
      throw wrapped
    }
  })
  ipcMain.handle('session:start', async (_e, channel: Channel, options) => {
    await sm.start(channel, options)
    return sm.getSnapshot()
  })
  ipcMain.handle('session:stop', async () => {
    await sm.stop()
    return sm.getSnapshot()
  })

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[myCast] did-fail-load', { code, desc, url })
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[myCast] render-process-gone', details)
  })

  mainWindow.on('closed', () => {
    usbVideo.destroy()
    mainWindow = null
  })

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  void (async () => {
    try {
      usbVideo.destroy()
      await sm.stop()
    } finally {
      app.exit(0)
    }
  })()
})
