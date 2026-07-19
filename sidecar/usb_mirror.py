#!/usr/bin/env python3
"""myCast USB sidecar: list devices and serve a local MJPEG viewer via pymobiledevice3."""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

EXIT_NOT_TRUSTED = 2
EXIT_NO_DEVICE = 3
EXIT_DRIVER = 4

# v1 capture: screenshot loop → JPEG (~8 FPS). Higher-FPS DVT path deferred.
TARGET_FPS = 8.0
BOUNDARY = b"frame"


class SidecarExit(SystemExit):
    """Exit with a sidecar protocol code."""


def _is_driver_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    name = type(exc).__name__.lower()
    needles = (
        "usbmux",
        "apple mobile device",
        "driver",
        "amdservice",
        "connectionfailedtousbmuxd",
        "muxexception",
    )
    return any(n in msg or n in name for n in needles)


def _map_connect_error(exc: BaseException) -> int:
    from pymobiledevice3.exceptions import (
        ConnectionFailedToUsbmuxdError,
        DeviceNotFoundError,
        FatalPairingError,
        MuxException,
        NoDeviceConnectedError,
        NotPairedError,
        NotTrustedError,
        PairingDialogResponsePendingError,
        PairingError,
        PasscodeRequiredError,
        PasswordRequiredError,
        UserDeniedPairingError,
    )

    trust_types = (
        PasswordRequiredError,
        PasscodeRequiredError,
        NotTrustedError,
        NotPairedError,
        PairingError,
        FatalPairingError,
        UserDeniedPairingError,
        PairingDialogResponsePendingError,
    )
    if isinstance(exc, trust_types):
        return EXIT_NOT_TRUSTED
    if isinstance(exc, (NoDeviceConnectedError, DeviceNotFoundError)):
        return EXIT_NO_DEVICE
    if isinstance(exc, (ConnectionFailedToUsbmuxdError, MuxException)) or _is_driver_error(exc):
        return EXIT_DRIVER
    # Nested / string-classified pairing failures
    msg = str(exc).lower()
    if any(k in msg for k in ("password", "pair", "trust", "passcode")):
        return EXIT_NOT_TRUSTED
    if "no device" in msg or "not found" in msg:
        return EXIT_NO_DEVICE
    return 1


def _connection_type(device: Any) -> str:
    raw = getattr(device, "connection_type", "") or ""
    if str(raw).lower() == "usb" or getattr(device, "is_usb", False):
        return "usb"
    return "network"


async def _list_devices() -> list[dict[str, str]]:
    from pymobiledevice3.exceptions import (
        ConnectionFailedToUsbmuxdError,
        MuxException,
        NoDeviceConnectedError,
    )
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.usbmux import list_devices

    try:
        mux_devices = await list_devices()
    except NoDeviceConnectedError:
        return []
    except (ConnectionFailedToUsbmuxdError, MuxException) as exc:
        raise SidecarExit(_map_connect_error(exc)) from exc
    except OSError as exc:
        if _is_driver_error(exc):
            raise SidecarExit(EXIT_DRIVER) from exc
        raise

    out: list[dict[str, str]] = []
    for device in mux_devices:
        udid = device.serial
        name = udid
        try:
            async with await create_using_usbmux(serial=udid, autopair=False) as lockdown:
                info = lockdown.short_info
                name = str(info.get("DeviceName") or udid)
        except Exception:
            # Still list the mux entry even if lockdown/pair is incomplete.
            pass
        out.append(
            {
                "udid": udid,
                "name": name,
                "connectionType": _connection_type(device),
            }
        )
    return out


def cmd_list() -> None:
    try:
        devices = asyncio.run(_list_devices())
    except SidecarExit:
        raise
    except Exception as exc:
        code = _map_connect_error(exc)
        print(f"list failed: {exc}", file=sys.stderr)
        raise SidecarExit(code) from exc
    print(json.dumps(devices, ensure_ascii=False))


class FrameBuffer:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jpeg = b""
        self._stop = threading.Event()

    @property
    def stop_event(self) -> threading.Event:
        return self._stop

    def set_jpeg(self, data: bytes) -> None:
        with self._lock:
            self._jpeg = data

    def get_jpeg(self) -> bytes:
        with self._lock:
            return self._jpeg


def _png_to_jpeg(png_bytes: bytes, quality: int = 70) -> bytes:
    from PIL import Image

    img = Image.open(io.BytesIO(png_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def _placeholder_jpeg(message: str) -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (640, 360), color=(28, 28, 32))
    draw = ImageDraw.Draw(img)
    draw.text((24, 160), message[:80], fill=(220, 220, 220))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


async def _capture_loop(udid: Optional[str], frames: FrameBuffer) -> None:
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.screenshot import ScreenshotService

    interval = 1.0 / TARGET_FPS
    async with await create_using_usbmux(serial=udid) as lockdown:
        async with ScreenshotService(lockdown) as screenshotr:
            while not frames.stop_event.is_set():
                t0 = time.monotonic()
                try:
                    raw = await screenshotr.take_screenshot()
                    frames.set_jpeg(_png_to_jpeg(raw))
                except Exception as exc:
                    frames.set_jpeg(_placeholder_jpeg(f"capture error: {exc}"))
                    await asyncio.sleep(1.0)
                    continue
                elapsed = time.monotonic() - t0
                await asyncio.sleep(max(0.0, interval - elapsed))


def _start_capture_thread(udid: Optional[str], frames: FrameBuffer) -> threading.Thread:
    def runner() -> None:
        try:
            asyncio.run(_capture_loop(udid, frames))
        except Exception as exc:
            frames.set_jpeg(_placeholder_jpeg(f"capture stopped: {exc}"))
            traceback.print_exc(file=sys.stderr)

    t = threading.Thread(target=runner, name="usb-capture", daemon=True)
    t.start()
    return t


async def _probe_device(udid: Optional[str]) -> str:
    """Validate lockdown connectivity; return resolved UDID."""
    from pymobiledevice3.exceptions import NoDeviceConnectedError
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.usbmux import list_devices

    try:
        devices = await list_devices()
    except Exception as exc:
        raise SidecarExit(_map_connect_error(exc)) from exc

    usb_devices = [d for d in devices if _connection_type(d) == "usb"]
    candidates = usb_devices or list(devices)

    if udid:
        match = next((d for d in candidates if d.serial == udid), None)
        if match is None:
            raise SidecarExit(EXIT_NO_DEVICE)
        serial = udid
    else:
        if not candidates:
            raise SidecarExit(EXIT_NO_DEVICE)
        serial = candidates[0].serial

    try:
        async with await create_using_usbmux(serial=serial) as lockdown:
            _ = lockdown.short_info
    except NoDeviceConnectedError as exc:
        raise SidecarExit(EXIT_NO_DEVICE) from exc
    except Exception as exc:
        raise SidecarExit(_map_connect_error(exc)) from exc

    return serial


def _make_handler(frames: FrameBuffer) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            # Keep stdout clean for READY protocol; log to stderr.
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path == "/health":
                body = b'{"ok": true}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path == "/stream.mjpg":
                self._stream_mjpeg()
                return
            if path in ("/", "/index.html"):
                html = (
                    "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                    "<title>myCast USB</title>"
                    "<style>html,body{margin:0;background:#111;height:100%;}"
                    "img{display:block;max-width:100%;max-height:100vh;margin:0 auto;}</style>"
                    "</head><body>"
                    "<img src='/stream.mjpg' alt='iPhone mirror'/>"
                    "</body></html>"
                ).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(html)))
                self.end_headers()
                self.wfile.write(html)
                return
            self.send_error(404)

        def _stream_mjpeg(self) -> None:
            self.send_response(200)
            self.send_header(
                "Content-Type",
                f"multipart/x-mixed-replace; boundary={BOUNDARY.decode()}",
            )
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                while True:
                    jpeg = frames.get_jpeg()
                    if not jpeg:
                        jpeg = _placeholder_jpeg("waiting for frames…")
                    part = (
                        b"--"
                        + BOUNDARY
                        + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
                        + str(len(jpeg)).encode()
                        + b"\r\n\r\n"
                        + jpeg
                        + b"\r\n"
                    )
                    self.wfile.write(part)
                    self.wfile.flush()
                    time.sleep(1.0 / TARGET_FPS)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                return

    return Handler


def cmd_serve(port: int, udid: Optional[str]) -> None:
    try:
        serial = asyncio.run(_probe_device(udid))
    except SidecarExit:
        raise
    except Exception as exc:
        raise SidecarExit(_map_connect_error(exc)) from exc

    frames = FrameBuffer()
    frames.set_jpeg(_placeholder_jpeg("connecting…"))
    _start_capture_thread(serial, frames)

    handler = _make_handler(frames)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    except OSError as exc:
        print(f"failed to bind 127.0.0.1:{port}: {exc}", file=sys.stderr)
        raise SidecarExit(1) from exc

    url = f"http://127.0.0.1:{port}/"
    print(f"READY {url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        frames.stop_event.set()
        server.server_close()


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="myCast USB mirror sidecar")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="Print connected devices as JSON")

    serve_p = sub.add_parser("serve", help="Serve local MJPEG viewer")
    serve_p.add_argument("--port", type=int, default=17890)
    serve_p.add_argument("--udid", type=str, default=None)

    args = parser.parse_args(argv)
    try:
        if args.command == "list":
            cmd_list()
        elif args.command == "serve":
            cmd_serve(args.port, args.udid)
        else:
            parser.error(f"unknown command {args.command}")
    except SidecarExit as exc:
        code = int(exc.code) if exc.code is not None else 1
        raise SystemExit(code) from None


if __name__ == "__main__":
    main()
