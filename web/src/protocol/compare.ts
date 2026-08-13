import equal from "fast-deep-equal";
import type { InputPayload } from "./types";

function payloadEqual(a: InputPayload, b: InputPayload): boolean {
  return (
    a.index === b.index &&
    a.pointCount === b.pointCount &&
    a.primCount === b.primCount &&
    equal(a.points, b.points) &&
    equal(a.curves, b.curves) &&
    equal(a.faces ?? [], b.faces ?? [])
  );
}

/** True if two input lists carry identical geometry content (order-insensitive by index). */
export function inputsEqual(a: InputPayload[], b: InputPayload[]): boolean {
  if (a.length !== b.length) return false;
  const mapA = new Map(a.map((x) => [x.index, x]));
  for (const ib of b) {
    const ia = mapA.get(ib.index);
    if (!ia || !payloadEqual(ia, ib)) return false;
  }
  return true;
}