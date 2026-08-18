/** 当前 nodeview 里那张图**是谁的** —— 保存/读取/地址栏的唯一事实来源。
 *
 * ## 为什么需要这个（v0.1.00117，修真实数据丢失）
 *
 * 此前用「`currentProjectId` 非空 = 项目模式」来推断，但这条推断不成立：从 channel
 * chip 进入成员工作区后 `currentProjectId` 仍然非空，而图已经被换成了那个成员自己的图。
 * 于是 Save 走项目分支、把**成员图**写进了 `projects/<pid>/graph.json`，
 * 项目根结构（project + channel 节点）被覆盖；`projectGraphSnapshot()` 又因为图里
 * 已无 project 节点而"优雅降级"成 schemaVersion 2，连报错都没有。
 *
 * 实测后果：`P1-msyiasx0-a2gf/graph.json` 变成 2 节点 v2 默认图；
 * 对照未受影响的 `P1-msu9mqna-8e8s/graph.json` 仍是 v3 + project/channel。
 * 用户看到的现象是「save 后 load 又变成默认场景」——load 是无辜的，它忠实读回了
 * 最后被写进去的东西。
 *
 * 所以这里把「图的归属」显式建模：`member` 记住来源项目（地址栏要用），但**不等于**
 * 「图是项目根」（保存要用）。两个语义分开，覆盖就不可能发生。
 */

/** 图的归属。`member` 同时携带 projectId 与 serial —— 地址栏需要前者，保存需要后者。 */
export type GraphScope =
  | { kind: "project"; projectId: string }
  | { kind: "member"; projectId: string; serial: string }
  | { kind: "serial"; serial: string }
  | { kind: "none" };

/** 地址栏路径：project → `/P1-…/`；member → `/P1-…/C1-…/`；serial → `/C1-…/`。 */
export function addressOf(scope: GraphScope): string {
  switch (scope.kind) {
    case "project":
      return `/${scope.projectId}/`;
    case "member":
      return `/${scope.projectId}/${scope.serial}/`;
    case "serial":
      return `/${scope.serial}/`;
    default:
      return "/";
  }
}

/** 这张图能不能写进项目槽位？**只有 `project`** —— 成员图写进去就是覆盖项目根。 */
export function canWriteProjectGraph(scope: GraphScope): boolean {
  return scope.kind === "project";
}

/** 这张图该写哪个 serial 的 snapshot？项目根没有单一 serial → null。 */
export function snapshotSerialOf(scope: GraphScope): string | null {
  if (scope.kind === "member" || scope.kind === "serial") return scope.serial;
  return null;
}

/** 归属项目（member 也算，用于地址栏与"从哪进来的"）；无则 null。 */
export function projectIdOf(scope: GraphScope): string | null {
  if (scope.kind === "project" || scope.kind === "member") return scope.projectId;
  return null;
}
