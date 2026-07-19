# myCast

Windows 桌面 App：通过 USB 或 AirPlay 将 iPhone 屏幕镜像到电脑。

## 环境要求

- **Windows 10/11**
- **Apple 设备支持**：Microsoft Store 版 iTunes，或 Apple Mobile Device Support 驱动
- **Python 3.11+**（USB sidecar 使用 `pymobiledevice3`）
- **UxPlay + GStreamer**（AirPlay 通道；见 [vendor/README.md](vendor/README.md)）

## 开发

```bash
npm install
npm test
npm run dev
```

## USB sidecar（Python）

设备列表与本地 MJPEG 预览由 `sidecar/usb_mirror.py` 提供。

```powershell
cd sidecar
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python usb_mirror.py list
.\.venv\Scripts\python usb_mirror.py serve --port 17890
```

浏览器打开 `http://127.0.0.1:17890/`（手机需已「信任此电脑」）。  
v1 使用截图循环（约 5–15 FPS）经 `/stream.mjpg` 推送；退出码：`2` 未信任/需配对，`3` 无设备，`4` 驱动/usbmux 失败。

## AirPlay（UxPlay）

将 `uxplay.exe` 放入 `vendor/uxplay/`，或通过 `MYCAST_UXPLAY` 指定路径。详见 [vendor/README.md](vendor/README.md)。

iPhone 控制中心 → 屏幕镜像 → 选择 App 内设置的接收端名称；镜像窗口由 UxPlay 弹出。
