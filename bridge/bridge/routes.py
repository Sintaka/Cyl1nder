"""REST routes: health / serials / per-serial inputs / outputs / logs."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from .protocol import InputsPut, OutputsPut, VERSION, WEB_UI_URL, is_valid_serial
from .state import get_state
from .ws import manager

router = APIRouter()


@router.get("/")
async def root(serial: str | None = None) -> object:
    """Landing helper: with ?serial= redirect to the web UI, else describe the service."""
    if serial:
        return RedirectResponse(f"{WEB_UI_URL}/?serial={serial}", status_code=307)
    return {"service": "cyl1nder-bridge", "ui": WEB_UI_URL, "hint": "open the web UI: " + WEB_UI_URL + "/?serial=<hda serial>"}


def _check_serial(serial: str) -> None:
    if not is_valid_serial(serial):
        raise HTTPException(status_code=400, detail="invalid serial")


@router.get("/api/health")
async def health() -> dict:
    st = get_state()
    return {"status": "ok", "version": VERSION, "serials": len(st.registry.serials())}


@router.get("/api/serials")
async def list_serials() -> list[str]:
    return get_state().registry.serials()


@router.get("/api/hda/{serial}/status")
async def status(serial: str) -> dict:
    _check_serial(serial)
    st = get_state()
    rec = st.registry.get(serial)
    return {
        "serial": serial,
        "registry": rec.to_dict() if rec is not None else None,
        "workspace": st.workspaces.status(serial),
    }


@router.put("/api/hda/{serial}/inputs")
async def put_inputs(serial: str, payload: InputsPut) -> dict:
    _check_serial(serial)
    st = get_state()
    rec = st.registry.register(
        serial, hip=payload.hip, nodePath=payload.nodePath, label=payload.label
    )
    rev = st.workspaces.get_or_create(serial).set_inputs(payload.inputs)
    st.logs.info("routes", f"inputs pushed ({len(payload.inputs)}), rev={rev}", serial)
    await manager.broadcast(
        serial,
        {"type": "inputs", "inputs": [i.model_dump() for i in payload.inputs], "rev": rev},
    )
    return {"ok": True, "serial": serial, "rev": rev}


@router.get("/api/hda/{serial}/outputs")
async def get_outputs(serial: str, since: int = Query(0, ge=0)) -> dict:
    _check_serial(serial)
    st = get_state()
    ws = st.workspaces.get_or_create(serial)
    outputs = ws.get_outputs_since(since)
    return {"outputs": [o.model_dump() for o in outputs], "rev": ws.output_rev()}


@router.put("/api/hda/{serial}/outputs")
async def put_outputs(serial: str, payload: OutputsPut) -> dict:
    _check_serial(serial)
    st = get_state()
    ws = st.workspaces.get_or_create(serial)
    rev = ws.put_outputs(payload.outputs)
    st.logs.info("routes", f"outputs pushed ({len(payload.outputs)}), rev={rev}", serial)
    await manager.broadcast(
        serial,
        {"type": "outputs", "outputs": [o.model_dump() for o in payload.outputs], "rev": rev},
    )
    return {"ok": True, "serial": serial, "rev": rev}


@router.get("/api/hda/{serial}/pending")
async def pending(serial: str, since: int = Query(0, ge=0)) -> dict:
    """Lightweight dirty check used by the HDA 30fps sync poller."""
    _check_serial(serial)
    rev = get_state().workspaces.get_or_create(serial).output_rev()
    return {"pending": rev > since, "rev": rev}


@router.get("/api/hda/{serial}/logs")
async def serial_logs(
    serial: str,
    level: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    _check_serial(serial)
    return {"logs": get_state().logs.query(level=level, limit=limit, serial=serial)}


@router.get("/api/logs")
async def global_logs(
    level: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
) -> dict:
    return {"logs": get_state().logs.query(level=level, limit=limit)}
