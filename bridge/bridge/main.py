"""FastAPI app factory + module-level app for uvicorn."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import compute  # noqa: F401  (registers executors)
from .channel_routes import router as channel_routes_router
from .houdini_routes import router as houdini_routes_router
from .protocol import VERSION
from .routes import router as rest_router
from .snapshot import flush_all_workspaces, restore_all_workspaces
from .snapshot_routes import router as snapshot_routes_router
from .state import get_state
from .ws import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: repopulate empty workspaces from disk; shutdown: force-flush to disk.

    Startup restore covers scenario B (bridge restarts with a live registry but
    zeroed in-memory workspaces); shutdown flush catches the last <=5s window of
    edits that the 5s-throttled maybe_snapshot has not yet written.
    """
    st = get_state()
    n = restore_all_workspaces()
    st.logs.info("main", f"startup: restored {n} workspace(s) from snapshot")
    yield
    flush_all_workspaces()


def create_app() -> FastAPI:
    app = FastAPI(title="Cyl1nder Bridge", version=VERSION, lifespan=lifespan)
    # local-only bridge: allow browser origin (http://127.0.0.1:<any>) to call REST
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(rest_router)
    app.include_router(snapshot_routes_router)
    app.include_router(houdini_routes_router)
    app.include_router(channel_routes_router)
    app.include_router(ws_router)
    get_state().logs.info("main", f"bridge up (v{VERSION})")
    return app


app = create_app()
