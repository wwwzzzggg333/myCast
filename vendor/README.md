# UxPlay (AirPlay receiver)

myCast 的 AirPlay 通道通过 [UxPlay](https://github.com/FDH2/UxPlay) 接收 iPhone 屏幕镜像。本仓库**不包含** UxPlay 可执行文件；请在本目录自行放置构建产物。

## 目录布局

```
vendor/
  uxplay/
    uxplay.exe    ← Windows 构建（及 GStreamer 运行时依赖，见下文）
  README.md
```

默认查找路径：`vendor/uxplay/uxplay.exe`（相对于 App 工作目录）。

## 获取 Windows 版 UxPlay

1. 从 UxPlay 发布页或社区 Windows 构建获取 `uxplay.exe`（需与 GStreamer 版本匹配）。
2. 将可执行文件放入 `vendor/uxplay/`。
3. 若构建说明要求同目录放置 GStreamer DLL，请一并复制到 `vendor/uxplay/` 或确保 GStreamer 已在系统 `PATH` 中。

UxPlay 依赖 **GStreamer** 进行音视频解码与窗口渲染。常见安装方式：

- 安装 [GStreamer Windows 运行时](https://gstreamer.freedesktop.org/download/)（MSVC 64-bit 安装包，含 runtime 组件）。
- 或将构建包附带的 GStreamer 库与 `uxplay.exe` 放在同一目录。

启动失败且 stderr 出现 GStreamer 相关错误时，请先确认运行时已安装且与构建架构一致（x64）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `MYCAST_UXPLAY` | UxPlay 可执行文件绝对或相对路径，覆盖默认 `vendor/uxplay/uxplay.exe` |

示例（PowerShell）：

```powershell
$env:MYCAST_UXPLAY = "D:\tools\uxplay\uxplay.exe"
npm run dev
```

## 防火墙与发现

UxPlay 使用 mDNS/Bonjour 在局域网广播接收端名称。若 App 显示「等待连接」但 iPhone 控制中心看不到设备：

- 在 Windows 防火墙中允许 **myCast** 与 **uxplay.exe** 通过专用/公用网络。
- 确保 PC 与 iPhone 在同一子网；某些访客 Wi‑Fi 会隔离组播。

v1 不会在超时后自动报错；进程正常运行即视为已就绪，镜像窗口由 UxPlay 自行弹出。

## 启动参数

myCast 调用：`uxplay -n <airplayName> -nh`

- `-n`：控制中心显示的接收端名称（与 App 内设置一致）。
- `-nh`：禁用 UxPlay 自带 HUD（若当前构建支持）。
