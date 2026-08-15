// 纯逻辑测试：trace.ts 导出的纯函数（query 构造 / digest 单行截断 / 时间格式化 / actor 颜色映射）。
// 不测 DOM（vitest 为 node 环境；trace.ts 的页面块在无 #tr-root 时整体跳过，纯函数照常可导入）。
import { describe, expect, it } from "vitest";
import { actorColor, buildTraceQuery, formatTraceTime, truncateDigest } from "../src/trace";
import type { TraceFilters } from "../src/trace";

describe("buildTraceQuery", () => {
  it("空过滤返回空串", () => {
    expect(buildTraceQuery({})).toBe("");
  });

  it("非空值全部拼接", () => {
    const f: TraceFilters = {
      project: "P1-aaaaaaaa-bbbb",
      actor: "web-gizmo",
      action: "param-set",
      channel: "obj/geo1/transform1/tx",
      target: "tx",
      limit: 200,
    };
    expect(buildTraceQuery(f)).toBe(
      "project=P1-aaaaaaaa-bbbb&actor=web-gizmo&action=param-set&channel=obj%2Fgeo1%2Ftransform1%2Ftx&target=tx&limit=200",
    );
  });

  it("空值省略（空串 / undefined / limit 0）", () => {
    expect(buildTraceQuery({ project: "", actor: undefined, limit: 0 })).toBe("");
    expect(buildTraceQuery({ project: "P1-aaaaaaaa-bbbb", actor: "", limit: 0 })).toBe(
      "project=P1-aaaaaaaa-bbbb",
    );
    expect(buildTraceQuery({ actor: "bridge", limit: undefined })).toBe("actor=bridge");
  });

  it("URL 编码（channel 斜杠、target 空格）", () => {
    expect(buildTraceQuery({ channel: "obj/geo1/transform1/tx" })).toBe(
      "channel=obj%2Fgeo1%2Ftransform1%2Ftx",
    );
    expect(buildTraceQuery({ target: "tx y" })).toBe("target=tx+y");
  });
});

describe("truncateDigest", () => {
  it("短文本原样返回", () => {
    expect(truncateDigest("ok")).toBe("ok");
  });

  it("恰好 max 长度不截断", () => {
    expect(truncateDigest("a".repeat(80))).toBe("a".repeat(80));
  });

  it("超长截断为 max 字符加省略号", () => {
    expect(truncateDigest("x".repeat(100))).toBe("x".repeat(80) + "…");
    expect(truncateDigest("x".repeat(100))).toHaveLength(81);
  });

  it("自定义 max", () => {
    expect(truncateDigest("abcdef", 3)).toBe("abc…");
  });

  it("空白折叠为单空格（换行/制表符）", () => {
    expect(truncateDigest("a\nb\t c")).toBe("a b c");
  });
});

describe("formatTraceTime", () => {
  it("输出 YYYY-MM-DD HH:mm:ss（与 Date 本地分量一致，时区无关）", () => {
    const ts = 1_752_000_000_000; // 任意毫秒
    const d = new Date(ts);
    const p = (n: number): string => String(n).padStart(2, "0");
    const expected = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    expect(formatTraceTime(ts)).toBe(expected);
  });

  it("秒级与毫秒级时间戳等价", () => {
    const ms = 1_752_000_000_000;
    expect(formatTraceTime(ms)).toBe(formatTraceTime(Math.floor(ms / 1000)));
  });

  it("个位月/日/时/分/秒补零（本地时间构造 → 本地渲染必然一致）", () => {
    const d = new Date(2026, 0, 5, 3, 4, 6);
    expect(formatTraceTime(d.getTime())).toBe("2026-01-05 03:04:06");
  });
});

describe("actorColor", () => {
  const ACTORS = ["web-gizmo", "web-param", "runtime-python", "tag-hda", "hda-cook", "bridge"];

  it("6 类 actor 各有专属颜色（互不相同）", () => {
    const colors = ACTORS.map((a) => actorColor(a));
    expect(new Set(colors).size).toBe(6);
  });

  it("颜色稳定（与 trace.css 注释调色板一致）", () => {
    expect(actorColor("web-gizmo")).toBe("#9fd8ff"); // 蓝
    expect(actorColor("web-param")).toBe("#5eead4"); // 青
    expect(actorColor("runtime-python")).toBe("#c4b5fd"); // 紫
    expect(actorColor("tag-hda")).toBe("#7ce3a8"); // 绿
    expect(actorColor("hda-cook")).toBe("#9ca3af"); // 灰
    expect(actorColor("bridge")).toBe("#fde047"); // 黄
  });

  it("未知 actor 回退灰", () => {
    expect(actorColor("unknown")).toBe("#9ca3af");
    expect(actorColor("")).toBe("#9ca3af");
  });
});
