import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDataflow, displayNodeOutputIndex, type DataflowDeps } from "../src/core/dataflow";
import { store } from "../src/stores/workspace";
import type { NetworkNode, NetworkSnapshot } from "../src/nodes2/network";
import type { OutputBuffer } from "../src/protocol/types";

/**
 * displayNodeOutputIndex (viewport realtime P1): a displayed null/transform whose
 * out0 connects DIRECTLY into an _output_ node's input socket (out0..out3) reuses
 * the already-computed store.outputs[i] buffer; anything else (mid-chain display,
 * disconnected, out-of-scope node kind) falls back to a fresh computeNodeResult.
 * The flush/refreshNodeFlags tests verify the dedup + ordering contract with a
 * fake graph/viewport (no DOM, no bridge).
 */

const mocks = vi.hoisted(() => ({
  computeNodeResult: vi.fn(),
}));
vi.mock("../src/nodes2/network", () => ({ computeNodeResult: mocks.computeNodeResult }));

function n(id: string, kind: string): NetworkNode {
  return { id, kind, label: id, params: [] };
}

function c(source: string, sourceOutput: string, target: string, targetInput: string) {
  return { source, sourceOutput, target, targetInput };
}

function makeBuffer(index: number, points: number[][]): OutputBuffer {
  return {
    index,
    rev: 1,
    pointCount: points.length,
    primCount: 1,
    points,
    curves: [{ pointIndices: points.map((_, i) => i), widths: null }],
    faces: [],
    attributes: {},
  };
}

describe("displayNodeOutputIndex", () => {
  it("direct display.out0 -> output.out1 returns 1", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), n("disp", "transform"), n("out", "output")],
      connections: [c("in", "in0", "disp", "in0"), c("disp", "out0", "out", "out1")],
    };
    expect(displayNodeOutputIndex(snap, "disp")).toBe(1);
  });

  it("display out0 feeds a null before the output -> null (display is not the last node)", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), n("disp", "transform"), n("mid", "null"), n("out", "output")],
      connections: [
        c("in", "in0", "disp", "in0"),
        c("disp", "out0", "mid", "in0"),
        c("mid", "out0", "out", "out0"),
      ],
    };
    expect(displayNodeOutputIndex(snap, "disp")).toBeNull();
  });

  it("no connection -> null", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("disp", "transform"), n("out", "output")],
      connections: [],
    };
    expect(displayNodeOutputIndex(snap, "disp")).toBeNull();
  });

  it("display node is an input -> out of scope, returns null", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), n("out", "output")],
      connections: [c("in", "in0", "out", "out0")],
    };
    expect(displayNodeOutputIndex(snap, "in")).toBeNull();
  });
});

/** A displayed transform whose out0 feeds output.out0 directly (the P1 hot path). */
const TF_DIRECT_SNAP: NetworkSnapshot = {
  nodes: [n("in", "input"), n("disp", "transform"), n("out", "output")],
  connections: [c("in", "in0", "disp", "in0"), c("disp", "out0", "out", "out0")],
};

const FLAGS = { display: false, bypass: false, freeze: false, reference: false };

interface FakeViewport {
  showNodeResult: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  order: string[];
}

/** Build a fake DataflowDeps wired to a displayed transform graph + a call-logging viewport. */
function makeDeps(overrides: { snap?: NetworkSnapshot; portIndex?: number | null } = {}): {
  deps: DataflowDeps;
  viewport: FakeViewport;
} {
  const snap = overrides.snap ?? TF_DIRECT_SNAP;
  const order: string[] = [];
  const viewport = {
    showNodeResult: vi.fn((_b: OutputBuffer | null) => order.push("showNodeResult")),
    refresh: vi.fn(() => order.push("refresh")),
    setVisibility: vi.fn(() => order.push("setVisibility")),
    setDisplayFocus: vi.fn(() => order.push("setDisplayFocus")),
    setReference: vi.fn(() => order.push("setReference")),
    isEnterActive: () => false,
    pickByNode: vi.fn(),
  };
  const graph = {
    editor: {
      getNodes: () => [
        { id: "in", kind: "input", params: [], flags: FLAGS },
        { id: "disp", kind: "transform", params: [], flags: { ...FLAGS, display: true } },
        { id: "out", kind: "output", params: [], flags: FLAGS },
      ],
    },
    getDisplayNode: () => ({ kind: "transform", flags: { ...FLAGS, display: true } }),
    getDisplayPortIndex: () => overrides.portIndex ?? 0,
    getNetworkSnapshot: () => snap,
    getFlags: () => undefined,
  };
  const deps: DataflowDeps = {
    getGraph: () => graph as never,
    getNetwork: () => ({ run: async () => undefined }),
    getViewport: () => viewport as never,
    getGizmo: () => ({ onParamsApplied: vi.fn(), bindToSelection: vi.fn() }),
    flushParamUndo: vi.fn(),
    refreshSelectionPanels: vi.fn(),
  };
  return {
    deps,
    viewport: {
      showNodeResult: viewport.showNodeResult,
      refresh: viewport.refresh,
      order,
    },
  };
}

describe("flush displayBuffer dedup (P1)", () => {
  beforeEach(() => {
    store.inputs = [];
    store.outputs = [];
    mocks.computeNodeResult.mockReset();
    mocks.computeNodeResult.mockReturnValue(makeBuffer(0, [[9, 9, 9]]));
  });

  it("reuses store.outputs[i] when the display transform directly feeds output.out0 - no re-trace", () => {
    const out0 = makeBuffer(0, [[5, 0, 0], [6, 0, 0]]);
    store.outputs = [out0];
    const { deps, viewport } = makeDeps();
    const df = createDataflow(deps);

    df.flush();

    expect(mocks.computeNodeResult).not.toHaveBeenCalled();
    expect(viewport.showNodeResult).toHaveBeenCalledWith(out0);
    // refreshNodeFlags (showNodeResult) runs BEFORE viewport.refresh() (Agent A contract)
    expect(viewport.order.indexOf("showNodeResult")).toBeLessThan(viewport.order.indexOf("refresh"));
  });

  it("falls back to computeNodeResult when no matching store.outputs buffer", () => {
    store.outputs = [makeBuffer(1, [[7, 0, 0]])]; // out1 only - no index-0 match
    const { deps, viewport } = makeDeps();
    const df = createDataflow(deps);

    df.flush();

    expect(mocks.computeNodeResult).toHaveBeenCalledTimes(1);
    expect(mocks.computeNodeResult).toHaveBeenCalledWith(TF_DIRECT_SNAP, store.inputs, "disp");
    expect(viewport.showNodeResult).toHaveBeenCalledWith(mocks.computeNodeResult.mock.results[0].value);
  });

  it("computes when the display is NOT the last node (out0 -> null -> output)", () => {
    const snap: NetworkSnapshot = {
      nodes: [n("in", "input"), n("disp", "transform"), n("mid", "null"), n("out", "output")],
      connections: [
        c("in", "in0", "disp", "in0"),
        c("disp", "out0", "mid", "in0"),
        c("mid", "out0", "out", "out0"),
      ],
    };
    store.outputs = [makeBuffer(0, [[5, 0, 0], [6, 0, 0]])];
    const { deps } = makeDeps({ snap });
    const df = createDataflow(deps);

    df.flush();

    expect(mocks.computeNodeResult).toHaveBeenCalledTimes(1);
    expect(mocks.computeNodeResult).toHaveBeenCalledWith(snap, store.inputs, "disp");
  });

  it("refreshNodeFlags() with NO argument still computes the node result (flag-change path)", () => {
    const { deps, viewport } = makeDeps();
    const df = createDataflow(deps);

    df.refreshNodeFlags();

    expect(mocks.computeNodeResult).toHaveBeenCalledTimes(1);
    expect(mocks.computeNodeResult).toHaveBeenCalledWith(TF_DIRECT_SNAP, store.inputs, "disp");
    expect(viewport.showNodeResult).toHaveBeenCalledWith(mocks.computeNodeResult.mock.results[0].value);
  });
});