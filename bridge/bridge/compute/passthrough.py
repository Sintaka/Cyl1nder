"""passthrough executor: each input index becomes an output index with same geometry."""
from __future__ import annotations

from ..protocol import InputPayload, OutputBuffer
from . import ComputeContext, register_executor


class PassthroughExecutor:
    name = "passthrough"

    def run(self, ctx: ComputeContext, inputs: list[InputPayload]) -> list[OutputBuffer]:
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


register_executor(PassthroughExecutor())
