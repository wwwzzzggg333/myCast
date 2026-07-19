# myCast

在 Windows 上将 iPhone 屏幕镜像到电脑（仅画面，v1）。

支持：

- **USB**：Python sidecar（`pymobiledevice3`）+ DVT userspace 截屏 → 应用内预览
- **AirPlay**：本机启动 [UxPlay](https://github.com/FDH2/UxPlay) 接收端，手机控制中心镜像

> **实现原理与前置条件（推荐阅读）：** [`docs/architecture.md`](docs/architecture.md)  
> 设计规格：[`docs/superpowers/specs/2026-07-20-iphone-screen-cast-design.md`](docs/superpowers/specs/2026-07-20-iphone-screen-cast-design.md)  
> 实现计划：[`docs/superpowers/plans/2026-07-20-iphone-screen-cast.md`](docs/superpowers/plans/2026-07-20-iphone-screen-cast.md)

## 实现原理（摘要）

myCast 是 **Electron 壳 + 两个可替换后端**，不自研投屏协议：

| 通道 | 原理 | 画面显示位置 |
|------|------|----------------|
| USB | usbmux → lockdown → **DVT Instruments 截屏**（userspace 隧道）→ 本机 MJPEG HTTP | Electron 内 BrowserView |
| AirPlay | 启动 **UxPlay** 做 AirPlay 接收；手机控制中心主动镜像 | UxPlay 独立窗口 |

会话由 `SessionManager` 统一管理（同时只允许一路投屏）。详情与数据流图见 [`docs/architecture.md`](docs/architecture.md)。

## 前置条件总览

### 共用

- Windows 10/11、Node.js 20+、Python 3.11+（USB）
- iPhone 已解锁；USB 时需点过「信任此电脑」

### USB 专用（iOS 17+ / 新系统几乎都要）

| 条件 | 为什么需要 |
|------|------------|
| Microsoft Store **iTunes** 启动过 | 拉起 `AppleMobileDeviceProcess`（usbmux，`127.0.0.1:27015`） |
| **开发者模式** 已开启 | 否则 DVT/截屏服务常报 `InvalidService` |
| 建议 `mounter auto-mount` | 挂载当前系统对应的开发者镜像 |
| `sidecar\.venv` 已 `pip install -r requirements.txt` | App 默认用该解释器跑 sidecar |

### AirPlay 专用

| 条件 | 为什么需要 |
|------|------------|
| 与手机同一局域网 | AirPlay 发现依赖局域网组播 |
| `vendor/uxplay/uxplay.exe` + GStreamer | 开源接收端，见 [`vendor/README.md`](vendor/README.md) |
| 防火墙放行 | 否则控制中心搜不到 `myCast` |

## 环境要求

| 依赖 | 说明 |
|------|------|
| Windows 10/11 | 仅 Windows 桌面 |
| Node.js 20+ | 开发 / 运行 Electron |
| Python 3.11+ | USB sidecar |
| Microsoft Store iTunes | 提供 usbmux（`AppleMobileDeviceProcess`） |
| UxPlay + GStreamer | 仅 AirPlay 需要，见 [`vendor/README.md`](vendor/README.md) |

## 快速开始

```powershell
npm install

# USB sidecar 虚拟环境（推荐）
cd sidecar
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
cd ..

# 先打开一次 Microsoft Store 的 iTunes（拉起 usbmux）
npm run dev
```

App 会自动优先使用 `sidecar\.venv\Scripts\python.exe`。

仅调试界面（不连真机）：

```powershell
$env:MYCAST_USE_MOCK = '1'
npm run dev
```

## USB 投屏（iOS 17+ / 新系统）

USB 画面走 **DVT 截屏 + userspace 隧道**（旧 `ScreenshotService` 在新系统上常不可用）。

1. iPhone：**设置 → 隐私与安全性 → 开发者模式** → 打开（会重启）
2. 重启后解锁，完成确认；线缆连接并点「信任此电脑」
3. 打开过一次 **iTunes**
4. （建议）挂载开发者镜像：
   ```powershell
   .\sidecar\.venv\Scripts\python.exe -m pymobiledevice3 mounter auto-mount
   ```
5. `npm run dev` → 选 USB → 刷新设备 → **开始投屏**

自检设备列表：

```powershell
.\sidecar\.venv\Scripts\python.exe sidecar\usb_mirror.py list
```

sidecar 退出码：`2` 未信任 · `3` 无设备 · `4` 驱动/usbmux/缺依赖 · `5` 开发者模式 / DVT 不可用

## AirPlay 投屏

1. 按 [`vendor/README.md`](vendor/README.md) 放置 `uxplay.exe`（及 GStreamer）
2. App 中选 **AirPlay**，接收名称默认 `myCast`
3. 点 **开始投屏**，再在 iPhone：控制中心 → 屏幕镜像 → 选 `myCast`  
   （画面在 UxPlay 窗口中显示）

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `MYCAST_USE_MOCK` | `1` = mock 后端 | 未设置 → 真实后端 |
| `MYCAST_PYTHON` | Python 可执行文件 | `sidecar\.venv\Scripts\python.exe`（若存在），否则 `python` |
| `MYCAST_USB_SCRIPT` | sidecar 脚本路径 | `<app>/sidecar/usb_mirror.py` |
| `MYCAST_UXPLAY` | UxPlay 路径 | `<app>/vendor/uxplay/uxplay.exe` |

## 开发命令

```powershell
npm test          # Vitest
npm run build     # electron-vite 构建
npm run dev       # 开发模式（自动打开 DevTools）
```

### 界面异常时

1. 确认未设置 `MYCAST_USE_MOCK`（真机时）
2. DevTools Console 执行 `window.mycast`（应为对象）
3. 终端应有 `Local: http://localhost:5173/` 与 `[myCast] python: ...\sidecar\.venv\...`
4. 保持 iTunes / usbmux 可用：`usb_mirror.py list` 能列出设备

## 功能范围（v1）

**已做：** USB / AirPlay 画面、单会话、中文错误提示、重试 / 复位  

**未做：** 声音、录屏、反向触控、安装包分发

## License

MIT
