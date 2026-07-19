import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
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

function resolvePreloadPath(): string {
  const base = path.join(__dirname, '../preload/preload')
  if (fs.existsSync(`${base}.mjs`)) return `${base}.mjs`
  return `${base}.js`
}

function broadcast() {
  mainWindow?.webContents.send('session:changed', sm.getSnapshot())
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
