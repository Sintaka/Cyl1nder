// 纯逻辑测试：overview.ts「项目优先」改版新增的纯函数 + projects.ts 的逻辑名 URL 编码。
// 不测 DOM（vitest 为 node 环境；overview.ts 的页面块在无 document 时整体跳过，纯函数照常可导入）。
import { describe, expect, it } from "vitest";
import type {
  AnchorProbeResult,
  AnchorRef,
  ChannelRef,
  MappingsResponse,
  ProjectRef,
} from "../src/protocol/types";
import {
  UNNAMED_PROJECT,
  type AnchorProbeEntry,
  anchorEvidenceTitle,
  anchorPidText,
  anchorSerialsOf,
  bestMemberLabel,
  channelValueString,
  cleanupSummary,
  defaultProjectName,
  mappingRowHtml,
  mappingRows,
  parseMappingInput,
  probeVerdict,
  projectDisplayName,
  projectStatusLight,
  valuePlaceholder,
} from "../src/overview";
import { encodeMappingName } from "../src/stores/projects";
import { channelIdOf } from "../src/stores/channels";
import { INVALID_CHANNEL_VALUE, parseChannelValue } from "../src/app/channel-value";

const SERIAL = "C1-mst8wa94-8uz8";

const tag = (over: Partial<ChannelRef> = {}): ChannelRef => ({
  kind: "tag",
  serial: SERIAL,
  nodePath: "/obj/geo1/tag1",
  hip: "scene.hip",
  label: "吊牌",
  registeredAt: 1000,
  lastSeen: 2000,
  ...over,
});

const param = (over: Partial<ChannelRef> = {}): ChannelRef => ({
  kind: "param",
  serial: SERIAL,
  nodePath: "/obj/geo1/tag1",
  absolutePath: "/obj/geo1/transform1/tx",
  hip: "scene.hip",
  label: "tx",
  registeredAt: 1000,
  lastSeen: 2000,
  ...over,
});

const project = (over: Partial<ProjectRef> = {}): ProjectRef => ({
  projectSerial: "P1-m1abc2d3e-ab12",
  label: "角色绑定",
  createdAt: 1000,
  updatedAt: 1000,
  members: [],
  ...over,
});

describe("projectDisplayName（序列号尾巴修复）", () => {
  it("真名原样显示", () => {
    expect(projectDisplayName(project({ label: "角色绑定" }))).toBe("角色绑定");
  });

  it("label 为空 → 未命名项目 + 最佳成员名", () => {
    const p = project({ label: "", members: [tag({ label: "手部吊牌" })] });
    expect(projectDisplayName(p)).toBe(`${UNNAMED_PROJECT} · 手部吊牌`);
  });

  it("label 只是空白也算空", () => {
    expect(projectDisplayName(project({ label: "   ", members: [] }))).toBe(UNNAMED_PROJECT);
  });

  it("label 等于某成员 serial → 未命名项目 + 最佳成员名（不以序列号打头）", () => {
    const p = project({ label: SERIAL, members: [tag({ serial: SERIAL, label: "手部吊牌" })] });
    const name = projectDisplayName(p);
    expect(name).toBe(`${UNNAMED_PROJECT} · 手部吊牌`);
    expect(name.startsWith("C1-")).toBe(false);
    expect(name).not.toContain(SERIAL);
  });

  it("label 是 C1- 序列号但成员已被移除 → 仍不显示序列号", () => {
    expect(projectDisplayName(project({ label: SERIAL, members: [] }))).toBe(UNNAMED_PROJECT);
  });

  it("label 等于成员 channelId（param 通道 = absolutePath）→ 视为无意义名", () => {
    const p = project({ label: "/obj/geo1/transform1/tx", members: [param()] });
    expect(projectDisplayName(p)).toBe(`${UNNAMED_PROJECT} · tx`);
  });

  it("无成员且 label 空 → 只写未命名项目", () => {
    expect(projectDisplayName(project({ label: "", members: [] }))).toBe(UNNAMED_PROJECT);
  });

  it("members 缺失（旧响应）不抛", () => {
    expect(projectDisplayName({ ...project({ label: "" }), members: undefined as unknown as ChannelRef[] })).toBe(
      UNNAMED_PROJECT,
    );
  });

  it("永不把 projectSerial 当可见名（P1- 也是序列号尾巴）", () => {
    const p = project({ label: "", members: [tag({ label: "" })] });
    expect(projectDisplayName(p)).not.toContain("P1-");
  });

  it("label 等于项目自身 P1- 序列号 → 未命名项目", () => {
    const pid = "P1-m1abc2d3e-ab12";
    expect(projectDisplayName(project({ projectSerial: pid, label: pid, members: [] }))).toBe(UNNAMED_PROJECT);
  });
});

describe("bestMemberLabel", () => {
  it("优先取非序列号 label", () => {
    expect(bestMemberLabel([tag({ label: "手部吊牌" })])).toBe("手部吊牌");
  });

  it("label 本身是序列号 → 回退路径尾段", () => {
    expect(bestMemberLabel([tag({ label: SERIAL })])).toBe("tag1");
    expect(bestMemberLabel([param({ label: SERIAL })])).toBe("tx");
  });

  it("跳过完全没有线索的成员", () => {
    const blank = tag({ label: "", nodePath: "", absolutePath: null });
    expect(bestMemberLabel([blank, tag({ label: "第二个" })])).toBe("第二个");
  });

  it("全无线索返回空串", () => {
    expect(bestMemberLabel([tag({ label: "", nodePath: "" })])).toBe("");
    expect(bestMemberLabel([])).toBe("");
  });
});

describe("defaultProjectName", () => {
  it("留空时按现有数量顺延「项目 N」", () => {
    expect(defaultProjectName(0)).toBe("项目 1");
    expect(defaultProjectName(3)).toBe("项目 4");
  });

  it("非法计数按 0 处理（永不产出序列号名）", () => {
    expect(defaultProjectName(-1)).toBe("项目 1");
    expect(defaultProjectName(NaN)).toBe("项目 1");
    expect(defaultProjectName(2.7)).toBe("项目 3");
  });
});

describe("projectStatusLight", () => {
  const now = 10_000_000_000_00; // 固定 now，避免真实时钟影响

  it("无成员 → 空", () => {
    expect(projectStatusLight(project({ members: [] }), now).state).toBe("empty");
  });

  it("有成员心跳在阈值内 → 在线（带 live/total）", () => {
    const p = project({ members: [tag({ lastSeen: now }), tag({ serial: "C1-bbbbbbbb-cccc", lastSeen: 0 })] });
    const light = projectStatusLight(p, now);
    expect(light.state).toBe("online");
    expect(light.text).toBe("在线 1/2");
  });

  it("全部超时 → 离线", () => {
    expect(projectStatusLight(project({ members: [tag({ lastSeen: 1 })] }), now).state).toBe("offline");
  });

  // v0.1.00114：成员快照的 lastSeen 是加入项目时的**冻结值**，只看它会把活着的成员
  // 判成离线（实测线上快照 13081s vs live 2938s）。状态灯必须优先看 /api/channels
  // 大全构建的 live 表。
  it("live lastSeen 覆盖成员快照的陈旧值 → 在线", () => {
    const m = tag({ lastSeen: 1 }); // 快照早已过期
    const p = project({ members: [m] });
    expect(projectStatusLight(p, now).state).toBe("offline"); // 无 live 表时仍按快照
    const live = { [channelIdOf(m)]: now / 1000 }; // live 表新鲜（秒级 epoch）
    expect(projectStatusLight(p, now, live).state).toBe("online");
  });

  it("live 表缺该通道 / 为 0 时退回快照（不因缺表整片变离线）", () => {
    const fresh = tag({ lastSeen: now / 1000 });
    const p = project({ members: [fresh] });
    expect(projectStatusLight(p, now, {}).state).toBe("online");
    expect(projectStatusLight(p, now, { [channelIdOf(fresh)]: 0 }).state).toBe("online");
  });

  it("无心跳文案不断言节点已死（吊牌只在 cook 时心跳）", () => {
    const light = projectStatusLight(project({ members: [tag({ lastSeen: 1 })] }), now);
    expect(light.text).toBe("无心跳");
    expect(light.title).toContain("cook");
  });
});

// ---- 降级前实证：心跳 × 探测 ----
// 心跳只证明「最近 cook 过」。吊牌坐着不 cook 一小时是正常的（实测线上健康吊牌
// 心跳已 2938s），所以心跳超时**只是触发探测**，结论由 pid 核对给出。

const probe = (over: Partial<AnchorProbeResult> = {}): AnchorProbeResult => ({
  serial: SERIAL,
  alive: true,
  pidMatched: true,
  port: 8100,
  expectedPid: 21484,
  actualPid: 21484,
  hip: "scene.hip",
  reason: "",
  ...over,
});

const done = (r: AnchorProbeResult): AnchorProbeEntry => ({ status: "done", result: r });

describe("probeVerdict（契约语义：alive 不等于健康）", () => {
  it("alive 且 pid 匹配 → alive（同一实例确认活着）", () => {
    expect(probeVerdict(probe())).toBe("alive");
  });

  it("alive 但 pid 不匹配 → replaced（端口被另一个 Houdini 占了，不是健康）", () => {
    expect(probeVerdict(probe({ pidMatched: false, actualPid: 99999 }))).toBe("replaced");
  });

  it("不 alive → dead", () => {
    expect(probeVerdict(probe({ alive: false, pidMatched: false, actualPid: 0 }))).toBe("dead");
  });

  it("expectedPid=0 → unverifiable（旧版吊牌没上报 pid，无从核对）", () => {
    // 即使桥回了 alive=true，没有期望 pid 就没有可核对的东西 → 不给结论
    expect(probeVerdict(probe({ expectedPid: 0, alive: true, pidMatched: false }))).toBe("unverifiable");
    expect(probeVerdict(probe({ expectedPid: 0, alive: false }))).toBe("unverifiable");
  });
});

describe("projectStatusLight × 探测（四种结局）", () => {
  const now = 10_000_000_000_00;
  const stale = () => project({ members: [tag({ lastSeen: 1 })] }); // 心跳早已超时
  const fresh = () => project({ members: [tag({ lastSeen: now })] });

  it("心跳新鲜 → 在线，且**根本不看**探测（省 Houdini 往返）", () => {
    const gone = { [SERIAL]: done(probe({ alive: false, pidMatched: false })) };
    const light = projectStatusLight(fresh(), now, undefined, gone);
    expect(light.state).toBe("online");
    expect(light.text).toBe("在线 1/1");
  });

  it("心跳超时 + 未探测 → 无心跳，并提示可能只是没 cook", () => {
    const light = projectStatusLight(stale(), now, undefined, {});
    expect(light.state).toBe("offline");
    expect(light.text).toBe("无心跳");
    expect(light.title).toContain("可能只是没 cook");
    expect(light.text).not.toContain("离线"); // 心跳年龄证不了「不在了」
  });

  it("心跳超时 + 探测确认存活 → 在线（未 cook），不是降级", () => {
    const light = projectStatusLight(stale(), now, undefined, { [SERIAL]: done(probe()) });
    expect(light.state).toBe("idle");
    expect(light.text).toBe("在线（未 cook）");
    expect(light.title).toContain("存活");
  });

  it("心跳超时 + 探测确认没了（!alive）→ 失联", () => {
    const light = projectStatusLight(stale(), now, undefined, {
      [SERIAL]: done(probe({ alive: false, pidMatched: false, actualPid: 0, reason: "connection refused" })),
    });
    expect(light.state).toBe("gone");
    expect(light.text).toContain("失联");
    expect(light.title).toContain("connection refused");
  });

  // 契约里最容易搞错的一格：端口有人应答 ≠ 我们的吊牌还在。
  it("alive 但 pid 不匹配 **绝不能**渲染成健康 → 失联（实例已换）", () => {
    const light = projectStatusLight(stale(), now, undefined, {
      [SERIAL]: done(probe({ pidMatched: false, actualPid: 77777 })),
    });
    expect(light.state).toBe("gone");
    expect(light.state).not.toBe("online");
    expect(light.state).not.toBe("idle");
    expect(light.text).toBe("失联（实例已换）");
    expect(light.title).toContain("另一个进程");
    expect(light.title).toContain("77777"); // 实际 pid 摆出来做证据
  });

  it("expectedPid=0 → 「无法核实」，不给假判决", () => {
    const light = projectStatusLight(stale(), now, undefined, {
      [SERIAL]: done(probe({ expectedPid: 0, alive: true, pidMatched: false })),
    });
    expect(light.state).toBe("offline"); // 不是 gone：没证据说它死了
    expect(light.text).toBe("无心跳（无法核实）");
    expect(light.title).toContain("没上报 pid");
    expect(light.text).not.toContain("失联");
  });

  it("探测在飞 → 检测中…（别在结论没出来前下判断）", () => {
    const light = projectStatusLight(stale(), now, undefined, { [SERIAL]: { status: "checking" } });
    expect(light.state).toBe("checking");
    expect(light.text).toBe("检测中…");
  });

  it("探不动（桥离线/接口未就绪）→ 退回诚实的无心跳，原因进 title", () => {
    const light = projectStatusLight(stale(), now, undefined, {
      [SERIAL]: { status: "error", error: "Failed to fetch" },
    });
    expect(light.state).toBe("offline");
    expect(light.text).toBe("无心跳");
    expect(light.title).toContain("Failed to fetch");
  });

  it("无成员时探测无关 → 仍是空", () => {
    expect(projectStatusLight(project({ members: [] }), now, undefined, { [SERIAL]: done(probe()) }).state).toBe(
      "empty",
    );
  });

  it("多锚点：任一确认存活即算在线（未 cook），优先于失联", () => {
    const other = "C1-bbbbbbbb-cccc";
    const p = project({ members: [tag({ lastSeen: 1 }), tag({ serial: other, lastSeen: 1 })] });
    const light = projectStatusLight(p, now, undefined, {
      [SERIAL]: done(probe({ alive: false, pidMatched: false })),
      [other]: done(probe({ serial: other })),
    });
    expect(light.state).toBe("idle");
  });

  it("3 参旧签名照旧可用（追加参数不改序）", () => {
    expect(projectStatusLight(stale(), now).state).toBe("offline");
    expect(projectStatusLight(stale(), now, {}).text).toBe("无心跳");
  });
});

describe("探测缓存按 serial 归属（A 的结论不能染到 B）", () => {
  const now = 10_000_000_000_00;
  const A = SERIAL;
  const B = "C1-bbbbbbbb-cccc";

  it("只有 A 有结论时，B 项目仍是未探测的「无心跳」", () => {
    const cache: Record<string, AnchorProbeEntry> = { [A]: done(probe({ alive: false, pidMatched: false })) };
    const pA = project({ projectSerial: "P1-aaaaaaaa-aa11", members: [tag({ serial: A, lastSeen: 1 })] });
    const pB = project({ projectSerial: "P1-bbbbbbbb-bb22", members: [tag({ serial: B, lastSeen: 1 })] });
    expect(projectStatusLight(pA, now, undefined, cache).state).toBe("gone");
    const lightB = projectStatusLight(pB, now, undefined, cache);
    expect(lightB.state).toBe("offline");
    expect(lightB.text).toBe("无心跳");
  });

  it("Map 与普通对象两种查表都支持（页面用 Map，单测用字面量）", () => {
    const p = project({ members: [tag({ lastSeen: 1 })] });
    const asMap = new Map<string, AnchorProbeEntry>([[A, done(probe())]]);
    expect(projectStatusLight(p, now, undefined, asMap).state).toBe("idle");
    expect(projectStatusLight(p, now, undefined, { [A]: done(probe()) }).state).toBe("idle");
  });

  it("A/B 各有相反结论时各自呈现（互不串台）", () => {
    const cache: Record<string, AnchorProbeEntry> = {
      [A]: done(probe()),
      [B]: done(probe({ serial: B, alive: false, pidMatched: false })),
    };
    const pA = project({ members: [tag({ serial: A, lastSeen: 1 })] });
    const pB = project({ members: [tag({ serial: B, lastSeen: 1 })] });
    expect(projectStatusLight(pA, now, undefined, cache).state).toBe("idle");
    expect(projectStatusLight(pB, now, undefined, cache).state).toBe("gone");
  });
});

describe("anchorSerialsOf（探测按锚点做，故要去重保序）", () => {
  it("去重且保持首次出现顺序", () => {
    const p = project({
      members: [tag({ serial: "C1-a" }), param({ serial: "C1-b" }), tag({ serial: "C1-a" })],
    });
    expect(anchorSerialsOf(p)).toEqual(["C1-a", "C1-b"]);
  });

  it("空/缺失 serial 被跳过，members 缺失不抛", () => {
    expect(anchorSerialsOf(project({ members: [tag({ serial: "" }), tag({ serial: null })] }))).toEqual([]);
    expect(anchorSerialsOf({ ...project(), members: undefined as unknown as ChannelRef[] })).toEqual([]);
  });
});

describe("锚点 pid/端口证据（用户要求记录的东西要看得见）", () => {
  const now = 10_000_000_000_00;

  it("正常上报 → pid + 端口", () => {
    expect(anchorPidText(anchor())).toBe("pid 21484:8100");
  });

  it("pid=0 → 明说「未上报 pid（旧版吊牌）」而不是裸 0", () => {
    const text = anchorPidText(anchor({ pid: 0, mcpPort: 0 }));
    expect(text).toBe("未上报 pid（旧版吊牌）");
    expect(text).not.toBe("pid 0:0");
    expect(text).not.toMatch(/\b0\b/);
  });

  it("有 pid 但端口没发现 → 点明端口缺失", () => {
    expect(anchorPidText(anchor({ mcpPort: 0 }))).toBe("pid 21484:未发现端口");
  });

  it("无锚点 → 空串（缺条目不抛）", () => {
    expect(anchorPidText(undefined)).toBe("");
  });

  it("title 给全景：hip / 心跳 / 核实", () => {
    const t = anchorEvidenceTitle(anchor({ lastSeen: now / 1000 - 2938, verifiedAt: now / 1000 - 10, verifiedAlive: true }), now);
    expect(t).toContain(SERIAL);
    expect(t).toContain("scene.hip");
    expect(t).toContain("pid 21484");
    expect(t).toContain("MCP 端口 8100");
    expect(t).toContain("48 分钟前"); // 2938s ≈ 48min：正常健康吊牌也能这么旧
    expect(t).toContain("cook");
    expect(t).toContain("仅供参考"); // 旧核实结论不是当前判决
  });

  it("从未核实 → 照实说，不装作有结论", () => {
    const t = anchorEvidenceTitle(anchor({ verifiedAt: 0 }), now);
    expect(t).toContain("尚未核实过存活");
    expect(t).not.toContain("仅供参考");
  });

  it("pid=0 的 title 说明为何无法核实", () => {
    const t = anchorEvidenceTitle(anchor({ pid: 0, mcpPort: 0 }), now);
    expect(t).toContain("无法核实存活");
    expect(t).toContain("MCP 端口未发现");
  });

  it("映射行渲染出 pid/端口证据", () => {
    const html = mappingRowHtml(mappingRows(mappings())[0]);
    expect(html).toContain("ov-anchor-pid");
    expect(html).toContain("pid 21484:8100");
  });

  it("映射行 pid=0 时标 nopid 且不显示裸 0", () => {
    const html = mappingRowHtml(mappingRows(mappings({ anchors: { [SERIAL]: anchor({ pid: 0, mcpPort: 0 }) } }))[0]);
    expect(html).toContain("nopid");
    expect(html).toContain("旧版吊牌");
    expect(html).not.toContain("pid 0");
  });

  it("锚点缺条目时不渲染证据小字（不抛）", () => {
    const html = mappingRowHtml(mappingRows(mappings({ anchors: {} }))[0]);
    expect(html).not.toContain("ov-anchor-pid");
  });
});

// ---- 映射行渲染 ----

// 锚点固件：pid/mcpPort/verifiedAt/verifiedAlive 是「降级前实证」新增的证据字段
// （见 protocol/types.ts AnchorRef）。默认给一个正常上报过 pid 的吊牌。
const anchor = (over: Partial<AnchorRef> = {}): AnchorRef => ({
  serial: SERIAL,
  nodePath: "/obj/geo1/tag1",
  hip: "scene.hip",
  mode: "parm",
  lastSeen: 2000,
  movedAt: 0,
  pid: 21484,
  mcpPort: 8100,
  verifiedAt: 0,
  verifiedAlive: false,
  ...over,
});

const mappings = (over: Partial<MappingsResponse> = {}): MappingsResponse => ({
  projectSerial: "P1-m1abc2d3e-ab12",
  entries: {
    "point_1/tx": { anchor: SERIAL, rel: "transform1/tx", kind: "param", type: "float", label: "tx" },
  },
  anchors: { [SERIAL]: anchor() },
  resolved: {
    "point_1/tx": {
      name: "point_1/tx",
      absolutePath: "/obj/geo1/transform1/tx",
      kind: "param",
      type: "float",
      anchor: SERIAL,
      ok: true,
      error: "",
    },
  },
  ...over,
});

describe("mappingRows", () => {
  it("按逻辑名排序并对齐 resolved / anchors", () => {
    const res = mappings({
      entries: {
        "b/ty": { anchor: SERIAL, rel: "transform1/ty", kind: "param", type: "float", label: "ty" },
        "a/tx": { anchor: SERIAL, rel: "transform1/tx", kind: "param", type: "float", label: "tx" },
      },
    });
    const rows = mappingRows(res);
    expect(rows.map((r) => r.name)).toEqual(["a/tx", "b/ty"]);
    expect(rows[0].anchor?.serial).toBe(SERIAL);
  });

  it("resolved / anchors 缺条目时行仍生成（undefined 不抛）", () => {
    const rows = mappingRows(mappings({ resolved: {}, anchors: {} }));
    expect(rows).toHaveLength(1);
    expect(rows[0].resolved).toBeUndefined();
    expect(rows[0].anchor).toBeUndefined();
  });
});

describe("mappingRowHtml", () => {
  it("正常行：逻辑名 / 类型 / 绝对路径 / 值输入框，且不标 broken", () => {
    const html = mappingRowHtml(mappingRows(mappings())[0]);
    expect(html).toContain("point_1/tx");
    expect(html).toContain('class="ov-kind float"');
    expect(html).toContain("/obj/geo1/transform1/tx");
    expect(html).toContain('data-map-name="point_1/tx"'); // 行内 input，不是 prompt
    expect(html).toContain('data-map-read="point_1/tx"');
    expect(html).toContain('data-map-write="point_1/tx"');
    expect(html).not.toContain("broken");
    expect(html).not.toContain("已移动");
  });

  it("锚点断裂（resolved.ok === false）：标 broken 且显示 error", () => {
    const res = mappings({
      resolved: {
        "point_1/tx": {
          name: "point_1/tx",
          absolutePath: "",
          kind: "param",
          type: "float",
          anchor: SERIAL,
          ok: false,
          error: "anchor C1-mst8wa94-8uz8 not found",
        },
      },
    });
    const html = mappingRowHtml(mappingRows(res)[0]);
    expect(html).toContain("broken");
    expect(html).toContain("anchor C1-mst8wa94-8uz8 not found");
    expect(html).toContain("ov-map-error");
    expect(html).not.toContain("data-map-name"); // 解析不出路径 → 不给可写输入框
  });

  it("锚点已移动（movedAt > 0）：已移动徽标 + 当前路径，且不算错误", () => {
    const res = mappings({
      anchors: { [SERIAL]: anchor({ nodePath: "/obj/geo2/tag1", movedAt: 5000 }) },
    });
    const html = mappingRowHtml(mappingRows(res)[0]);
    expect(html).toContain("已移动");
    expect(html).toContain("/obj/geo2/tag1"); // 当前路径
    expect(html).toContain("ov-badge moved");
    expect(html).not.toContain("broken"); // 移动是正常状态
  });

  it("解绑按钮恒在（断裂行/几何行也要能清掉）", () => {
    const okRow = mappingRowHtml(mappingRows(mappings())[0]);
    expect(okRow).toContain('data-map-delete="point_1/tx"');
    const brokenRow = mappingRowHtml(
      mappingRows(
        mappings({
          resolved: {
            "point_1/tx": {
              name: "point_1/tx",
              absolutePath: "",
              kind: "param",
              type: "float",
              anchor: SERIAL,
              ok: false,
              error: "gone",
            },
          },
        }),
      )[0],
    );
    expect(brokenRow).toContain('data-map-delete="point_1/tx"');
  });

  it("值输入框带类型（占位提示按 vec3/float 区分）", () => {
    const floatRow = mappingRowHtml(mappingRows(mappings())[0]);
    expect(floatRow).toContain('data-map-type="float"');
    expect(floatRow).toContain(".2");
    const vec3Res = mappings({
      entries: { p1: { anchor: SERIAL, rel: "point_1", kind: "data", type: "vec3", label: "point_1" } },
      resolved: {
        p1: {
          name: "p1",
          absolutePath: "/obj/geo1/point_1",
          kind: "data",
          type: "vec3",
          anchor: SERIAL,
          ok: true,
          error: "",
        },
      },
    });
    const vec3Row = mappingRowHtml(mappingRows(vec3Res)[0]);
    expect(vec3Row).toContain('data-map-type="vec3"');
    expect(vec3Row).toContain('class="ov-kind vec3"');
    expect(vec3Row).toContain("&quot;t&quot;"); // 占位提示里的对象样例被正确转义
  });

  it("geo 类型不给值输入框（几何走数据流）", () => {
    const res = mappings({
      entries: {
        "point_1/geo": { anchor: SERIAL, rel: "transform1", kind: "param", type: "geo", label: "geo" },
      },
      resolved: {
        "point_1/geo": {
          name: "point_1/geo",
          absolutePath: "/obj/geo1/transform1",
          kind: "param",
          type: "geo",
          anchor: SERIAL,
          ok: true,
          error: "",
        },
      },
    });
    const html = mappingRowHtml(mappingRows(res)[0]);
    expect(html).toContain("几何流");
    expect(html).not.toContain("data-map-name");
  });

  it("转义动态文本（逻辑名/错误里的引号与尖括号不破坏属性）", () => {
    const res = mappings({
      entries: {
        'a"<b>': { anchor: SERIAL, rel: "r", kind: "param", type: "float", label: "x" },
      },
      resolved: {},
    });
    const html = mappingRowHtml(mappingRows(res)[0]);
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain('a"<b>');
  });
});

// 实测值形状（live Houdini，主进程核对）：
//   GET …/mappings/sandbox_sceneanimate/point_1/value
//     -> {"ok":true,"value":{"ctrl":"/line1.char/Base.rig/point_1","t":[0.18,0.42,0.2],"r":[0,-0,0]}}
//   GET …/mappings/sandbox_sceneanimate/point_1/tx/value -> {"ok":true,"value":0.18}
// 即 vec3 行是**对象**（含 t/r 数组），float 行是**裸数字**——两种都要能显示并原样写回。
describe("值形状：vec3 对象 与 float 裸数字", () => {
  const VEC3 = { ctrl: "/line1.char/Base.rig/point_1", t: [0.18, 0.42, 0.2], r: [0, -0, 0] };

  it("vec3 对象回填为 JSON 全文，且能解析回等价对象（改 t 不丢 ctrl）", () => {
    const text = channelValueString(VEC3);
    expect(text).toContain('"ctrl"');
    expect(text).toContain('"t":[0.18,0.42,0.2]');
    // JSON 没有 -0（JSON.stringify(-0) === "0"），故实测载荷里的 r:[0,-0,0] 回来是 [0,0,0]。
    // 数值等价，对旋转无影响；这里显式记下这一处规范化，而不是假装没有。
    expect(parseMappingInput(text)).toEqual({ ...VEC3, r: [0, 0, 0] });
    expect(channelValueString(-0)).toBe("0");
  });

  it("float 裸数字回填后仍是数字，不被包成字符串或数组", () => {
    const text = channelValueString(0.18);
    expect(text).toBe("0.18");
    expect(parseMappingInput(text)).toBe(0.18);
  });

  it("vec3 的值不被当标量处理（对象不会退化成 NaN / 截断）", () => {
    const back = parseMappingInput(channelValueString(VEC3)) as Record<string, unknown>;
    expect(Array.isArray(back.t)).toBe(true);
    expect((back.t as number[])[1]).toBe(0.42);
    expect(back.ctrl).toBe("/line1.char/Base.rig/point_1");
  });

  it("手输部分对象（只给 t）照旧可解析——桥侧决定合并语义", () => {
    expect(parseMappingInput('{"t":[0,1,0]}')).toEqual({ t: [0, 1, 0] });
  });
});

describe("valuePlaceholder（按类型提示真实值形状）", () => {
  it("vec3 提示对象而非三元数组", () => {
    expect(valuePlaceholder("vec3")).toContain('{"t"');
    expect(valuePlaceholder("vec3")).toContain("对象");
  });

  it("float 提示裸数字（含 .2 写法）", () => {
    expect(valuePlaceholder("float")).toContain(".2");
  });

  it("未知类型给通用提示", () => {
    expect(valuePlaceholder("")).toBe("值（JSON 或裸数字）");
    expect(valuePlaceholder("weird")).toBe("值（JSON 或裸数字）");
  });
});

describe("parseMappingInput（委托 parseChannelValue，不重写解析）", () => {
  it("裸小数 .2 → 0.2（JSON.parse 会在此报错，故证明未直接用 JSON.parse）", () => {
    expect(parseMappingInput(".2")).toBe(0.2);
    expect(() => JSON.parse(".2")).toThrow();
  });

  it("结构化 JSON → 对象", () => {
    expect(parseMappingInput('{"t":[0,1,0]}')).toEqual({ t: [0, 1, 0] });
  });

  it("垃圾输入 → INVALID_CHANNEL_VALUE 哨兵", () => {
    expect(parseMappingInput("abc")).toBe(INVALID_CHANNEL_VALUE);
    expect(parseMappingInput("")).toBe(INVALID_CHANNEL_VALUE);
    expect(parseMappingInput("1.2.3")).toBe(INVALID_CHANNEL_VALUE);
  });

  it("逐输入与 parseChannelValue 结果全等（委托关系断言）", () => {
    for (const raw of [".2", "-.5", "1.", "0", "null", "true", '{"t":[0,1,0]}', "[1,2,3]", "abc", "", "  .25 "]) {
      expect(parseMappingInput(raw)).toEqual(parseChannelValue(raw));
    }
  });
});

describe("encodeMappingName（逻辑名含 `/`）", () => {
  it("段间 `/` 原样保留（bridge 以 :path 捕获）", () => {
    expect(encodeMappingName("point_1/tx")).toBe("point_1/tx");
    expect(encodeMappingName("a/b/c")).toBe("a/b/c");
  });

  it("其余不安全字符按段转义", () => {
    expect(encodeMappingName("point 1/tx")).toBe("point%201/tx");
    expect(encodeMappingName("a#b/c?d")).toBe("a%23b/c%3Fd");
    expect(encodeMappingName("a%b")).toBe("a%25b");
  });

  it("中文逻辑名可编码且能解回原文", () => {
    const name = "点位/位移";
    expect(encodeMappingName(name)).toBe("%E7%82%B9%E4%BD%8D/%E4%BD%8D%E7%A7%BB");
    expect(decodeURIComponent(encodeMappingName(name))).toBe(name);
  });

  it("无 `/` 的普通名等价 encodeURIComponent", () => {
    expect(encodeMappingName("tx")).toBe(encodeURIComponent("tx"));
  });
});

describe("cleanupSummary", () => {
  it("空列表说明没有空项目", () => {
    expect(cleanupSummary([])).toBe("没有空项目");
  });

  it("列出前 5 个，超出加省略号", () => {
    expect(cleanupSummary(["P1-a", "P1-b"])).toBe("已清理 2 个空项目：P1-a、P1-b");
    expect(cleanupSummary(["a", "b", "c", "d", "e", "f"])).toContain("…");
    expect(cleanupSummary(["a", "b", "c", "d", "e", "f"])).toContain("已清理 6 个空项目");
  });
});
