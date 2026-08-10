"""python -m bridge : start REST + WebSocket server on 127.0.0.1:8375."""
import uvicorn

from .protocol import HOST, PORT


def main() -> None:
    uvicorn.run("bridge.main:app", host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
