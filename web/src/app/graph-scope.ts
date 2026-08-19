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

/**
 * ## 为什么层级路径也挂在这里（v0.1.00119，obj/sop 两层网络）
 *
 * 「当前在 geo1 里面」同样是「这张图是谁的」的一部分，因此**不能**另开一个模块级
 * `netPath` 变量：那正是上面那场事故的形状——两个变量各自描述同一件事，某条分支只更新
 * 了其中一个，于是地址栏与保存目标对不上。路径进 scope，所有分支只有一处可改。
 *
 * `path` 是**当前网络内的节点标签栈**（`["geo1","geo2"]`），不是 serial 路径；它的事实
 * 来源是 nodes2/graph 的 `getNetPath()`（层级栈本身），scope 只是把它与归属绑在一起。
 * 缺省/空数组 === 顶层，地址与改造前**逐字相同**（addressOf 对无 path 的 scope 输出不变）。
 */

/** 图的归属。`member` 同时携带 projectId 与 serial —— 地址栏需要前者，保存需要后者。
 *  `path` 为当前网络内的层级标签栈（可选；缺省/空 = 顶层，行为与改造前一致）。 */
export type GraphScope =
  | { kind: "project"; projectId: string; path?: string[] }
  | { kind: "member"; projectId: string; serial: string; path?: string[] }
  | { kind: "serial"; serial: string; path?: string[] }
  | { kind: "none" };

/** 层级路径后缀：`[]`/缺省 → ""（地址与改造前字节一致）；否则 `geo1/geo2/`。
 *  空串标签被剔除——`getNetPath()` 理论上不产出空标签，但地址栏是**用户可打字**的入口，
 *  一个空段会拼出 `//`，那是个看不出错在哪的地址。 */
function pathSuffix(path: readonly string[] | undefined): string {
  if (!path || path.length === 0) return "";
  const clean = path.filter((s) => typeof s === "string" && s !== "");
  return clean.length === 0 ? "" : `${clean.join("/")}/`;
}

/** 地址栏路径：project → `/P1-…/`（层级 → `/P1-…/geo1/geo2/`）；
 *  member → `/P1-…/C1-…/`；serial → `/C1-…/`。无 path 时输出与改造前完全一致。 */
export function addressOf(scope: GraphScope): string {
  switch (scope.kind) {
    case "project":
      return `/${scope.projectId}/${pathSuffix(scope.path)}`;
    case "member":
      return `/${scope.projectId}/${scope.serial}/${pathSuffix(scope.path)}`;
    case "serial":
      return `/${scope.serial}/${pathSuffix(scope.path)}`;
    default:
      return "/";
  }
}

/**
 * 这张图能不能写进项目槽位？**只有 `project`** —— 成员图写进去就是覆盖项目根。
 *
 * **层级路径刻意不参与判定**（v0.1.00119）：在 `geo1` 子网络里，归属仍然是这个项目。
 * 子图是内联在项目自己 graph.json 里的（geo 节点的 `children` 字段），保存它**就是**在写
 * 项目图，所以 `{kind:"project", path:["geo1"]}` 必须仍然返回 true。若在这里按 path 收紧
 * 成 false，进 geo 之后 Save 就会静默改道去写 per-serial snapshot（项目模式没有 serial，
 * 那条路径直接 400），用户的子网络编辑会**无声丢失**——正是本文件要防的那类事故换了个方向。
 *
 * 注意这只回答「归属允许写吗」。「此刻手上的字节是不是完整的项目根图」是另一个问题，
 * 由调用方（main.ts saveProjectGraph）负责：`projectGraphSnapshot()` 序列化的是**当前
 * 编辑器**，在子网络里那是子图，直接写进项目槽位会重演覆盖事故。
 */
export function canWriteProjectGraph(scope: GraphScope): boolean {
  return scope.kind === "project";
}

/** 当前层级路径（缺省/非数组 → `[]`）。调用方用它判「是否在子网络里」而不必各自处理缺省。 */
export function pathOf(scope: GraphScope): string[] {
  if (scope.kind === "none") return [];
  return Array.isArray(scope.path) ? scope.path.filter((s) => typeof s === "string" && s !== "") : [];
}

/** 是否位于某个子网络内部（层级深度 > 0）。 */
export function isInSubNetwork(scope: GraphScope): boolean {
  return pathOf(scope).length > 0;
}

/** 换层级路径，**归属键逐字保留**（不可能顺手把 project 写成 member —— 那正是事故形状）。
 *  `none` 无归属可言，原样返回。 */
export function withPath(scope: GraphScope, path: readonly string[]): GraphScope {
  if (scope.kind === "none") return scope;
  const clean = path.filter((s) => typeof s === "string" && s !== "");
  if (clean.length === 0) {
    // 回到顶层：删掉 path 键而不是留空数组 —— 无层级的 scope 与改造前**结构相同**。
    if (scope.kind === "project") return { kind: "project", projectId: scope.projectId };
    if (scope.kind === "member") return { kind: "member", projectId: scope.projectId, serial: scope.serial };
    return { kind: "serial", serial: scope.serial };
  }
  return { ...scope, path: [...clean] };
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
