import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushPhoneReviewItems } from '../manual-crm-items'
import { LANE_OF_KIND } from '../five-kinds'
import { NEVER_DROP_KINDS, type ManualItem } from '../manual-item-types'

function fake(rows: Array<{ client_id: string }> | null, error: { message: string } | null = null) {
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'in', 'limit']) {
    chain[m] = () => (m === 'limit' ? Promise.resolve({ data: rows, error }) : chain)
  }
  return chain as unknown as SupabaseClient
}

describe('待确认电话 → 今日待办', () => {
  it('每个有待确认电话的客户一条汇总，三件套齐全，链接是绝对网址', async () => {
    const items: ManualItem[] = []
    await pushPhoneReviewItems(
      fake([{ client_id: 'cts' }, { client_id: 'cts' }, { client_id: 'nal' }]),
      items,
      ['cts', 'nal'],
      (id) => (id === 'cts' ? 'CTS' : 'NAL'),
    )
    expect(items).toHaveLength(2)
    const cts = items.find((i) => i.client_id === 'cts')!
    expect(cts.kind).toBe('phone_call_needs_review')
    expect(cts.what).toContain('2 通')
    expect(cts.how.length).toBeGreaterThan(10)
    expect(cts.href).toBe('https://app.magicengine.com.au/dashboard/clients/cts/crm/phone-review')
  })

  it('没有待确认的就不出条；没有客户 id 也不出条', async () => {
    const a: ManualItem[] = []
    await pushPhoneReviewItems(fake([]), a, ['cts'], () => 'CTS')
    const b: ManualItem[] = []
    await pushPhoneReviewItems(fake([{ client_id: 'cts' }]), b, [], () => 'CTS')
    expect(a).toHaveLength(0)
    expect(b).toHaveLength(0)
  })

  it('🔴 读失败要抛出去，不许当成「没有待确认」', async () => {
    await expect(
      pushPhoneReviewItems(fake(null, { message: 'down' }), [], ['cts'], () => 'CTS'),
    ).rejects.toThrow()
  })

  it('归「要转给客户那边」栏，且链接要登录也不能被探活丢掉', () => {
    expect(LANE_OF_KIND.phone_call_needs_review).toBe('client_side')
    expect(NEVER_DROP_KINDS.has('phone_call_needs_review')).toBe(true)
  })
})
