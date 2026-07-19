import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { SessionManager } from './session/session-manager'
import { createAirplayBackend } from './session/backends/airplay-backend'
import { createMockBackend } from './session/backends/mock-backend'
import { createUsbBackend } from './session/backends/usb-backend'
import { createUsbVideoView } from './video/usb-video-view'
import type { CastBackend } from './session/backends/types'
import type { Channel, SessionSnapshot } from './session/types'

function resolvePreloadPath(): string {
  const base = path.join(__dirname, '../preload/preload')
  if (fs.existsSync(`${base}.mjs`)) return `${base}.mjs`
  return `${base}.js`
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
  return {
    usb: createUsbBackend({
      pythonPath: process.env.MYCAST_PYTHON ?? 'python',
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
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  sm.onChange((snapshot) => {
    broadcast()
    syncUsbVideo(snapshot)
  })

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

  mainWindow.on('closed', () => {
    usbVideo.destroy()
    mainWindow = null
  })

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
