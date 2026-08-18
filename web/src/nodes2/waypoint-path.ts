/** 带路径中点（waypoint）的连线路径生成 —— 纯函数，无 DOM、无 rete 依赖。
 *
 *  rete 自带的 `classicConnectionPath(points, curvature)` 签名写死**两个点**
 *  （`[Position, Position]`），塞不进第三个点。所以有 waypoint 时自己拼两段：
 *  `start → waypoint` 与 `waypoint → end`，各自沿用 classic 的水平贝塞尔手感，
 *  在 waypoint 处自然汇合。
 *
 *  为什么不用折线（L 指令）：既有连线是水平出入的贝塞尔，突然插一段直角折线会
 *  在视觉上割裂——装饰件不该改变连线的语言。
 */

export interface Pt {
  x: number;
  y: number;
}

/** classic 风格的单段路径：两端各拉一个水平控制点，曲率随水平距离走。
 *
 *  与 rete `classicConnectionPath` 同样的手感：控制点只在 x 方向偏移，
 *  所以线从输出口向右出、向左入目标口。 */
function segment(a: Pt, b: Pt, curvature: number): string {
  const dx = Math.abs(b.x - a.x) * curvature;
  const c1 = { x: a.x + dx, y: a.y };
  const c2 = { x: b.x - dx, y: b.y };
  return `C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
}

/** 生成整条路径。`waypoint` 为 null 时退化成单段（与无装饰件时一致）。 */
export function waypointConnectionPath(
  start: Pt,
  end: Pt,
  waypoint: Pt | null,
  curvature = 0.3,
): string {
  if (!waypoint) return `M ${start.x} ${start.y} ${segment(start, end, curvature)}`;
  // 两段共用一个 waypoint 端点，所以路径连续、不会出现断口
  return (
    `M ${start.x} ${start.y} ${segment(start, waypoint, curvature)} ` +
    segment(waypoint, end, curvature)
  );
}
