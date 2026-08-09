import type { InputPayload } from "./types";

function payloadEqual(a: InputPayload, b: InputPayload): boolean {
  return (
    a.index === b.index &&
    a.pointCount === b.pointCount &&
    a.primCount === b.primCount &&
    JSON.stringify(a.points) === JSON.stringify(b.points) &&
    JSON.stringify(a.curves) === JSON.stringify(b.curves)
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