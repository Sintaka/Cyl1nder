"""One-off WS timeline push verification (not committed)."""
import asyncio, json, sys, time
sys.path.insert(0, r"D:\code\dev\Cyl1nder\bridge")
import websockets  # noqa: E402  (bridge venv has it? fallback below)

SERIAL = "C1-msm6dsp7-ob6t"
WS_URL = f"ws://127.0.0.1:8375/ws?serial={SERIAL}&proto=json"

from bridge.houdini_mcp import set_frame, get_frame  # noqa: E402


async def main():
    # feed the poller: one GET /timeline keeps it alive for _TL_IDLE (10s)
    import urllib.request
    urllib.request.urlopen(f"http://127.0.0.1:8375/api/hda/{SERIAL}/timeline", timeout=5).read()
    events = []
    async with websockets.connect(WS_URL) as ws:
        # consume hello + replay
        for _ in range(3):
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
            except asyncio.TimeoutError:
                break
        # start listener task
        async def listen():
            try:
                while True:
                    m = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                    if m.get("type") == "timeline":
                        events.append(time.perf_counter())
            except Exception:
                pass

        lt = asyncio.create_task(listen())
        base = float(get_frame(8100)["frame"])
        # scrub: 30 frame changes, 200ms apart (no C->H saturation - pure H->C path)
        for i in range(1, 31):
            set_frame(8100, base + i * 0.5)
            await asyncio.sleep(0.2)
        await asyncio.sleep(1.0)
        lt.cancel()
        await asyncio.gather(lt, return_exceptions=True)
        # restore frame
        set_frame(8100, base)

    if len(events) < 2:
        print(f"FAIL: only {len(events)} timeline events")
        return
    gaps = [events[i + 1] - events[i] for i in range(len(events) - 1)]
    gaps.sort()
    avg = sum(gaps) / len(gaps)
    print(f"timeline events: {len(events)} in ~2.9s -> ~{len(events)/2.9:.1f}/s, "
          f"avg gap {avg*1000:.0f}ms, p50 {gaps[len(gaps)//2]*1000:.0f}ms, "
          f"min {gaps[0]*1000:.0f}ms")
    print(f"first frame={events[0] and 'ok'}  (expect ~15Hz => avg gap ~66ms)")


try:
    asyncio.run(main())
except ImportError:
    print("websockets not installed in bridge venv - skip (report manually)")
