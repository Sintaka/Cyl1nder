"""Snapshot restore route: POST /api/hda/{serial}/snapshot/restore.

Lets the web explicitly pull a serial's inputs/outputs back from the disk
snapshot after a bridge restart (or any time the workspace is empty). The
restore itself is synchronous disk I/O, so it runs in a worker thread; on
success the restored state is broadcast over WS so already-open tabs refresh.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from .protocol import is_valid_serial
from .snapshot import restore_workspace
from .state import get_state
from .ws import manager

router = APIRouter()


@router.post("/api/hda/{serial}/snapshot/restore")
async def restore(serial: str) -> dict:
    if not is_valid_serial(serial):
        raise HTTPException(status_code=400, detail="invalid serial")
    st = get_state()
    rec = st.registry.get(serial)
    hip = rec.hip if rec is not None else ""
    restored = await asyncio.to_thread(restore_workspace, serial, hip)
    ws = st.workspaces.get_or_create(serial)
    if restored:
        if ws.inputs:
            await manager.broadcast(
                serial,
                {"type": "inputs", "inputs": [i.model_dump() for i in ws.inputs], "rev": ws.input_rev, "frame": ws.frame},
            )
        outs = ws.all_outputs()
        if outs:
            await manager.broadcast(
                serial,
                {"type": "outputs", "outputs": [o.model_dump() for o in outs], "rev": ws.output_rev()},
            )
    return {
        "ok": True,
        "serial": serial,
        "restored": restored,
        "inputRev": ws.input_rev,
        "outputRev": ws.output_rev(),
    }
