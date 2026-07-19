# myCast

Windows 桌面 App：通过 USB 或 AirPlay 将 iPhone 屏幕镜像到电脑。

## 环境要求

- **Windows 10/11**
- **Apple 设备支持**：Microsoft Store 版 iTunes，或 Apple Mobile Device Support 驱动
- **Node.js 20+**（开发与构建）
- **Python 3.11+**（USB sidecar 使用 `pymobiledevice3`）
- **UxPlay + GStreamer**（AirPlay 通道；见 [vendor/README.md](vendor/README.md)）

## 快速开始

```bash
npm install
npm test
npm run build
npm run dev
```

默认使用**真实后端**（USB Python sidecar + UxPlay）。仅做 UI 联调时：

```powershell
$env:MYCAST_USE_MOCK='1'
npm run dev
```

### 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `MYCAST_USE_MOCK` | `1` = mock USB/AirPlay（UI-only） | 未设置 → 真实后端 |
| `MYCAST_PYTHON` | Python 可执行文件 | `python` |
| `MYCAST_USB_SCRIPT` | `usb_mirror.py` 路径 | `<appPath>/sidecar/usb_mirror.py` |
| `MYCAST_UXPLAY` | `uxplay.exe` 路径 | `<appPath>/vendor/uxplay/uxplay.exe` |

真机 USB 推荐：

```powershell
$env:MYCAST_PYTHON='.\sidecar\.venv\Scripts\python.exe'
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
v1 使用截图循环（约 5–15 FPS）经 `/stream.mjpg` 推送。

退出码：`2` 未信任/需配对，`3` 无设备（含投屏中拔线后连续采集失败），`4` 驱动/usbmux 失败。

## AirPlay（UxPlay）

将 `uxplay.exe` 放入 `vendor/uxplay/`，或通过 `MYCAST_UXPLAY` 指定路径。详见 [vendor/README.md](vendor/README.md)。

iPhone 控制中心 → 屏幕镜像 → 选择 App 内设置的接收端名称（默认 `myCast`）；镜像窗口由 UxPlay 弹出。

## 错误与重试

- 会话进入错误态时，主按钮为「重试」（使用上次通道与选项重新 `start`），次按钮「断开/复位」调用 `stop` 回到空闲。
- USB 拔线：sidecar 连续采集失败后以退出码 `3` 结束，App 显示断开文案并清理进程。

## 手动 QA 清单

真机项在本环境**未执行**（无受信任 iPhone / 本地 UxPlay 二进制）。勾选表示文档验收项；提交时保持未勾选直至实机验证。

- [ ] USB 已信任 → 首帧出现 *(未验证)*
- [ ] 旋转手机 → 布局仍可用 *(未验证)*
- [ ] USB 投屏中拔线 → 断开文案，无僵尸 Python *(未验证；sidecar 已加连续失败 exit 3)*
- [ ] AirPlay 可被发现为 `myCast` *(未验证)*
- [ ] App 内停止 AirPlay → UxPlay 进程清理 *(未验证)*
- [ ] 启动 USB 时若已在想 AirPlay：第二次 start 被拒绝直至 stop *(单元测试覆盖；真机未验证)*
- [ ] 未信任设备 → 信任提示文案 *(未验证)*
- [ ] 断开/重连 5 次稳定 *(未验证)*

自动化：`npm test` / `npm run build` 应保持通过。
