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
