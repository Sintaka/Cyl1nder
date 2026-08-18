import { describe, expect, it } from "vitest";
import { INVALID_CHANNEL_VALUE, parseChannelValue } from "../src/app/channel-value";

describe("parseChannelValue", () => {
  it("accepts a decimal with no leading zero (the reported bug: `.2` errored)", () => {
    expect(parseChannelValue(".2")).toBe(0.2);
    expect(parseChannelValue("-.5")).toBe(-0.5);
    expect(parseChannelValue("+.5")).toBe(0.5);
  });

  it("accepts a trailing-dot decimal", () => {
    expect(parseChannelValue("1.")).toBe(1);
  });

  it("still accepts ordinary numbers", () => {
    expect(parseChannelValue("0.2")).toBe(0.2);
    expect(parseChannelValue("2")).toBe(2);
    expect(parseChannelValue("0")).toBe(0);
    expect(parseChannelValue("1e-3")).toBe(0.001);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseChannelValue("  .25  ")).toBe(0.25);
  });

  it("still parses structured JSON (apex-ctrl whole form)", () => {
    expect(parseChannelValue('{"t":[0,1,0]}')).toEqual({ t: [0, 1, 0] });
    expect(parseChannelValue("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("preserves JSON literals that are falsy but valid", () => {
    expect(parseChannelValue("null")).toBeNull();
    expect(parseChannelValue("true")).toBe(true);
    expect(parseChannelValue("false")).toBe(false);
  });

  it("rejects an empty or whitespace-only input", () => {
    expect(parseChannelValue("")).toBe(INVALID_CHANNEL_VALUE);
    expect(parseChannelValue("   ")).toBe(INVALID_CHANNEL_VALUE);
  });

  it("rejects malformed numbers instead of silently truncating them", () => {
    // parseFloat("1.2.3") would give 1.2 - a wrong value written to a rig control.
    expect(parseChannelValue("1.2.3")).toBe(INVALID_CHANNEL_VALUE);
    expect(parseChannelValue(".")).toBe(INVALID_CHANNEL_VALUE);
    expect(parseChannelValue("0x10")).toBe(INVALID_CHANNEL_VALUE);
    expect(parseChannelValue("abc")).toBe(INVALID_CHANNEL_VALUE);
  });

  it("rejects non-finite words", () => {
    expect(parseChannelValue("Infinity")).toBe(INVALID_CHANNEL_VALUE);
    expect(parseChannelValue("NaN")).toBe(INVALID_CHANNEL_VALUE);
  });
});
