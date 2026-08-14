"""One-off latency benchmark for fxhoudinimcp (not committed)."""
import sys, time, statistics
sys.path.insert(0, r"D:\code\dev\Cyl1nder\bridge")
from bridge.houdini_mcp import rpc, health, get_frame, set_frame

PORT = 8100

def bench(name, fn, n=40):
    times = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    print(f"{name}: n={n} avg={statistics.mean(times):.1f}ms p50={times[n//2]:.1f}ms "
          f"p95={times[int(n*0.95)]:.1f}ms min={times[0]:.1f}ms max={times[-1]:.1f}ms")

# warmup
get_frame(PORT)
bench("mcp.execute get_frame (dispatcher)", lambda: get_frame(PORT), 40)
bench("mcp.health (no dispatcher)", lambda: health(PORT), 20)

# set_frame round trip: send, then confirm via get_frame
t0 = time.perf_counter()
set_frame(PORT, 21.5)
t1 = time.perf_counter()
f = get_frame(PORT)["frame"]
t2 = time.perf_counter()
print(f"set_frame RPC: {(t1-t0)*1000:.1f}ms; confirm frame={f} (+{(t2-t1)*1000:.1f}ms)")
set_frame(PORT, 21.0)

# through-bridge latency (cold cache)
import urllib.request, json
def bridge_timeline():
    with urllib.request.urlopen("http://127.0.0.1:8375/api/hda/C1-msm6dsp7-ob6t/timeline", timeout=10) as r:
        return json.loads(r.read())
bridge_timeline()
bench("bridge GET /timeline (warm cache)", lambda: bridge_timeline(), 20)
print("done")
