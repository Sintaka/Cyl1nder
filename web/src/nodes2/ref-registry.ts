/**
 * 节点引用注册表（rename-safe references）——照 Houdini 的做法建模。
 *
 * Houdini 的关键事实：改名之所以不毁引用，**不是**因为它在改名时去猜哪些字符串
 * 长得像路径，而是因为每条引用在**建立时就登记**成一条依赖（parm ↔ parm 的
 * dependency graph）。改名时它只沿着登记过的依赖走，把每个引用点重写一遍；
 * 从未登记过的文本（用户手打进 string 参数里的一段路径）它一个字都不动。
 *
 * 本模块照这个语义实现，两条设计因此是**故意**的：
 *
 * 1) **只重写登记过的引用点（registered-only）。** 没登记 = 不存在依赖 =
 *    改名时不碰。这才是诚实的：注册表只保证自己知道的事，绝不对任意字符串
 *    做启发式猜测（那会在「@P.y>0」「/obj/geo1 是段说明文字」这类内容上误伤）。
 *    没有任何登记引用时，rewriteOnRename 返回 0 并且什么都不改。
 *
 * 2) **前缀边界规则（prefix boundary）。** 路径 p 命中前缀 old 当且仅当
 *    `p === old` 或 `p.startsWith(old + "/")`。于是把 `/obj/geo1` 改名成
 *    `/obj/box1` 会命中 `/obj/geo1` 和 `/obj/geo1/transform1/tx`，但**绝不**
 *    命中 `/obj/geo10/tx` —— 纯 startsWith 会把 `/obj/geo10` 误当成 geo1 的
 *    子路径重写成 `/obj/box10`，这是 Houdini 从不会犯的错。
 *
 * 另两条照抄的性质（见 devlog/reference-registry-design.md 实机验证）：
 *   - **悬空引用自愈**：登记的是「名字字符串」而非活指针，所以引用一个还不存在的
 *     路径是合法的；之后真有节点改名成那个路径，引用即刻生效（本表不校验存在性）。
 *   - **相对与绝对在改名上等价**：都登记、都重写；差别只在结构性语义，不在本表。
 *
 * 无 DOM、无 rete、无 I/O：纯数据 + 纯函数，可直接单测。
 */

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

/**
 * 一个**引用点**（reference site）：某节点的某个字段引用了某条路径（绝对或相对——
 * 两者在改名重写上等价，本表按各自形式重写）。
 * 身份 = (nodeId, field)：同一节点的同一字段只能有一条引用（再次 register 即更新）。
 */
export interface RefSite {
  /** 持有引用的节点 id（引用的**来源**，即 Houdini 里的 dependent）。 */
  nodeId: string;
  /** 该节点上承载引用的字段名（参数名 / 绑定键，如 "tx" / "address"）。 */
  field: string;
  /** 被引用的路径（已归一化，如 "/obj/geo1/transform1/tx"）。 */
  path: string;
}

/** auditRename / rewriteOnRename 里单个受影响引用点的变化描述。 */
export interface RefChange {
  nodeId: string;
  field: string;
  /** 改名前的路径（归一化形式）。 */
  from: string;
  /** 改名后的路径（归一化形式）。 */
  to: string;
  /** true = 整条路径就是被改名的那个节点；false = 被改名节点的**子路径**。 */
  exact: boolean;
}

/**
 * 改名影响面报告（**改名前**即可查，不产生任何副作用）。
 * 这就是 Houdini「改名前能知道谁会跟着变」的那份信息。
 */
export interface RenameAudit {
  /** 归一化后的旧路径。 */
  oldPath: string;
  /** 归一化后的新路径。 */
  newPath: string;
  /** 参数是否可用（空路径 / 旧新相同 → false，此时 changes 必为空）。 */
  ok: boolean;
  /** ok=false 时的原因："" | "empty-old" | "empty-new" | "unchanged"。 */
  reason: "" | "empty-old" | "empty-new" | "unchanged";
  /** 会被重写的引用点（按 nodeId, field 稳定排序，便于断言与 diff）。 */
  changes: RefChange[];
}

/** rewriteOnRename 的结果：真正改了多少个引用点 + 完整变化清单。 */
export interface RewriteResult {
  /** 被重写的引用点数量（0 = 什么都没改）。 */
  rewritten: number;
  audit: RenameAudit;
}

// ---------------------------------------------------------------------------
// 纯函数：路径归一化 + 前缀边界
// ---------------------------------------------------------------------------

/**
 * 路径归一化：去首尾空白、折叠重复分隔符、去尾部 "/"（根 "/" 除外）。
 * 非字符串 / 归一化后为空 → ""（调用方据此判非法）。
 *
 * 归一化是前缀边界规则能成立的前提：`"/obj/geo1/"` 与 `"/obj/geo1"` 必须先变成
 * 同一个串，否则边界判定会漏。
 */
export function normalizeRefPath(v: unknown): string {
  if (typeof v !== "string") return "";
  const collapsed = v.trim().replace(/\/{2,}/g, "/");
  if (collapsed === "" || collapsed === "/") return collapsed;
  return collapsed.replace(/\/+$/, "");
}

/**
 * 前缀边界谓词（本模块的核心规则）：path 是否**是** prefix 或**位于** prefix 之下。
 *
 * 只有两种命中：完全相等，或 path 以 `prefix + "/"` 开头。于是
 * `/obj/geo10` 对前缀 `/obj/geo1` **不命中** —— 这正是纯 startsWith 会错的地方。
 * 空 prefix / 空 path → false（非法输入绝不命中，宁可不改也不错改）。
 */
export function isAtOrUnder(path: string, prefix: string): boolean {
  if (path === "" || prefix === "") return false;
  if (path === prefix) return true;
  const base = prefix === "/" ? "/" : `${prefix}/`;
  return path.startsWith(base);
}

/**
 * 按前缀边界重写单条路径：命中 → 换头为 newPrefix；不命中 → **原样返回**。
 * 纯字符串操作，不查注册表（registry 与规则解耦，两者都能单独测）。
 */
export function rewriteRefPath(path: string, oldPrefix: string, newPrefix: string): string {
  if (!isAtOrUnder(path, oldPrefix)) return path;
  if (path === oldPrefix) return newPrefix;
  const tail = path.slice(oldPrefix === "/" ? 1 : oldPrefix.length + 1);
  return newPrefix === "/" ? `/${tail}` : `${newPrefix}/${tail}`;
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

/** 引用点主键：nodeId + field。用 \u0000 作分隔符——正常 id/字段名不含它。 */
function siteKey(nodeId: string, field: string): string {
  return `${nodeId}\u0000${field}`;
}

/** RefSite 的稳定排序（nodeId 再 field），让 audit/list 输出可直接断言。 */
function bySite(a: { nodeId: string; field: string }, b: { nodeId: string; field: string }): number {
  return a.nodeId === b.nodeId ? (a.field < b.field ? -1 : a.field > b.field ? 1 : 0) : a.nodeId < b.nodeId ? -1 : 1;
}

/**
 * 引用注册表：登记「谁的哪个字段引用了哪条路径」，改名时只沿登记过的引用点重写。
 *
 * 生命周期与图一致：节点删除时调用 unregisterNode，图重建时 clear 后重登记。
 * 注册表**不持有节点对象**，只存字符串三元组——因此不会让被删节点泄漏。
 */
export class RefRegistry {
  private sites = new Map<string, RefSite>();

  /**
   * 登记（或更新）一个引用点。同一 (nodeId, field) 再次登记即**覆盖**旧路径
   * （参数改值走的就是这条，不会堆出两条陈旧依赖）。
   *
   * 返回落库后的 RefSite；nodeId / field 为空，或 path 归一化后为空 → null
   * （非法输入不入表，绝不抛）。
   */
  register(nodeId: string, field: string, path: string): RefSite | null {
    if (typeof nodeId !== "string" || nodeId === "") return null;
    if (typeof field !== "string" || field === "") return null;
    const norm = normalizeRefPath(path);
    if (norm === "") return null;
    const site: RefSite = { nodeId, field, path: norm };
    this.sites.set(siteKey(nodeId, field), site);
    return { ...site };
  }

  /** 注销一个引用点；返回是否真的删掉了（不存在 → false）。 */
  unregister(nodeId: string, field: string): boolean {
    return this.sites.delete(siteKey(nodeId, field));
  }

  /** 注销某节点的**全部**引用点（节点删除时调用）；返回删掉的条数。 */
  unregisterNode(nodeId: string): number {
    let n = 0;
    for (const [key, site] of this.sites) {
      if (site.nodeId === nodeId) {
        this.sites.delete(key);
        n += 1;
      }
    }
    return n;
  }

  /** 读一个引用点（拷贝，外部改不到内部状态）；不存在 → null。 */
  get(nodeId: string, field: string): RefSite | null {
    const hit = this.sites.get(siteKey(nodeId, field));
    return hit ? { ...hit } : null;
  }

  /** 全部引用点（拷贝 + 稳定排序）。 */
  list(): RefSite[] {
    return [...this.sites.values()].map((s) => ({ ...s })).sort(bySite);
  }

  /** 已登记的引用点数量。 */
  size(): number {
    return this.sites.size;
  }

  /** 清空（图重建 / 测试隔离）。 */
  clear(): void {
    this.sites.clear();
  }

  /**
   * 「谁引用了它」——某条路径（含其子路径）按前缀边界命中的全部引用点。
   * 对应 Houdini 的 `hou.OpNode.parmsReferencingThis()`：登记表的**读出口**。
   * 改名前的影响面由它算出（auditRename 就建在它上面）。
   */
  audit(path: string): RefSite[] {
    const prefix = normalizeRefPath(path);
    if (prefix === "") return [];
    return this.list().filter((s) => isAtOrUnder(s.path, prefix));
  }

  /**
   * **改名前审计**（只读，零副作用）：如果把 oldPath 改成 newPath，哪些登记过的
   * 引用点会被重写、各自变成什么。UI 可以先把这份清单摆给用户看，再决定是否执行。
   *
   * ok=false（空路径 / 旧新相同）时 changes 必为空——不合法的改名不产生影响面。
   */
  auditRename(oldPath: string, newPath: string): RenameAudit {
    const from = normalizeRefPath(oldPath);
    const to = normalizeRefPath(newPath);
    const reason: RenameAudit["reason"] = from === "" ? "empty-old" : to === "" ? "empty-new" : from === to ? "unchanged" : "";
    if (reason !== "") return { oldPath: from, newPath: to, ok: false, reason, changes: [] };
    const changes: RefChange[] = this.audit(from).map((s) => ({
      nodeId: s.nodeId,
      field: s.field,
      from: s.path,
      to: rewriteRefPath(s.path, from, to),
      exact: s.path === from,
    }));
    return { oldPath: from, newPath: to, ok: true, reason: "", changes };
  }

  /**
   * 执行改名重写：把命中前缀边界的登记引用点**就地**换头。
   *
   * 只改登记过的引用点——没登记的字段一个字都不动（registered-only）。因此
   * 空注册表 / 全都不命中时返回 `rewritten: 0` 且状态不变；同一次改名重复执行
   * 第二次也是 0（第一次之后已无路径命中旧前缀，天然幂等）。
   */
  rewriteOnRename(oldPath: string, newPath: string): RewriteResult {
    const audit = this.auditRename(oldPath, newPath);
    if (!audit.ok) return { rewritten: 0, audit };
    for (const c of audit.changes) {
      const key = siteKey(c.nodeId, c.field);
      const site = this.sites.get(key);
      if (site) this.sites.set(key, { ...site, path: c.to });
    }
    return { rewritten: audit.changes.length, audit };
  }
}

/** 便利构造（与 makeXxxNode 工厂风格一致）。 */
export function makeRefRegistry(): RefRegistry {
  return new RefRegistry();
}
