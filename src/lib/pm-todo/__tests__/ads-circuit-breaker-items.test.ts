import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import { pushAdsCircuitBreakerItems } from '../ads-circuit-breaker-items'

function sb(rows: unknown[]): SupabaseClient {
  const api = {
    select: () => api,
    eq: () => api,
    gte: () => api,
    limit: async () => ({ data: rows, error: null }),
  }
  return { from: () => api } as unknown as SupabaseClient
}

describe('pushAdsCircuitBreakerItems', () => {
  it('暂停提议和只提醒分成两种待办，都不说已经暂停', async () => {
    const items: ManualItem[] = []
    await pushAdsCircuitBreakerItems(sb([
      { client_id: 'client-a', payload: { status: 'card_issued', campaign_name: '春季系列', wrote: false, summary: '超了' } },
      { client_id: 'client-a', payload: { status: 'alert_only', summary: '数据旧了', wrote: false } },
    ]), items, new Date('2026-11-09T00:00:00.000Z'), (id) => `客户-${id}`)
    expect(items.map((item) => item.kind)).toEqual(['ads_circuit_breaker_pause', 'ads_circuit_breaker_alert'])
    expect(items[0]?.what).toContain('没有暂停')
    expect(items[0]?.how).toContain('点确认')
    expect(items[1]?.what).toContain('数据旧了')
  })
})
