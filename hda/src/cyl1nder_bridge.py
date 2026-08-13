"""Bridge client for Houdini - push inputs (debounced thread) / pull outputs.

Pure stdlib (no hou) so it can be unit-tested outside Houdini.
Keep generate_serial identical to bridge/bridge/protocol.py.
"""
from __future__ import annotations

import json
import random
import threading
import time
import urllib.request

BRIDGE_URL_DEFAULT = "http://127.0.0.1:8375"


def _b36(n: int) -> str:
    if n == 0:
        return "0"
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    out: list[str] = []
    while n:
        n, r = divmod(n, 36)
        out.append(chars[r])
    return "".join(reversed(out))


def generate_serial() -> str:
    """Create-once immutable serial. Keep identical to bridge/bridge/protocol.py."""
    ms = int(time.time() * 1000)
    rnd = random.randrange(36**4)
    return f"C1-{_b36(ms)}-{_b36(rnd).zfill(4)}"


class BridgeClient:
    def __init__(
        self,
        serial: str,
        bridge_url: str = BRIDGE_URL_DEFAULT,
        node_path: str = "",
        label: str = "Cyl1nder",
    ) -> None:
        self.serial = serial
        self.bridge_url = bridge_url.rstrip("/")
        self.node_path = node_path
        self.label = label
        self._lock = threading.Lock()
        self._pending = None
        self._thread: threading.Thread | None = None
        self.last_error = ""

    def push_inputs(self, inputs: list[dict], hip: str = "", frame: float | None = None) -> None:
        with self._lock:
            self._pending = (inputs, hip, frame)
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._pump, daemon=True)
            self._thread.start()

    def _pump(self) -> None:
        time.sleep(0.12)  # debounce: coalesce rapid cooks
        with self._lock:
            pending = self._pending
            self._pending = None
        if pending is None:
            return
        inputs, hip, frame = pending
        try:
            body = json.dumps(
                {
                    "inputs": inputs,
                    "hip": hip,
                    "frame": frame,
                    "nodePath": self.node_path,
                    "label": self.label,
                }
            ).encode("utf-8")
            req = urllib.request.Request(
                f"{self.bridge_url}/api/hda/{self.serial}/inputs",
                data=body,
                headers={"Content-Type": "application/json"},
                method="PUT",
            )
            with urllib.request.urlopen(req, timeout=2):
                self.last_error = ""
        except Exception as exc:  # noqa: BLE001 - bridge down must never break the cook
            self.last_error = str(exc)

    def pending_outputs(self, since: int) -> tuple[bool, int, bool, bool]:
        """Lightweight dirty check: (pending, rev, reset, force).

        reset=True when the bridge restarted and rev went backwards (since > rev) -
        caller should re-pull from 0. force=True is a one-shot kick (POST /kick):
        caller should recook even when rev did not advance (heals a failed first
        push when the bridge was still starting).
        """
        try:
            url = f"{self.bridge_url}/api/hda/{self.serial}/pending?since={int(since or 0)}"
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return (
                bool(data.get("pending", False)),
                int(data.get("rev", 0)),
                bool(data.get("reset", False)),
                bool(data.get("force", False)),
            )
        except Exception:  # noqa: BLE001
            return False, since, False, False

    def probe_once(self) -> dict | None:
        """Low-rate /pending probe for the sync gate (OFF mode): returns the parsed
        dict {pending, rev, reset, force, sync_enabled}, or None on any connection error."""
        try:
            url = f"{self.bridge_url}/api/hda/{self.serial}/pending?since=0"
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:  # noqa: BLE001
            return None

    def stream_once(self, since: int, hold: float = 60.0) -> dict | None:
        """Long-poll one NDJSON stream event from /stream (hold ~= idle heartbeat).

        Returns the parsed event dict, or None on any connection error - the
        caller backs off and retries. A connection error is distinct from a
        {"type":"timeout"} event dict, which is the idle keep-alive.
        """
        try:
            url = f"{self.bridge_url}/api/hda/{self.serial}/stream?since={int(since or 0)}&hold={float(hold)}"
            with urllib.request.urlopen(url, timeout=hold + 5.0) as resp:
                line = resp.readline().decode("utf-8").strip()
            if not line:
                return None
            return json.loads(line)
        except Exception:  # noqa: BLE001 - connection errors -> None (caller retries)
            return None

    def pull_outputs(self, since: int) -> tuple[list[dict] | None, int]:
        """Returns (outputs, new_rev) or (None, since) when the bridge is unreachable."""
        try:
            url = f"{self.bridge_url}/api/hda/{self.serial}/outputs?since={int(since or 0)}"
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return data.get("outputs", []), int(data.get("rev", since or 0))
        except Exception as exc:  # noqa: BLE001
            self.last_error = str(exc)
            return None, since