import { BrowserView, type BrowserWindow } from 'electron'

/** Matches `.sidebar` width in `src/styles.css`. */
const SIDEBAR_WIDTH = 280
/** Matches `.status-bar` approximate height (padding + line). */
const STATUS_BAR_HEIGHT = 42

export interface UsbVideoView {
  show(win: BrowserWindow, viewerUrl: string): void
  hide(): void
  destroy(): void
}

function videoBounds(win: BrowserWindow) {
  const [cw, ch] = win.getContentSize()
  return {
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, cw - SIDEBAR_WIDTH),
    height: Math.max(0, ch - STATUS_BAR_HEIGHT),
  }
}

/** BrowserView surface for the USB MJPEG HTTP viewer (workspace region). */
export function createUsbVideoView(): UsbVideoView {
  let view: BrowserView | null = null
  let attachedWin: BrowserWindow | null = null
  let onResize: (() => void) | null = null
  let loadedUrl: string | null = null

  function detachResize() {
    if (attachedWin && onResize) {
      attachedWin.off('resize', onResize)
    }
    onResize = null
  }

  function ensureView(win: BrowserWindow): BrowserView {
    if (!view) {
      view = new BrowserView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      view.setAutoResize({ width: true, height: true })
    }

    if (attachedWin !== win) {
      if (attachedWin) {
        attachedWin.removeBrowserView(view)
        detachResize()
      }
      attachedWin = win
      win.setBrowserView(view)
      onResize = () => {
        if (view && attachedWin) view.setBounds(videoBounds(attachedWin))
      }
      win.on('resize', onResize)
    } else if (!win.getBrowserViews().includes(view)) {
      win.setBrowserView(view)
    }

    view.setBounds(videoBounds(win))
    return view
  }

  return {
    show(win, viewerUrl) {
      const v = ensureView(win)
      if (loadedUrl !== viewerUrl) {
        loadedUrl = viewerUrl
        void v.webContents.loadURL(viewerUrl)
      }
    },
    hide() {
      if (attachedWin && view) {
        attachedWin.removeBrowserView(view)
      }
      detachResize()
      attachedWin = null
      loadedUrl = null
    },
    destroy() {
      this.hide()
      if (view) {
        const wc = view.webContents
        view = null
        try {
          if (!wc.isDestroyed()) wc.close()
        } catch {
          // Electron version differences
        }
      }
    },
  }
}
