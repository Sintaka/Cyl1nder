"""FastAPI app factory + module-level app for uvicorn."""
from __future__ import annotations

from fastapi import FastAPI

from . import compute  # noqa: F401  (registers executors)
from .protocol import VERSION
from .routes import router as rest_router
from .state import get_state
from .ws import router as ws_router


def create_app() -> FastAPI:
    app = FastAPI(title="Cyl1nder Bridge", version=VERSION)
    app.include_router(rest_router)
    app.include_router(ws_router)
    get_state().logs.info("main", f"bridge up (v{VERSION})")
    return app


app = create_app()
