"""python -m bridge : start REST + WebSocket server on 127.0.0.1:8375."""
import uvicorn

from .protocol import HOST, PORT


def main() -> None:
    # web 推流无上限，uvicorn 的逐请求 access log 会刷屏；access_log=False 只关闭
    # HTTP 请求行日志，启动/错误日志仍保留。
    uvicorn.run("bridge.main:app", host=HOST, port=PORT, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
