"""Python 版流量伪装层（PC2 被控端使用）"""

from __future__ import annotations

import base64
import json
import random
import time
import uuid
from typing import Any

EVENT_MAP = {
    "screen_frame": "scroll_depth",
    "mouse_move": "mouse_move",
    "mouse_click": "click",
    "mouse_down": "mousedown",
    "mouse_up": "mouseup",
    "key_down": "keydown",
    "key_up": "keyup",
    "ping": "heartbeat",
    "pong": "heartbeat_ack",
    "register": "session_init",
    "paired": "session_ready",
    "error": "error_report",
}


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    if pad != 4:
        s += "=" * pad
    return base64.urlsafe_b64decode(s)


def fake_meta() -> dict[str, str]:
    return {
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0",
        "ref": "https://portal.corp-analytics.internal/dashboard",
        "vid": str(uuid.uuid4())[:8],
        "plat": "desktop-agent",
    }


def noise_events(count: int = 2) -> list[dict[str, Any]]:
    pages = ["/dashboard", "/reports", "/settings", "/team"]
    out = []
    for _ in range(count):
        out.append(
            {
                "e": "page_view",
                "p": random.choice(pages),
                "d": _b64url_encode(json.dumps({"t": time.time(), "r": random.random()}).encode()),
            }
        )
    return out


def encode(payload: dict[str, Any], session_id: str) -> dict[str, Any]:
    disguised = EVENT_MAP.get(payload.get("type", ""), "custom_event")
    real_data = _b64url_encode(json.dumps(payload).encode())

    batch = (
        noise_events(random.randint(1, 2))
        + [
            {
                "e": disguised,
                "p": "/remote-session",
                "d": real_data,
                "x": random.randint(0, 1919),
                "y": random.randint(0, 1079),
            }
        ]
        + noise_events(1)
    )

    return {
        "v": 2,
        "sid": session_id,
        "ts": int(time.time() * 1000),
        "batch": batch,
        "meta": fake_meta(),
    }


def decode(envelope: dict[str, Any]) -> dict[str, Any] | None:
    batch = envelope.get("batch")
    if not isinstance(batch, list):
        return None

    for item in batch:
        d = item.get("d")
        if not d:
            continue
        try:
            raw = _b64url_decode(d).decode("utf-8")
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and parsed.get("type"):
                return parsed
        except (ValueError, json.JSONDecodeError):
            continue
    return None
