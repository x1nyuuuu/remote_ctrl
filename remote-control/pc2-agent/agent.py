#!/usr/bin/env python3
"""
PC2 被控端 — 无 UI，后台截屏并执行 PC1 发来的键鼠操作

依赖: pip install -r requirements.txt

用法:
  python agent.py --server ws://YOUR_SERVER:8443 --token YOUR_TOKEN

环境变量:
  RC_SERVER, RC_TOKEN, RC_FPS (默认 8)
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import sys
import time
from typing import Any

try:
    import mss
    import pyautogui
    import websockets
except ImportError:
    print("请先安装依赖: pip install -r requirements.txt", file=sys.stderr)
    sys.exit(1)

# 将 shared 加入 path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))
from disguise import decode, encode  # noqa: E402

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0


class Agent:
    def __init__(self, server_url: str, token: str, fps: float = 8.0):
        self.server_url = server_url
        self.token = token
        self.frame_interval = 1.0 / fps
        self.session_id = "pc2-agent"
        self.ws: websockets.WebSocketClientProtocol | None = None
        self.running = True
        self.viewer_online = False
        self._sct = mss.mss()

    def _build_url(self) -> str:
        base = self.server_url.rstrip("/")
        sep = "&" if "?" in base else "?"
        return f"{base}/api/v2/telemetry/collect?role=agent&token={self.token}"

    async def send(self, payload: dict[str, Any]) -> None:
        if self.ws:
            await self.ws.send(json.dumps(encode(payload, self.session_id)))

    def capture_frame(self) -> str | None:
        try:
            monitor = self._sct.monitors[1]
            img = self._sct.grab(monitor)
            from PIL import Image

            pil = Image.frombytes("RGB", img.size, img.bgra, "raw", "BGRX")
            buf = io.BytesIO()
            pil.save(buf, format="JPEG", quality=60, optimize=True)
            return base64.b64encode(buf.getvalue()).decode("ascii")
        except Exception as e:
            print(f"[PC2] capture error: {e}")
            return None

    def handle_input(self, payload: dict[str, Any]) -> None:
        t = payload.get("type")
        d = payload.get("data") or {}

        try:
            if t == "mouse_move":
                w, h = pyautogui.size()
                x = int(d.get("x", 0) * w)
                y = int(d.get("y", 0) * h)
                pyautogui.moveTo(x, y, _pause=False)

            elif t == "mouse_click":
                btn = d.get("button", "left")
                pyautogui.click(button=btn)

            elif t == "mouse_down":
                pyautogui.mouseDown(button=d.get("button", "left"))

            elif t == "mouse_up":
                pyautogui.mouseUp(button=d.get("button", "left"))

            elif t == "key_down":
                key = d.get("key", "")
                if key:
                    pyautogui.keyDown(key, _pause=False)

            elif t == "key_up":
                key = d.get("key", "")
                if key:
                    pyautogui.keyUp(key, _pause=False)

        except Exception as e:
            print(f"[PC2] input error ({t}): {e}")

    async def stream_loop(self) -> None:
        while self.running and self.ws:
            if self.viewer_online:
                frame = self.capture_frame()
                if frame:
                    await self.send(
                        {
                            "type": "screen_frame",
                            "data": {
                                "image": frame,
                                "w": pyautogui.size()[0],
                                "h": pyautogui.size()[1],
                                "t": int(time.time() * 1000),
                            },
                        }
                    )
            await asyncio.sleep(self.frame_interval)

    async def heartbeat_loop(self) -> None:
        while self.running and self.ws:
            await self.send({"type": "ping", "data": {}})
            await asyncio.sleep(15)

    async def message_loop(self) -> None:
        assert self.ws
        async for raw in self.ws:
            try:
                envelope = json.loads(raw)
                payload = decode(envelope)
                if not payload:
                    continue

                pt = payload.get("type")
                if pt == "paired":
                    self.viewer_online = (payload.get("data") or {}).get("online", False)
                    print(f"[PC2] viewer online: {self.viewer_online}")
                elif pt == "pong":
                    pass
                else:
                    self.handle_input(payload)
            except Exception as e:
                print(f"[PC2] message error: {e}")

    async def run(self) -> None:
        url = self._build_url()
        print(f"[PC2] connecting to {url}")

        while self.running:
            try:
                async with websockets.connect(url, ping_interval=None) as ws:
                    self.ws = ws
                    print("[PC2] connected")
                    await asyncio.gather(
                        self.message_loop(),
                        self.stream_loop(),
                        self.heartbeat_loop(),
                    )
            except Exception as e:
                print(f"[PC2] disconnected: {e}, retry in 5s")
                self.ws = None
                await asyncio.sleep(5)


def main() -> None:
    parser = argparse.ArgumentParser(description="PC2 remote control agent")
    parser.add_argument("--server", default=os.environ.get("RC_SERVER", "ws://localhost:8443"))
    parser.add_argument("--token", default=os.environ.get("RC_TOKEN", "change-me-in-production"))
    parser.add_argument("--fps", type=float, default=float(os.environ.get("RC_FPS", "8")))
    args = parser.parse_args()

    agent = Agent(args.server, args.token, args.fps)
    try:
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        agent.running = False
        print("\n[PC2] stopped")


if __name__ == "__main__":
    main()
