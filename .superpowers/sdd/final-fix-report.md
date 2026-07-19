# Final whole-branch fix report

Date: 2026-07-20  
Branch: feat/iphone-screen-cast  
Worktree: `E:/workspace/myapp/myCast/.worktrees/feat-iphone-cast`  
Commit message: `fix: close exit-listener race, surface list errors, map missing Python deps`

## Fixes

### 1. Exit listener race (USB + AirPlay)

- After READY / settle succeeds, backends check `child.exitCode` / `signalCode` before and after attaching the runtime exit handler.
- If the child is already dead, `start()` rejects with `BACKEND_CRASHED` (or mapped USB error) instead of returning success and leaving SessionManager in `streaming`.
- Tests: USB exits immediately after READY; AirPlay already-exited after settle.

### 2. Device list failures visible in UI

- `DevicePanel` refresh catch shows Chinese error (`role="alert"`).
- `App.tsx` USB count refresh catches rejections (no silent unhandled rejection).
- `SessionManager.listUsbDevices` normalizes to `CastError`; main IPC `session:listUsb` rejects with `toUserMessage` text + `code`.
- `formatIpcInvokeError` strips Electron invoke wrapper for renderer display.

### 3. Python ImportError / missing deps

- `sidecar/usb_mirror.py` catches `ImportError` / `ModuleNotFoundError`, prints Chinese `pip install -r sidecar/requirements.txt` hint, exits `4`.
- Electron `mapUsbSidecarFailure` parses stderr for ModuleNotFound/pymobiledevice3 → `UNKNOWN` with Chinese pip path.
- `toUserMessage` prefers UNKNOWN detail when present.

### Also

- Serve path is USB-only (no network device fallback) in `_probe_device`.

## Evidence

```
npm test → 39 passed (5 files)
```

## Explicitly not claimed

- Device QA (§7.1) not executed.
- electron-builder packaging not added.
