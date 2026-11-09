import { describe, expect, it } from 'vitest'
import { pushPlanDraftFailureItems } from '../plan-draft-failure-items'
import { LANE_OF_KIND } from '../five-kinds'
import { NEVER_DROP_KINDS } from '../manual-item-types'
import type { ManualItem } from '../manual-item-types'

function supabase(rows: unknown[]) {
  const chain = {
    select() { return chain },
    in() { return chain },
    eq() { return chain },
    limit() { return Promise.resolve({ data: rows, error: null }) },
  }
  return { from: () => chain }
}

describe('plan draft failure todo', () => {
  it('emits one absolute link when the receipt is escalated', async () => {
    const bucket: ManualItem[] = []
    await pushPlanDraftFailureItems(
      supabase([{
        id: 'rx-1',
        client_id: 'client-1',
        generation_meta: { plan_draft: { escalated: true, status: 'failed', reason_text: '网络' } },
      }]) as never,
      bucket,
      ['client-1'],
      () => '示例客户',
    )
    expect(bucket).toHaveLength(1)
    expect(bucket[0].kind).toBe('plan_draft_auto_failed')
    expect(bucket[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/client-1/promo-plan')
    expect(bucket[0].what).toContain('连续 3 次')
    expect(LANE_OF_KIND.plan_draft_auto_failed).toBe('dev')
    expect(NEVER_DROP_KINDS.has('plan_draft_auto_failed')).toBe(true)
  })

  it('ignores a receipt that is not escalated', async () => {
    const bucket: ManualItem[] = []
    await pushPlanDraftFailureItems(
      supabase([{
        id: 'rx-1',
        client_id: 'client-1',
        generation_meta: { plan_draft: { escalated: false, status: 'failed' } },
      }]) as never,
      bucket,
      ['client-1'],
      () => '示例客户',
    )
    expect(bucket).toHaveLength(0)
  })
})
