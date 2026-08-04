/**
 * 楼盘级素材隔离（2026-08-03）。
 *
 * PM 2026-08-03 拍板：客户 = 中介（Roman），楼盘是中介名下的项目。
 * 于是出现一个此前不存在的红线：**同一个中介名下，两个楼盘的素材绝不能串**——
 * Kiteroa 与 Parkhomes 背后是两个竞品开发商，把 A 楼盘的房子拍进 B 楼盘的广告，
 * 比跨客户串用更难解释。
 *
 * 🔴 只按 client_id 过滤在这里**不够**：Roman 名下的所有楼盘 client_id 都一样。
 *    这是新引入的风险，不是旧红线的延伸 —— 所以要有专门的一层。
 *
 * 规则（`project_id` 可空是关键）：
 *   · 出片对象是某个楼盘 → 只能用「该楼盘的」+「不属于任何楼盘的」素材
 *     （中介自己的品牌素材、通用空镜，本来就是给所有楼盘共用的）
 *   · 出片对象不是楼盘（CTS / Oztop 这类没有项目的客户）→ 只能用不属于任何楼盘的素材
 *     （否则会把地产楼盘的房子拍进旅行社的片子）
 */

export interface ProjectScopedRow {
  project_id?: string | null
}

/**
 * 这条素材能不能给这个楼盘用。
 *
 * @param targetProjectId 出片对象楼盘；null = 不是给某个楼盘做的
 */
export function isAllowedForProject(
  row: ProjectScopedRow,
  targetProjectId: string | null,
): boolean {
  const owner = row.project_id ?? null
  // 不属于任何楼盘 = 客户级共用素材，任何场景都能用
  if (owner === null) return true
  // 属于某楼盘的素材，只有做那个楼盘时才能用
  return owner === targetProjectId
}

/** 批量过滤。宁可少给几条，也不能把 A 楼盘的房子放进 B 楼盘的广告。 */
export function filterByProject<T extends ProjectScopedRow>(
  rows: readonly T[],
  targetProjectId: string | null,
): T[] {
  return rows.filter((r) => isAllowedForProject(r, targetProjectId))
}

/**
 * 给 Supabase 查询用的过滤表达式。
 *
 * 做楼盘时：`project_id.is.null,project_id.eq.<id>`
 * 不做楼盘时：只要 `project_id is null` —— 用 `.is()` 表达，不走 or。
 */
export function projectOrFilter(targetProjectId: string | null): string | null {
  if (!targetProjectId) return null
  return `project_id.is.null,project_id.eq.${targetProjectId}`
}
