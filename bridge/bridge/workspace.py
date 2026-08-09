"""Per-serial workspace: latest inputs + revisioned output buffers."""
from __future__ import annotations

import threading
from typing import Any

from .protocol import InputPayload, OutputBuffer


class Workspace:
    def __init__(self, serial: str) -> None:
        self.serial = serial
        self.inputs: list[InputPayload] = []
        self.input_rev = 0
        self._outputs: dict[int, OutputBuffer] = {}
        self._output_rev = 0
        self._rev_lock = threading.Lock()

    def set_inputs(self, inputs: list[InputPayload]) -> int:
        self.inputs = inputs
        self.input_rev += 1
        return self.input_rev

    def put_outputs(self, outputs: list[OutputBuffer]) -> int:
        """Store edited outputs; each output index gets a strictly increasing rev."""
        with self._rev_lock:
            for buf in outputs:
                index = int(buf.index)
                prev = self._outputs.get(index)
                base = prev.rev if prev is not None else 0
                buf.rev = max(int(buf.rev), base + 1, self._output_rev + 1)
                self._outputs[index] = buf
                if buf.rev > self._output_rev:
                    self._output_rev = buf.rev
            return self._output_rev

    def get_outputs_since(self, since: int) -> list[OutputBuffer]:
        with self._rev_lock:
            changed = [b for b in self._outputs.values() if b.rev > since]
            return sorted(changed, key=lambda b: b.index)

    def output_rev(self) -> int:
        with self._rev_lock:
            return self._output_rev

    def to_summary(self) -> dict[str, Any]:
        with self._rev_lock:
            return {
                "serial": self.serial,
                "inputRev": self.input_rev,
                "outputRev": self._output_rev,
                "inputs": [
                    {
                        "index": p.index,
                        "name": p.name,
                        "pointCount": p.pointCount,
                        "primCount": p.primCount,
                        "curveCount": len(p.curves),
                    }
                    for p in self.inputs
                ],
                "outputs": [
                    {
                        "index": b.index,
                        "rev": b.rev,
                        "pointCount": b.pointCount,
                        "primCount": b.primCount,
                        "curveCount": len(b.curves),
                    }
                    for b in self._outputs.values()
                ],
            }


class WorkspaceStore:
    def __init__(self) -> None:
        self._workspaces: dict[str, Workspace] = {}
        self._lock = threading.Lock()

    def get_or_create(self, serial: str) -> Workspace:
        with self._lock:
            ws = self._workspaces.get(serial)
            if ws is None:
                ws = Workspace(serial)
                self._workspaces[serial] = ws
            return ws

    def get(self, serial: str) -> Workspace | None:
        with self._lock:
            return self._workspaces.get(serial)

    def serials(self) -> list[str]:
        with self._lock:
            return sorted(self._workspaces)

    def status(self, serial: str) -> dict[str, Any]:
        ws = self.get_or_create(serial)
        return ws.to_summary()
