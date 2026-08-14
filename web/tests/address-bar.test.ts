import { describe, expect, it } from "vitest";
import { completeSegment, splitAddress } from "../src/app/address-bar";

describe("splitAddress", () => {
  it("returns [] for an empty address", () => {
    expect(splitAddress("")).toEqual([]);
  });

  it("returns [] for a lone slash", () => {
    expect(splitAddress("/")).toEqual([]);
  });

  it("splits a single segment", () => {
    expect(splitAddress("/C1-abc")).toEqual(["C1-abc"]);
  });

  it("splits multiple segments", () => {
    expect(splitAddress("/C1-abc/geo")).toEqual(["C1-abc", "geo"]);
  });

  it("drops leading and trailing slashes", () => {
    expect(splitAddress("/C1-abc/")).toEqual(["C1-abc"]);
    expect(splitAddress("C1-abc/geo/")).toEqual(["C1-abc", "geo"]);
  });

  it("drops empty segments from consecutive slashes", () => {
    expect(splitAddress("//C1-abc///geo//")).toEqual(["C1-abc", "geo"]);
  });
});

describe("completeSegment", () => {
  it("replaces the trailing segment with a unique candidate (cursorAtEnd)", () => {
    expect(completeSegment("/C1-abc/geo", true, "geo", ["geo1"])).toBe("/C1-abc/geo1");
  });

  it("replaces a middle segment located by exact prefix (cursor not at end)", () => {
    expect(completeSegment("/C1-abc/geo/tube1", false, "geo", ["geo2"])).toBe("/C1-abc/geo2/tube1");
  });

  it("locates a middle segment by prefix-of-value", () => {
    expect(completeSegment("/C1-abc/geometry/tube1", false, "ge", ["geo1"])).toBe("/C1-abc/geo1/tube1");
  });

  it("returns null for empty candidates", () => {
    expect(completeSegment("/C1-abc/geo", true, "geo", [])).toBeNull();
  });

  it("ignores a candidate identical to the current segment -> null", () => {
    expect(completeSegment("/C1-abc/geo", true, "geo", ["geo"])).toBeNull();
  });

  it("skips an identical candidate and uses the next one", () => {
    expect(completeSegment("/C1-abc/geo", true, "geo", ["geo", "geo1"])).toBe("/C1-abc/geo1");
  });

  it("appends a first segment onto an empty address (cursorAtEnd)", () => {
    expect(completeSegment("", true, "", ["C1-abc"])).toBe("/C1-abc");
  });

  it("appends a new segment after a trailing slash (cursorAtEnd)", () => {
    expect(completeSegment("/C1-abc/", true, "", ["geo1"])).toBe("/C1-abc/geo1");
  });

  it("returns null when a middle prefix is not locatable", () => {
    expect(completeSegment("/C1-abc/geo", false, "zzz", ["x"])).toBeNull();
  });

  it("returns null for an empty prefix when cursor is not at end", () => {
    expect(completeSegment("/C1-abc/geo", false, "", ["x"])).toBeNull();
  });
});
