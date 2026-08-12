/**
 * Houdini-style group expression parser + point matcher.
 * Used by the transform node (v1) and future group-aware nodes.
 *
 * Syntax (Houdini group field): empty = all, "*" = all, "^"/"!" prefix = exclude,
 * "1-5" / "3" / "1-10:2" = id ranges, "@name" = group/attribute, "i@name" etc =
 * typed attribute access (i=int, s=string, v=vector, p=quaternion/vector4,
 * 3@=matrix3, 4@=matrix4, @ default = float), "@P.x" / "@Cd[2]" = vector component,
 * "@attr op value" (op: = == != > < >= <=) = attribute comparison, quoted strings
 * for string values. Duplicate attribute names (e.g. 4@transform + 3@transform)
 * resolve to the FIRST match. No npm lib exists for this (network-restricted,
 * zero new deps) so the parser is hand-rolled and compact.
 *
 * Syntax source: Houdini group field
 * (https://www.sidefx.com/docs/houdini/model/groups.html) + VEX attribute type
 * prefixes (i/s/v/p/3/4).
 *
 * Deliberate v1 simplifications vs stock Houdini:
 * - "!" behaves like "^" (removal from the accumulated selection, which starts
 *   EMPTY), NOT like "all except" (stock Houdini "!1-10" = everything except 1-10).
 * - attribute multi-values must be quoted ("5 8 10"); comma-separated values
 *   (e.g. @id=1,2,3) are not supported (commas separate tokens).
 * - no named-group/glob ("arm*") or "&" intersection support.
 *
 * Stage 1.2 split: parsing side moved to groups/parser.ts, matching side
 * moved to groups/matcher.ts; this file is now a barrel re-exporting both.
 */


export * from "./groups/parser";
export * from "./groups/matcher";
