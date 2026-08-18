/** nodeview 地址栏路径拼装（纯函数，供 main.ts 与单测共用）。
 *
 *  为什么单独成文件：这段逻辑出过一个真 bug（v0.1.00116 修），而它原先是 main.ts 里的
 *  闭包，测试根本碰不到——没有测试盯着，同类回归会再犯。
 */

/** 拼当前 nodeview 地址。
 *
 *  项目模式（`projectId` 非空）：`/<P1-…>/` 或 `/<P1-…>/<C1-…>/`；
 *  纯 serial 模式：`/<C1-…>/`；都没有：`/`。
 *
 *  **进入成员后必须仍带项目前缀。** 旧实现额外要求「图里有 project 根节点」才算项目
 *  模式，但进入成员工作区后图已换成该成员自己的图、project 根不在了，于是地址退化成
 *  `/C1-…/`，把「从哪个项目进来的」丢掉（用户实测：进入 `C1-msm6dsp7-ob6t` 后地址是
 *  `/C1-msm6dsp7-ob6t/`，而不是 `/P1-…/C1-msm6dsp7-ob6t`）。
 *  归属项目的事实来源是 `projectId`，它在成员工作区里依然有效，所以只看它。
 */
export function buildGraphAddress(projectId: string | null, serial: string): string {
  if (projectId) return serial ? `/${projectId}/${serial}/` : `/${projectId}/`;
  return serial ? `/${serial}/` : "/";
}
