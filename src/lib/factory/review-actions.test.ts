// P21.J ME 原生化 P1 — 审核动作纯校验器单测

import { describe, expect, it } from 'vitest'
import { approveBudgetWithinCap, parseReviewBody } from './review-actions'
import { REEL_HUMAN_CHECK_KEYS_V3 } from '@/lib/social/content-review'

const passChecklist = REEL_HUMAN_CHECK_KEYS_V3.map(key => ({
  key,
  judge: 'HUMAN',
  outcome: 'PASS',
  detail: null,
  source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
}))

describe('parseReviewBody', () => {
  it('approve 合法', () => {
    expect(parseReviewBody({ action: 'approve', checklist_human: passChecklist })).toEqual({
      ok: true, action: 'approve', checklistHuman: passChecklist,
    })
  })
  it('未知 action → 拒', () => {
    const r = parseReviewBody({ action: 'delete' })
    expect(r.ok).toBe(false)
  })
  it('reject_quality 必带 feedback', () => {
    expect(parseReviewBody({ action: 'reject_quality' }).ok).toBe(false)
    expect(parseReviewBody({ action: 'reject_quality', feedback: '  ' }).ok).toBe(false)
    const r = parseReviewBody({ action: 'reject_quality', feedback: '画面质量', checklist_human: passChecklist })
    expect(r).toEqual({ ok: true, action: 'reject_quality', feedback: '画面质量', checklistHuman: passChecklist })
  })
  it('reject_quality feedback 截断 2000', () => {
    const r = parseReviewBody({ action: 'reject_quality', feedback: 'x'.repeat(3000), checklist_human: passChecklist })
    expect(r.ok && r.action === 'reject_quality' && r.feedback.length).toBe(2000)
  })
  it('reject_budget 正数且 ≤ $50', () => {
    expect(parseReviewBody({ action: 'reject_budget', new_budget_usd: 30 })).toEqual({
      ok: true, action: 'reject_budget', newBudget: 30,
    })
  })
  it('reject_budget 非正 / 非数 / 超顶 → 拒', () => {
    expect(parseReviewBody({ action: 'reject_budget', new_budget_usd: 0 }).ok).toBe(false)
    expect(parseReviewBody({ action: 'reject_budget', new_budget_usd: -5 }).ok).toBe(false)
    expect(parseReviewBody({ action: 'reject_budget', new_budget_usd: '30' }).ok).toBe(false)
    expect(parseReviewBody({ action: 'reject_budget', new_budget_usd: 51 }).ok).toBe(false)
  })
  it('reject_budget 边界 $50 通过', () => {
    expect(parseReviewBody({ action: 'reject_budget', new_budget_usd: 50 }).ok).toBe(true)
  })
})

describe('approveBudgetWithinCap(魏征红线③ 服务端花钱闸)', () => {
  it('未设 publish_budget → 通过(系统默认在顶内)', () => {
    expect(approveBudgetWithinCap({})).toEqual({ ok: true, budget: null })
    expect(approveBudgetWithinCap(null)).toEqual({ ok: true, budget: null })
  })
  it('设过且 ≤ $50 → 通过', () => {
    expect(approveBudgetWithinCap({ publish_budget_usd: 40 })).toEqual({ ok: true, budget: 40 })
  })
  it('设过且 > $50 → 拦(防前端绕过硬顶)', () => {
    const r = approveBudgetWithinCap({ publish_budget_usd: 99 })
    expect(r.ok).toBe(false)
  })
  it('设成非法值 → 拦', () => {
    expect(approveBudgetWithinCap({ publish_budget_usd: -1 }).ok).toBe(false)
  })
})
