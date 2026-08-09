import { describe, expect, it } from "vitest";
import { DEFAULT_FLAGS, isFrozen, type NodeFlags } from "../src/nodes/flags";
import { getFlags, setFlags } from "../src/nodes/cyl1nderNode";
import type { Node } from "@antv/x6";

/** Minimal X6-like node stub for flag persistence logic. */
function stubNode(data: unknown = {}) {
  const node = {
    _d: data,
    getData: () => node._d,
    setData: (d: unknown) => {
      node._d = d;
    },
    attr: () => "" as never,
  };
  return node as unknown as Node;
}

describe("node flags", () => {
  it("defaults flags when none stored", () => {
    const n = stubNode({});
    expect(getFlags(n)).toEqual(DEFAULT_FLAGS);
  });

  it("merges partial stored flags", () => {
    const n = stubNode({ flags: { bypass: true } });
    expect(getFlags(n).bypass).toBe(true);
    expect(getFlags(n).display).toBe(true);
  });

  it("setFlags persists and merges", () => {
    const n = stubNode({ flags: { display: true } });
    const f: NodeFlags = setFlags(n, { freeze: true });
    expect(f.freeze).toBe(true);
    expect(getFlags(n).freeze).toBe(true);
    expect(getFlags(n).display).toBe(true);
  });

  it("isFrozen reflects freeze", () => {
    expect(isFrozen({ ...DEFAULT_FLAGS, freeze: true })).toBe(true);
    expect(isFrozen(DEFAULT_FLAGS)).toBe(false);
  });
});
