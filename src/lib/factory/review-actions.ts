// P21.J ME 原生化 P1 — 审核动作纯校验器(spec me-native-design v0.2 §4/§6)
// route handler 调这些做入参校验 + 花钱闸判断,纯函数零 DB,可单测。
// 三动作:approve(通过并投放)/ reject_quality(打回·画面,一键理由)/ reject_budget(打回·预算)。

import { FACTORY_PUBLISH_BUDGET_HARD_CAP_USD } from './constants'

export type ReviewAction = 'approve' | 'reject_quality' | 'reject_budget'

export type ParsedReview =
  | { ok: true; action: 'approve' }
  | { ok: true; action: 'reject_quality'; feedback: string }
  | { ok: true; action: 'reject_budget'; newBudget: number }
  | { ok: false; error: string }

const ACTIONS: ReviewAction[] = ['approve', 'reject_quality', 'reject_budget']

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 解析 + 校验审核请求体。
 * - reject_quality 必带 feedback(一键理由映射成字符串,不强制作文但不能空)
 * - reject_budget 的 new_budget_usd 必须 (0, $50] —— 服务端硬顶,不信前端(魏征红线③)
 */
export function parseReviewBody(body: Record<string, unknown>): ParsedReview {
  const action = body.action as ReviewAction
  if (!ACTIONS.includes(action)) {
    return { ok: false, error: `action must be one of ${ACTIONS.join('|')}` }
  }
  if (action === 'reject_quality') {
    const feedback = asString(body.feedback)
    if (!feedback) return { ok: false, error: 'reject_quality requires feedback' }
    return { ok: true, action, feedback: feedback.slice(0, 2000) }
  }
  if (action === 'reject_budget') {
    const n = body.new_budget_usd
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      return { ok: false, error: 'new_budget_usd must be a positive number' }
    }
    if (n > FACTORY_PUBLISH_BUDGET_HARD_CAP_USD) {
      return { ok: false, error: `new_budget_usd exceeds hard cap $${FACTORY_PUBLISH_BUDGET_HARD_CAP_USD}` }
    }
    return { ok: true, action, newBudget: n }
  }
  return { ok: true, action: 'approve' }
}

/**
 * 通过闸(魏征红线③:approve 服务端重判 $50 硬顶,绝不因 UI confirm 过就省)。
 * 生效投放预算 = review_ref.publish_budget_usd(打回·预算改过则用它)否则未设=系统默认(在顶内)。
 * 只要显式设过且超顶 → 拦。
 */
export function approveBudgetWithinCap(reviewRef: Record<string, unknown> | null | undefined): {
  ok: boolean
  budget: number | null
  error?: string
} {
  const raw = (reviewRef ?? {})['publish_budget_usd']
  if (raw === undefined || raw === null) return { ok: true, budget: null }
  const budget = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(budget) || budget <= 0) {
    return { ok: false, budget: null, error: 'stored publish_budget_usd invalid' }
  }
  if (budget > FACTORY_PUBLISH_BUDGET_HARD_CAP_USD) {
    return { ok: false, budget, error: `publish_budget_usd $${budget} exceeds hard cap $${FACTORY_PUBLISH_BUDGET_HARD_CAP_USD}` }
  }
  return { ok: true, budget }
}
