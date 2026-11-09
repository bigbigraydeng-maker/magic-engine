/**
 * 纯函数：这条线索该走哪条路线。
 *
 * 🔴 **按「表单实际问了哪些问题」判，不按 form id 判**（PM 2026-09-24 明确要求）。
 *    客户以后出 v5 / v6，只要还问同样那几个问题就自动归到同一张表，代码和配置
 *    都不用动。写死 form id 的话，每出一版新表单就要有人记得改一次 —— 而「忘了改」
 *    的表现是线索安静地掉进兜底表，没人会发现。
 */

import type { LeadRecord, LeadSheetRoute } from './types'

/** 路线按 priority 升序、同级按 routeKey，保证结果稳定可预测。 */
export function orderRoutes(routes: readonly LeadSheetRoute[]): LeadSheetRoute[] {
  return [...routes].sort(
    (a, b) => a.priority - b.priority || a.routeKey.localeCompare(b.routeKey),
  )
}

/** 空数组 = 兜底路线（谁都没命中时用它）。 */
export function isFallbackRoute(route: LeadSheetRoute): boolean {
  return route.matchAnyAnswerFields.length === 0
}

/**
 * 选路线：按优先级找第一条「问答里出现了它要求的任一字段」的路线；
 * 都没命中就用优先级最低的那条兜底路线；连兜底都没有就返回 null。
 *
 * 判据是**字段出现过**，不是「答案非空」—— 客人把选填的预算留空了，这条线索
 * 仍然来自那张问了预算的表单，还是该进那张表。
 */
export function pickRoute(
  lead: LeadRecord,
  routes: readonly LeadSheetRoute[],
): LeadSheetRoute | null {
  const ordered = orderRoutes(routes.filter((r) => r.enabled))
  const answerFields = new Set(Object.keys(lead.answers))

  for (const route of ordered) {
    if (isFallbackRoute(route)) continue
    if (route.matchAnyAnswerFields.some((f) => answerFields.has(f))) return route
  }

  return ordered.find(isFallbackRoute) ?? null
}

/** 落在 backfill 窗口之前 = 这次不碰。null 表示没设窗口，全都要。 */
export function isWithinBackfillWindow(lead: LeadRecord, route: LeadSheetRoute): boolean {
  if (!route.backfillSince) return true
  const since = Date.parse(route.backfillSince)
  const at = Date.parse(lead.occurredAt)
  if (!Number.isFinite(since) || !Number.isFinite(at)) return false
  return at >= since
}
