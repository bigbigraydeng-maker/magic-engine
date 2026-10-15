import { expect, it } from 'vitest'
import { REEL_HUMAN_CHECK_KEYS_V2 } from '@/lib/social/content-review'
import { validateContentChecklist } from '@/lib/social/content-review'
import { parseReviewBody } from '@/lib/factory/review-actions'
import { REJECT_REASON_KEYS, buildBudgetRejectPayload, buildQualityRejectPayload } from './rejectPayload'

it('every one-click reason is a real human checklist key', () => {
  for (const k of REJECT_REASON_KEYS) expect(REEL_HUMAN_CHECK_KEYS_V2).toContain(k)
})

it('quality payload passes the server parser and carries a FAIL item', () => {
  const r = buildQualityRejectPayload(['subtitle_short_and_large', 'logo_watermark_present'], ' 第3秒字幕慢了 ')
  expect(r.ok).toBe(true)
  if (!r.ok) return
  const parsed = parseReviewBody(r.payload)
  expect(parsed.ok && parsed.action === 'reject_quality' && parsed.feedback).toContain('补充：第3秒字幕慢了')
  const v = validateContentChecklist(r.payload.checklist_human, REEL_HUMAN_CHECK_KEYS_V2, 'HUMAN')
  expect(v.ok && v.items.filter(i => i.outcome === 'FAIL').length).toBe(2)
})

it('quality payload needs at least one reason; free text alone is not enough', () => {
  expect(buildQualityRejectPayload([], '不好看').ok).toBe(false)
})

it('budget payload enforces (0, $50]', () => {
  expect(buildBudgetRejectPayload('').ok).toBe(false)
  expect(buildBudgetRejectPayload('0').ok).toBe(false)
  expect(buildBudgetRejectPayload('abc').ok).toBe(false)
  expect(buildBudgetRejectPayload('50.5').ok).toBe(false)
  const ok = buildBudgetRejectPayload('12.5')
  expect(ok.ok && ok.payload).toEqual({ action: 'reject_budget', new_budget_usd: 12.5 })
  expect(parseReviewBody(ok.ok ? ok.payload : {}).ok).toBe(true)
})
