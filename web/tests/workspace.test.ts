import { describe, expect, it, vi } from "vitest";
import type { InputPayload, OutputBuffer } from "../src/protocol/types";
import { WorkspaceStore } from "../src/stores/workspace";

const inp = (index: number): InputPayload => ({
  index,
  name: `in${index}`,
  pointCount: 1,
  primCount: 1,
  points: [[0, 0, 0]],
  curves: [],
  attributes: {},
});

const out = (index: number, rev: number): OutputBuffer => ({
  index,
  rev,
  pointCount: 1,
  primCount: 0,
  points: [[0, 0, 0]],
  curves: [],
  attributes: {},
});

describe("WorkspaceStore", () => {
  it("emits on setInputs and stores payloads", () => {
    const s = new WorkspaceStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.setInputs([inp(0), inp(1)], 1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.inputRev).toBe(1);
    expect(s.inputs).toHaveLength(2);
    expect(s.inputs[1].index).toBe(1);
  });

  it("upserts outputs by index and tracks rev", () => {
    const s = new WorkspaceStore();
    s.upsertOutputs([out(0, 1)], 1);
    s.upsertOutputs([out(0, 2)], 2);
    expect(s.outputs).toHaveLength(1);
    expect(s.outputs[0].rev).toBe(2);
    expect(s.outputRev).toBe(2);
  });

  it("clearOutputs resets outputs", () => {
    const s = new WorkspaceStore();
    s.upsertOutputs([out(0, 1)], 1);
    s.clearOutputs();
    expect(s.outputs).toHaveLength(0);
    expect(s.outputRev).toBe(0);
  });

  it("setSerial resets workspace state", () => {
    const s = new WorkspaceStore();
    s.setInputs([inp(0)], 1);
    s.setSerial("C1-aaaaaaaa-bbbb");
    expect(s.serial).toBe("C1-aaaaaaaa-bbbb");
    expect(s.inputs).toHaveLength(0);
    expect(s.inputRev).toBe(0);
  });
});