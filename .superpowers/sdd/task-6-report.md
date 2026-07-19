# Task 6 Report: USB Electron backend (spawn sidecar + BrowserView)

## Status

**DONE_WITH_CONCERNS**

## Summary

Implemented full `UsbBackend` with injectable `spawn` (READY-line resolution, list JSON, Windows process-tree kill), main-process `BrowserView` surface for the USB MJPEG viewer, and wired `main.ts` so real USB is used unless `MYCAST_USE_MOCK=1`. AirPlay remains mock until Task 7. Renderer `VideoPane` shows a placeholder when USB is streaming (BrowserView owns the pixels).

## Files Created / Modified

| File | Purpose |
|------|---------|
| `electron/session/backends/usb-backend.ts` | `createUsbBackend`, port alloc, kill tree, spawn lifecycle |
| `electron/video/usb-video-view.ts` | BrowserView attach/hide over workspace bounds |
| `electron/main.ts` | Real USB when mock≠1; sync BrowserView on snapshot |
| `src/components/VideoPane.tsx` | USB streaming → placeholder (no iframe) |
| `tests/usb-backend.test.ts` | READY resolve, pre-READY exit map, list JSON, onCrash |

## Behavior

- `start`: stop previous → spawn `python script serve --port <free> [--udid]` → wait `READY` → `{ viewerUrl }`
- Unexpected exit after READY → `onCrash` (exit `3` → `onDisconnect`)
- `stop`: `taskkill /PID … /T /F` on Windows, wait close
- Snapshot `streaming` + `usb` + `viewerUrl` → show BrowserView; else hide

## Build / Test Evidence

```
npm test  → 24/24 passed, exit 0
npm run build → main / preload / renderer OK
```

## Manual Gate

Not run with a trusted iPhone in this agent environment. Suggested:

```powershell
$env:MYCAST_USE_MOCK='0'   # or omit; mock only when === '1'
$env:MYCAST_PYTHON='.\sidecar\.venv\Scripts\python.exe'
npm run dev
```

## Concerns

1. **No real-device smoke** — list/Start/BrowserView/unplug/stop not verified on hardware → `DONE_WITH_CONCERNS`.
2. **Sidecar may not exit on unplug** — capture thread shows placeholders; process often stays alive, so `onDisconnect` may not fire until process dies (exit `3`) or crashes.
3. **`MYCAST_USE_MOCK` default flipped** — mock only when `=== '1'` (was “mock unless `0`”); bare `npm run dev` now expects Python sidecar.
4. **BrowserView bounds** — fixed 280px sidebar / ~42px status bar; layout drift would misalign the surface.

## Commit

```
feat: wire USB backend spawn and BrowserView surface
```

## Fix (Task 6 review)

- `electron/main.ts`: `before-quit` now prevents default, awaits `sm.stop()` (kills Python sidecar), then `app.exit(0)`.
- `tests/usb-backend.test.ts`: exit code `3` after READY asserts `onDisconnect` (not `onCrash`).

```
npm test  → 25/25 passed
npm run build → OK
```

Commit: `fix: await session stop on app quit and test USB disconnect exit`

## Dependencies Consumed

- Task 5 sidecar CLI (`list` / `serve` + READY + exit codes)
- Task 2 `SessionManager.notifyDisconnected` / `notifyBackendCrashed`

## Next Steps (out of scope)

- Task 7: real AirPlay / UxPlay backend
- Task 8: production wiring, reconnect UX, QA checklist
- Optional: sidecar exit/signal on device unplug for reliable disconnect copy
