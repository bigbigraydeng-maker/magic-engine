/**
 * Marketing Plan 批准守卫 —— 纯函数，无 I/O。
 *
 * 为什么有这层（设计稿 docs/specs/2026-10-14-promo-plan-board-design-v0.1.md §5.2）：
 * 「未批准什么都不做」以前只是口号——保存接口批准后仍能整体改内容、手工加任务接口
 * 草稿计划也能派活、批准重试会重复派发。这里只放判断，不放任何数据库读写，
 * 调用方（批准 / 保存 / 加任务三个入口）各自读出状态后问这里。
 *
 * 保证强度：应用层。防不住有数据库权限的人直接改库，也不能写成「代码保证未批准不执行」。
 */

import type { MarketingPlanStatus, PlanTask } from './types'

/** 这两种状态下计划内容（plan_data / 起止日期）不允许再被保存接口改写。 */
const CONTENT_LOCKED: readonly MarketingPlanStatus[] = ['approved', 'completed']

export const PLAN_CONTENT_LOCKED_MESSAGE =
  '已批准的计划不能直接改内容。要改请先把计划退回草稿（会清掉还没开始的待办），改完再批准。'

export const PLAN_NOT_APPROVED_MESSAGE =
  '这份计划还没批准，不能往执行看板加任务。请先批准计划。'

export function isPlanContentLocked(status: MarketingPlanStatus): boolean {
  return CONTENT_LOCKED.includes(status)
}

/** 往执行看板写「来源为营销计划」的任务卡，只有已批准的计划可以。 */
export function canWriteTasksToPlan(status: MarketingPlanStatus): boolean {
  return status === 'approved'
}

/** 任何「非草稿 → 草稿」都算退回：先检查在途工作、清掉没开始的待办（包括已归档的计划再改回草稿）。 */
export function isRevertToDraft(
  current: MarketingPlanStatus,
  next: MarketingPlanStatus | undefined,
): boolean {
  return next === 'draft' && current !== 'draft'
}

/**
 * 保存请求里哪些字段碰了「被锁住的内容」。
 * 标题不算内容（改名无害）；状态另有规则。
 */
export function lockedFieldsTouched(body: {
  plan_data?: unknown
  start_date?: unknown
  end_date?: unknown
}): string[] {
  const touched: string[] = []
  if (body.plan_data !== undefined) touched.push('plan_data')
  if (body.start_date !== undefined) touched.push('start_date')
  if (body.end_date !== undefined) touched.push('end_date')
  return touched
}

// ─── 推广结构只能走推广计划页保存 ────────────────────────────────────────────────

export const PROMO_CHANGED_VIA_PATCH_MESSAGE =
  '这次保存会改动（或丢掉）计划里的推广结构。推广结构只能在「推广计划」页保存，那里会核对目标、账户和预算；如果你没打算改它，请刷新页面后再保存。'

/** 键排序后的 JSON：键顺序不同但内容一样的两份结构算同一份。 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function promoOf(planData: unknown): unknown {
  if (!planData || typeof planData !== 'object') return null
  return (planData as { promo?: unknown }).promo ?? null
}

/**
 * 通用保存接口（PATCH）带来的 plan_data 里，推广结构（promo）是否和库里不一样（含被丢掉、被新增）。
 * 不一样就拒绝：推广结构的校验（目标 / 账户归属、预算上限）只在专用保存接口里做，
 * 通用保存不能绕过它，也不能靠「删掉 promo」躲开批准前的检查清单。
 */
export function promoFieldChanged(currentPlanData: unknown, nextPlanData: unknown): boolean {
  return stableStringify(promoOf(currentPlanData)) !== stableStringify(promoOf(nextPlanData))
}

// ─── 派发去重 ──────────────────────────────────────────────────────────────────

/**
 * 同一份计划里「标题 + 截止日 + 类型 + 平台（+ 推广步骤编号）」相同视为同一张卡
 * （旧任务没有稳定编号，只能这样认；同天同标题发 Facebook / Instagram 是两张卡）。
 */
export function planTaskKey(
  title: string,
  dueDate: string | null | undefined,
  kind?: string | null,
  platform?: string | null,
  promoStepId?: string | null,
): string {
  return `${title.trim()}|${dueDate ?? ''}|${kind ?? ''}|${platform ?? ''}|${promoStepId ?? ''}`
}

/**
 * 去掉计划里已经派发过的任务。批准重试 / 并发点两次时，已存在的卡不再重复插入。
 * 返回仍需派发的任务，以及它们在原数组中的下标（sort_order 要用）。
 */
export function filterUndispatched(
  tasks: readonly PlanTask[],
  existingKeys: ReadonlySet<string>,
): { task: PlanTask; index: number }[] {
  const seen = new Set(existingKeys)
  const out: { task: PlanTask; index: number }[] = []
  tasks.forEach((task, index) => {
    const key = planTaskKey(task.title, task.due_date, task.kind, task.platform, task.promo_ref?.step_id)
    if (seen.has(key)) return
    seen.add(key) // 同一批里重复的标题+日期也只派一次
    out.push({ task, index })
  })
  return out
}
