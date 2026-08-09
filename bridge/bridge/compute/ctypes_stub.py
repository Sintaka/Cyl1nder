"""Reserved native (DLL/pyd) executor interface demo via ctypes.

Later use:
  - build a DLL exporting e.g. `int cyl1nder_process(const char* json_in, char** json_out)`
  - set env CYL1NDER_DEMO_DLL=path/to/plugin.dll
  - extend run() below to call it and parse the JSON result.

v1: without the DLL this degrades to passthrough and logs a warning, so the
pipeline never breaks - it only proves the interface point exists.
"""
from __future__ import annotations

import ctypes
import os

from ..protocol import InputPayload, OutputBuffer
from ..state import get_state
from . import ComputeContext, register_executor


def _passthrough(inputs: list[InputPayload]) -> list[OutputBuffer]:
    out: list[OutputBuffer] = []
    for i, inp in enumerate(inputs):
        out.append(
            OutputBuffer(
                index=i,
                rev=0,
                pointCount=inp.pointCount,
                primCount=inp.primCount,
                points=inp.points,
                curves=inp.curves,
                attributes=inp.attributes,
            )
        )
    return out


class NativeStubExecutor:
    name = "native_demo"

    def run(self, ctx: ComputeContext, inputs: list[InputPayload]) -> list[OutputBuffer]:
        dll_path = os.environ.get("CYL1NDER_DEMO_DLL", "")
        if dll_path and os.path.exists(dll_path):
            try:
                lib = ctypes.CDLL(dll_path)
                lib.cyl1nder_process.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_char_p)]
                lib.cyl1nder_process.restype = ctypes.c_int
                # TODO(v0.2): serialize inputs -> call -> parse outputs when a real DLL exists
                get_state().logs.info("compute.native_demo", f"loaded {dll_path}")
            except Exception as exc:  # noqa: BLE001
                get_state().logs.error("compute.native_demo", f"dll load failed: {exc}")
        else:
            get_state().logs.info(
                "compute.native_demo",
                "no CYL1NDER_DEMO_DLL set; native_demo degrades to passthrough (reserved interface)",
            )
        return _passthrough(inputs)


register_executor(NativeStubExecutor())
