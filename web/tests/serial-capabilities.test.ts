import { beforeEach, describe, expect, it, vi } from "vitest";

// fetch 走 mock：单测**绝不碰真桥**（桥可能没开，且单测不该依赖外部进程状态）。
// 这里 mock 的是 BridgeClient 而不是 fetch —— loadCapabilities 的契约是"经 client 取一次"，
// 断言在那个边界上最稳（client 内部的 URL 拼法/错误归一由 client 自己负责）。
const getSerialCapabilities = vi.fn();
vi.mock("../src/bridge/client", () => ({
  BridgeClient: class {
    getSerialCapabilities(serial: string) {
      return getSerialCapabilities(serial);
    }
  },
}));

// param.ts 的纯选项构造器（下拉的 <option> 串）。renderParams 本身要 DOM，vitest 这里是
// environment:"node"（web/ 没装 jsdom），所以只测纯函数——它们承载的正是"当前值绝不被
// 悄悄改掉"这条硬性质，值得单独钉住。
import { portOptionText, portOptionsHtml, portPlaceholder } from "../src/app/param";
import {
  cachedCapabilities,
  cachedPortType,
  cachedPorts,
  invalidateCapabilities,
  loadCapabilities,
  normalizeSerial,
  sanitizeCapabilities,
  sanitizePortOptions,
  setCapabilities,
  toPortType,
  unknownCapabilities,
} from "../src/nodes2/serial-capabilities";

/** 实测过的真实响应形状（brief 里记录的 live 数据）：SOP HDA 侧。 */
const HDA = {
  serial: "C1-msm6dsp7-ob6t",
  kind: "hda",
  known: true,
  nodePath: "/obj/geo1/cyl1nder1",
  hip: "untitled.hip",
  inputs: [0, 1, 2, 3].map((i) => ({ key: `in${i}`, label: `In ${i + 1}`, type: "geo" })),
  outputs: [0, 1, 2, 3].map((i) => ({ key: `out${i}`, label: `Out ${i + 1}`, type: "geo" })),
};

/** 同上，吊牌 tag 侧：inputs 与 outputs 是**同一份**清单（参数天生双向读写）。 */
const TAG_OPTIONS = [
  { key: "transform1/tx", label: "tx", type: "float" },
  { key: "sceneanimate1/animation", label: "animation", type: "vec3" },
];
const TAG = {
  serial: "C1-mst8wa94-8uz8",
  kind: "tag",
  known: true,
  nodePath: "/obj/geo1/cyl1nder_tag1",
  hip: "untitled.hip",
  inputs: TAG_OPTIONS,
  outputs: TAG_OPTIONS,
};

beforeEach(() => {
  invalidateCapabilities(); // 模块级缓存跨测试共享 -> 每例先归零
  getSerialCapabilities.mockReset();
  vi.useRealTimers();
});

describe("normalizeSerial", () => {
  it("剔两端空白（地址框里多打的空格不该让查表失败）", () => {
    expect(normalizeSerial("  C1-msm6dsp7-ob6t ")).toBe("C1-msm6dsp7-ob6t");
  });

  it("空 / 非字符串 -> ''（= 还没填，不是错误）", () => {
    expect(normalizeSerial("")).toBe("");
    expect(normalizeSerial("   ")).toBe("");
    expect(normalizeSerial(undefined)).toBe("");
    expect(normalizeSerial(42)).toBe("");
  });
});

describe("toPortType —— 线上脏数据校验", () => {
  it("三个合法类型原样通过", () => {
    expect(toPortType("geo")).toBe("geo");
    expect(toPortType("float")).toBe("float");
    expect(toPortType("vec3")).toBe("vec3");
  });

  it("'' 是桥的「类型未知」，保持 ''（不补默认 geo）", () => {
    expect(toPortType("")).toBe("");
  });

  it("脏值 -> ''（**绝不**回落 geo：静默补类型会让连线校验放行错配的线）", () => {
    expect(toPortType("GEO")).toBe("");
    expect(toPortType("vector3")).toBe("");
    expect(toPortType(null)).toBe("");
    expect(toPortType(3)).toBe("");
  });
});

describe("sanitizePortOptions", () => {
  it("key 为空 / 非字符串的项被丢弃（下拉里没有 key 的选项无法回写）", () => {
    const out = sanitizePortOptions([
      { key: "in0", label: "In 1", type: "geo" },
      { key: "", label: "空", type: "geo" },
      { key: "   ", label: "空白", type: "geo" },
      { label: "无 key", type: "geo" },
      null,
    ]);
    expect(out.map((o) => o.key)).toEqual(["in0"]);
  });

  it("label 缺省 / 空白 -> 回落 key（宁可显示机器名，也不显示空行）", () => {
    const out = sanitizePortOptions([{ key: "out2", type: "geo" }, { key: "out3", label: "  ", type: "geo" }]);
    expect(out.map((o) => o.label)).toEqual(["out2", "out3"]);
  });

  it("非数组 -> 空清单（旧桥 / 字段缺失不该抛）", () => {
    expect(sanitizePortOptions(undefined)).toEqual([]);
    expect(sanitizePortOptions("nope")).toEqual([]);
  });
});

describe("sanitizeCapabilities", () => {
  it("HDA 实测响应原样通过（key 0 基、label 1 基 —— 契约不可改）", () => {
    const caps = sanitizeCapabilities(HDA.serial, HDA);
    expect(caps.kind).toBe("hda");
    expect(caps.known).toBe(true);
    expect(caps.inputs.map((o) => o.key)).toEqual(["in0", "in1", "in2", "in3"]);
    expect(caps.inputs.map((o) => o.label)).toEqual(["In 1", "In 2", "In 3", "In 4"]);
    expect(caps.outputs.map((o) => o.key)).toEqual(["out0", "out1", "out2", "out3"]);
  });

  it("tag 两侧同一份清单，各项带自己的类型（tx: float / animation: vec3）", () => {
    const caps = sanitizeCapabilities(TAG.serial, TAG);
    expect(caps.kind).toBe("tag");
    expect(caps.inputs).toEqual(caps.outputs);
    expect(caps.inputs.map((o) => [o.key, o.type])).toEqual([
      ["transform1/tx", "float"],
      ["sceneanimate1/animation", "vec3"],
    ]);
  });

  it("未知 serial：known:false + kind:'' + 两个空清单（**这是正常态，不是错误**）", () => {
    const caps = sanitizeCapabilities("C1-notreal00-zzzz", {
      serial: "C1-notreal00-zzzz",
      kind: "",
      known: false,
      nodePath: "",
      hip: "",
      inputs: [],
      outputs: [],
    });
    expect(caps.known).toBe(false);
    expect(caps.kind).toBe("");
    expect(caps.inputs).toEqual([]);
    expect(caps.outputs).toEqual([]);
  });

  it("known 只认真 true；未知 kind 归 ''（不把陌生 kind 当成某一族）", () => {
    expect(sanitizeCapabilities("s", { known: "yes", kind: "sop" }).known).toBe(false);
    expect(sanitizeCapabilities("s", { known: 1, kind: "sop" }).kind).toBe("");
  });

  it("null / 垃圾输入 -> 空能力（恒不抛：渲染路径上不能有异常）", () => {
    expect(sanitizeCapabilities("s", null)).toEqual(unknownCapabilities("s"));
    expect(sanitizeCapabilities("s", "garbage")).toEqual(unknownCapabilities("s"));
  });
});

describe("同步查缓存 —— null 是「还不知道」，不是「空清单」", () => {
  it("没取过 -> null（调用方据此显示「加载中」而不是「无端口」）", () => {
    expect(cachedCapabilities(HDA.serial)).toBeNull();
    expect(cachedPorts(HDA.serial, "inputs")).toBeNull();
  });

  it("取过就同步可读（面板渲染 <select> 的同一帧要拿到，不能 await）", () => {
    setCapabilities(HDA.serial, HDA);
    expect(cachedPorts(HDA.serial, "inputs")?.map((o) => o.key)).toEqual(["in0", "in1", "in2", "in3"]);
    expect(cachedPorts(HDA.serial, "outputs")?.map((o) => o.label)).toEqual(["Out 1", "Out 2", "Out 3", "Out 4"]);
  });

  it("空 serial -> null（没填地址没有清单）", () => {
    setCapabilities(HDA.serial, HDA);
    expect(cachedPorts("", "inputs")).toBeNull();
    expect(cachedPorts("   ", "inputs")).toBeNull();
  });

  it("查过的未知 serial -> 空清单（**不是** null：已经问过了，答案是「桥不认识」）", () => {
    setCapabilities("C1-notreal00-zzzz", { known: false, kind: "", inputs: [], outputs: [] });
    expect(cachedPorts("C1-notreal00-zzzz", "inputs")).toEqual([]);
  });
});

describe("cachedPortType —— 选中端口的类型由桥说，查不到就说不知道", () => {
  it("tag 逻辑名 -> 它自己的类型", () => {
    setCapabilities(TAG.serial, TAG);
    expect(cachedPortType(TAG.serial, "inputs", "transform1/tx")).toBe("float");
    expect(cachedPortType(TAG.serial, "outputs", "sceneanimate1/animation")).toBe("vec3");
  });

  it("HDA 端口 -> geo", () => {
    setCapabilities(HDA.serial, HDA);
    expect(cachedPortType(HDA.serial, "outputs", "out2")).toBe("geo");
  });

  it("未缓存 / 无此 key / 类型为 '' -> null（调用方据此**不动** type 参数）", () => {
    expect(cachedPortType(HDA.serial, "inputs", "in0")).toBeNull(); // 未缓存
    setCapabilities(HDA.serial, HDA);
    expect(cachedPortType(HDA.serial, "inputs", "in9")).toBeNull(); // 无此 key
    setCapabilities(TAG.serial, { ...TAG, inputs: [{ key: "weird", label: "weird", type: "nonsense" }] });
    expect(cachedPortType(TAG.serial, "inputs", "weird")).toBeNull(); // 脏类型 -> ''
  });
});

describe("loadCapabilities —— 缓存 / 合并 / 竞态", () => {
  it("取回来即入缓存，之后同步可读", async () => {
    getSerialCapabilities.mockResolvedValue(HDA);
    const caps = await loadCapabilities(HDA.serial, 0);
    expect(caps.kind).toBe("hda");
    expect(cachedPorts(HDA.serial, "inputs")).toHaveLength(4);
    expect(getSerialCapabilities).toHaveBeenCalledTimes(1);
  });

  it("已缓存 -> 不再发请求（**含 known:false 的否定结果**：问过就是问过）", async () => {
    getSerialCapabilities.mockResolvedValue({ serial: "C1-notreal00-zzzz", kind: "", known: false, inputs: [], outputs: [] });
    await loadCapabilities("C1-notreal00-zzzz", 0);
    await loadCapabilities("C1-notreal00-zzzz", 0);
    await loadCapabilities("C1-notreal00-zzzz", 0);
    expect(getSerialCapabilities).toHaveBeenCalledTimes(1);
  });

  it("空 serial 不发请求（半截地址的极端情形：一个字都没打）", async () => {
    const caps = await loadCapabilities("  ", 0);
    expect(caps.known).toBe(false);
    expect(getSerialCapabilities).not.toHaveBeenCalled();
  });

  it("同 serial 并发 -> 合并成一次请求（面板重渲染 + 地址事件可能同时触发）", async () => {
    getSerialCapabilities.mockResolvedValue(HDA);
    const [a, b, c] = await Promise.all([
      loadCapabilities(HDA.serial, 0),
      loadCapabilities(HDA.serial, 0),
      loadCapabilities(HDA.serial, 0),
    ]);
    expect(getSerialCapabilities).toHaveBeenCalledTimes(1);
    expect(a.kind).toBe("hda");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("防抖 latest-wins：逐字打完只发最后一个（中间态的答案没人要）", async () => {
    vi.useFakeTimers();
    getSerialCapabilities.mockResolvedValue(HDA);
    // 模拟用户逐字输入：每个中间态都会触发一次取用
    const partials = ["C", "C1-", "C1-msm6", "C1-msm6dsp7-ob"].map((s) => loadCapabilities(s, 50));
    const final = loadCapabilities(HDA.serial, 50);
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([...partials, final]);
    expect(getSerialCapabilities).toHaveBeenCalledTimes(1);
    expect(getSerialCapabilities).toHaveBeenCalledWith(HDA.serial);
    // 被取消的中间态用空能力收尾（**不悬着**：调用方 await 它不会卡死）
    expect((await partials[0]).known).toBe(false);
    vi.useRealTimers();
  });

  it("invalidate 作废在途结果：回来的旧响应**不入缓存**（过期清单比没清单更糟）", async () => {
    let release: ((v: unknown) => void) | null = null;
    getSerialCapabilities.mockReturnValue(new Promise((r) => { release = r; }));
    const p = loadCapabilities(HDA.serial, 0);
    await vi.waitFor(() => expect(getSerialCapabilities).toHaveBeenCalled());
    invalidateCapabilities(); // 切项目 / 桥重连
    release!(HDA);
    const caps = await p;
    expect(caps.known).toBe(false); // 结果被丢弃
    expect(cachedCapabilities(HDA.serial)).toBeNull(); // 缓存没被过期数据填上
  });

  it("client 抛错 -> 空能力，不 reject（桥离线是常态，不能让面板渲染崩）", async () => {
    getSerialCapabilities.mockRejectedValue(new Error("ECONNREFUSED"));
    const caps = await loadCapabilities(HDA.serial, 0);
    expect(caps).toEqual(unknownCapabilities(HDA.serial));
  });

  it("invalidate 后重新问桥（清单可能已经变了）", async () => {
    getSerialCapabilities.mockResolvedValue(HDA);
    await loadCapabilities(HDA.serial, 0);
    invalidateCapabilities();
    expect(cachedPorts(HDA.serial, "inputs")).toBeNull();
    await loadCapabilities(HDA.serial, 0);
    expect(getSerialCapabilities).toHaveBeenCalledTimes(2);
  });
});

describe("port 下拉选项构造 —— 当前值绝不被悄悄改掉", () => {
  const hdaPorts = sanitizePortOptions(HDA.outputs);
  const tagPorts = sanitizePortOptions(TAG.inputs);

  it("类型显示在选项里：吊牌逻辑名读作 `tx: float`（用户要求的形状）", () => {
    expect(portOptionText(tagPorts[0])).toBe("tx: float");
    expect(portOptionText(tagPorts[1])).toBe("animation: vec3");
    expect(portOptionText(hdaPorts[0])).toBe("Out 1: geo");
  });

  it("类型未知（'')-> 只显示 label，不编造类型", () => {
    expect(portOptionText({ key: "k", label: "k", type: "" })).toBe("k");
  });

  it("HDA：4 个选项，value 用 0 基 key，选中项落在当前值上", () => {
    const html = portOptionsHtml(hdaPorts, "out2", "未选择端口");
    expect(html).toContain('<option value="out0"');
    expect(html).toContain('<option value="out2" selected');
    expect(html.match(/<option /g)).toHaveLength(4); // 无占位（已选中）
  });

  it("当前值不在桥清单里 -> **保留**并标注，绝不静默改成清单里的第一个", () => {
    const html = portOptionsHtml(hdaPorts, "out9", "未选择端口");
    expect(html).toContain('<option value="out9" selected');
    expect(html).toContain("不在桥给出的清单里");
    expect(html.match(/<option /g)).toHaveLength(5); // 4 个 + 保留的当前值
  });

  it("清单还不知道（null，桥离线/在途）-> 当前值单独成选项，标注加载中", () => {
    const html = portOptionsHtml(null, "transform1/tx", "加载端口清单…");
    expect(html).toContain('<option value="transform1/tx" selected');
    expect(html).toContain("端口清单加载中");
    expect(html.match(/<option /g)).toHaveLength(1);
  });

  it("未选择 -> 占位 option（空 value + disabled，不会变成一个假端口）", () => {
    const html = portOptionsHtml(tagPorts, "", "未选择端口");
    expect(html).toContain('<option value="" selected disabled>未选择端口</option>');
    expect(html.match(/<option /g)).toHaveLength(3); // 占位 + 2 个逻辑名
  });

  it("key/label 里的引号与尖括号被转义（逻辑名是用户可控字符串）", () => {
    const html = portOptionsHtml([{ key: 'a"><b', label: 'a"><b', type: "float" }], "", "选");
    expect(html).not.toContain('"><b"');
    expect(html).toContain("&quot;");
  });

  it("占位四态分开说（能做的事完全不同：填地址 / 等 / 查地址 / 查 Houdini）", () => {
    expect(portPlaceholder("", null)).toBe("先填 address（一个 serial）");
    expect(portPlaceholder(HDA.serial, null)).toBe("加载端口清单…");
    // 查过且桥不认识 vs 查过桥认识但没端口
    setCapabilities("C1-notreal00-zzzz", { known: false, kind: "", inputs: [], outputs: [] });
    expect(portPlaceholder("C1-notreal00-zzzz", [])).toBe("桥未识别该 serial");
    setCapabilities("C1-empty0000-aaaa", { known: true, kind: "hda", inputs: [], outputs: [] });
    expect(portPlaceholder("C1-empty0000-aaaa", [])).toBe("该 serial 未提供端口");
  });
});
