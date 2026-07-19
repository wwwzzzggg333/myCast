# myCast 实现原理与前置条件

本文说明 v1 如何把 iPhone 画面送到 Windows，以及各链路必须满足的前置条件。更偏产品边界的说明见 [设计规格](./superpowers/specs/2026-07-20-iphone-screen-cast-design.md)。

## 1. 总体架构

myCast **不自研** AirPlay / QuickTime 投屏协议，而是：

1. **Electron 桌面壳**：负责 UI、单会话状态机、错误文案、子进程生命周期  
2. **USB Backend**：拉起 Python sidecar，把本地 HTTP 预览嵌进窗口  
3. **AirPlay Backend**：拉起 UxPlay 进程，手机主动镜像过来  

```text
┌──────────────────────────────────────────────┐
│  Electron (main + React renderer)            │
│  SessionManager：同一时间只允许一个会话        │
└───────────────────┬──────────────────────────┘
                    │ start / stop / status
        ┌───────────┴───────────┐
        ▼                       ▼
  USB Backend              AirPlay Backend
  spawn Python             spawn uxplay.exe
        │                       │
        ▼                       ▼
  usb_mirror.py            UxPlay 窗口渲染
  DVT 截屏 → MJPEG         AirPlay 接收
  http://127.0.0.1:port/   （画面不在 Electron 内）
        │
        ▼
  BrowserView / iframe 显示
```

关键模块：

| 模块 | 路径 | 作用 |
|------|------|------|
| SessionManager | `electron/session/session-manager.ts` | `idle → connecting → streaming → stopped/error` |
| USB Backend | `electron/session/backends/usb-backend.ts` | 解析 sidecar `READY` / 退出码，挂 BrowserView |
| AirPlay Backend | `electron/session/backends/airplay-backend.ts` | 启停 UxPlay，映射端口冲突等错误 |
| USB Sidecar | `sidecar/usb_mirror.py` | 列设备、DVT 截屏、本机 MJPEG HTTP |
| 错误目录 | `electron/session/errors.ts` | 底层失败 → 中文可操作提示 |

## 2. USB 通道原理

### 2.1 数据流

1. Windows 通过 USB 识别 iPhone（需 Apple usbmux 守护进程）  
2. sidecar 用 [pymobiledevice3](https://github.com/doronz88/pymobiledevice3) 经 **usbmux** 建立 lockdown 会话  
3. 在 iOS 17+ / 新系统上，旧版 `com.apple.mobile.screenshotr`（`ScreenshotService`）经常返回 `InvalidService`  
4. 因此 v1 改走 **Instruments DVT 截屏**：  
   - 建立 **userspace RSD 隧道**（纯 Python，无需管理员 / TUN 驱动）  
   - 通过 `DvtProvider` + `Screenshot` 周期性 `takeScreenshot`  
   - PNG → JPEG，用 multipart MJPEG 在 `127.0.0.1` 推流  
5. Electron 在收到 stdout 行 `READY http://127.0.0.1:<port>/` 后，用 BrowserView 加载该地址  

出画前 sidecar 会：检查开发者模式 → 尽力 `mounter auto-mount` → 等到**第一帧真实画面**再打印 `READY`（避免「状态投屏中但只有错误占位图」）。

### 2.2 为什么需要开发者模式与开发者镜像

| 组件 | 作用 |
|------|------|
| 开发者模式 | 打开后设备才稳定暴露开发者相关服务；关闭时 DVT/截屏常不可用 |
| DeveloperDiskImage / PersonalizedImage（`mounter auto-mount`） | 为当前 iOS 版本挂载开发者镜像，DVT Instruments 通道依赖它 |
| userspace 隧道 | iOS 17+ 开发者服务多走 RemoteXPC；userspace 在进程内建隧道，免 root |

> 这不是「越狱」，而是与 Xcode / 开发调试同类的官方开发者能力。未开开发者模式时，可改用 AirPlay。

### 2.3 USB 前置条件清单

必须全部满足：

1. **数据线为数据缆**，设备管理器中能看到 `Apple iPhone` / `Apple Mobile Device USB …`  
2. **Microsoft Store 版 iTunes** 至少启动过一次，使 `AppleMobileDeviceProcess` 监听 `127.0.0.1:27015`（usbmux）  
3. iPhone **解锁**，并点过 **「信任此电脑」**  
4. iOS 17+：**开发者模式 = 开**（设置 → 隐私与安全性）  
5. Python venv 已安装 `sidecar/requirements.txt`（App 默认用 `sidecar\.venv\Scripts\python.exe`）  
6. 建议执行：`python -m pymobiledevice3 mounter auto-mount`  

自检：

```powershell
# usbmux + 配对是否正常（应输出 JSON 设备列表）
.\sidecar\.venv\Scripts\python.exe sidecar\usb_mirror.py list

# 开发者模式
.\sidecar\.venv\Scripts\python.exe -m pymobiledevice3 amfi developer-mode-status
```

### 2.4 Sidecar 协议（给维护者）

| 项 | 约定 |
|----|------|
| `list` | stdout 一行 JSON：`[{udid,name,connectionType}]` |
| `serve --port N [--udid …]` | 成功后 stdout：`READY http://127.0.0.1:N/`；提供 `/`、`/stream.mjpg`、`/health` |
| 退出码 `2` | 未信任 / 需配对 |
| 退出码 `3` | 无 USB 设备 / 投屏中判定断开 |
| 退出码 `4` | usbmux/驱动失败，或缺少 Python 依赖 |
| 退出码 `5` | 开发者模式关闭，或 DVT/镜像不可用 |

## 3. AirPlay 通道原理

### 3.1 数据流

1. Electron 启动 `uxplay -n <接收名称>`（默认名称 `myCast`）  
2. UxPlay 在局域网内做 AirPlay 接收端发现（Bonjour / 组播）  
3. 用户在 iPhone：**控制中心 → 屏幕镜像 → 选择该名称**  
4. 视频由 **UxPlay 自己的窗口** 解码渲染（v1 不嵌进 Electron）  
5. App 负责进程存活、停止时杀进程树、端口占用等错误提示  

### 3.2 AirPlay 前置条件清单

1. 电脑与 iPhone **同一局域网**（访客网络 / AP 隔离可能导致搜不到）  
2. 本机已按 [`vendor/README.md`](../vendor/README.md) 配置 **UxPlay + GStreamer**  
3. Windows 防火墙允许 myCast / UxPlay 的专用网络与相关发现流量  
4. 接收名称未被其它 AirPlay 接收端占用  

## 4. 会话与错误处理

- **单会话**：`SessionManager` 在 `connecting` / `streaming` / `stopping` 时拒绝第二次 `start`  
- **错误态**：主按钮「重试」、次按钮「断开/复位」  
- **退出清理**：`before-quit` 会 `await` 停止后端，避免残留 Python / UxPlay  
- **中文错误**：信任、驱动、开发者模式、UxPlay 缺失、端口冲突等映射见 `electron/session/errors.ts`  

## 5. 技术选型摘要

| 层级 | 选型 | 原因 |
|------|------|------|
| 桌面壳 | Electron + React + TypeScript | 子进程管理与内嵌预览简单 |
| USB | pymobiledevice3 + DVT userspace | Windows 上成熟；适配 iOS 17+ |
| 预览 | 本机 MJPEG HTTP + BrowserView | 实现简单，首帧可验证 |
| AirPlay | UxPlay | 开源接收端，避免自研协议 |
| 测试 | Vitest | Session / Backend 协议层可单测 |

## 6. 已知限制（v1）

- USB 为**周期性截屏**，不是硬件编码连续视频流，帧率与延迟不如 macOS QuickTime  
- AirPlay **画面在独立窗口**，应用内仅为状态与操作  
- 无声音、无录屏、无反向控制  
- 未提供安装包分发；开发态以 `npm run dev` 为主  
- Store 版 iTunes 的 AMDS 路径在 WindowsApps 下，需先启动 iTunes 才能用 usbmux  

## 7. 相关文档

- [设计规格](./superpowers/specs/2026-07-20-iphone-screen-cast-design.md)  
- [实现计划](./superpowers/plans/2026-07-20-iphone-screen-cast.md)  
- [UxPlay 安装说明](../vendor/README.md)  
