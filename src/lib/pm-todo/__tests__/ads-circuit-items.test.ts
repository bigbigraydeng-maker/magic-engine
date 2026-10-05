import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import type { ActiveCircuitTrip } from '@/lib/ads-strategy/circuit-state'

const h = vi.hoisted(() => ({ trips: [] as ActiveCircuitTrip[] }))

vi.mock('@/lib/ads-strategy/circuit-state', () => ({
  listActiveCircuitTrips: vi.fn(async () => h.trips),
}))

import { pushAdsCircuitItems } from '../ads-circuit-items'

const SB = {} as SupabaseClient
const nameOf = (id: string) => `客户-${id}`

function trip(over: Partial<ActiveCircuitTrip> & { clientId: string; adAccountId: string }): ActiveCircuitTrip {
  return { reason: 'circuit:spend_spike', sticky: false, openTripCount: 1, ...over }
}

describe('pushAdsCircuitItems', () => {
  it('没有熔断中的账户 → 不出待办', async () => {
    h.trips = []
    const items: ManualItem[] = []
    await pushAdsCircuitItems(SB, items, nameOf)
    expect(items).toHaveLength(0)
  })

  it('一个账户熔断中 → 出一条待办，client_id / client_name 对得上', async () => {
    h.trips = [trip({ clientId: 'c-1', adAccountId: 'act_1' })]
    const items: ManualItem[] = []
    await pushAdsCircuitItems(SB, items, nameOf)
    expect(items).toHaveLength(1)
    expect(items[0].client_id).toBe('c-1')
    expect(items[0].client_name).toBe('客户-c-1')
    expect(items[0].kind).toBe('ads_circuit_tripped')
  })

  it('两个账户各自熔断 → 出两条待办', async () => {
    h.trips = [
      trip({ clientId: 'c-1', adAccountId: 'act_1' }),
      trip({ clientId: 'c-2', adAccountId: 'act_2' }),
    ]
    const items: ManualItem[] = []
    await pushAdsCircuitItems(SB, items, nameOf)
    expect(items).toHaveLength(2)
  })

  describe('文案：sticky 与非 sticky 说的话必须不同', () => {
    it('非 sticky → 说"24 小时后自己解除"，不要求人手动解', async () => {
      h.trips = [trip({ clientId: 'c-1', adAccountId: 'act_1', sticky: false })]
      const items: ManualItem[] = []
      await pushAdsCircuitItems(SB, items, nameOf)
      expect(items[0].what).toContain('24 小时后系统会自己解除')
      expect(items[0].how).not.toContain('必须你确认之后手动解除')
    })

    it('🔴 sticky → 明确说"系统不会自己解除、必须人解除"，不能说 24 小时会自动好', async () => {
      h.trips = [trip({ clientId: 'c-1', adAccountId: 'act_1', sticky: true })]
      const items: ManualItem[] = []
      await pushAdsCircuitItems(SB, items, nameOf)
      expect(items[0].what).toContain('必须你确认之后手动解除')
      expect(items[0].what).not.toContain('24 小时后系统会自己解除')
      expect(items[0].how).toContain('解除熔断')
    })
  })

  describe('reason 文案：已知 code 翻成中文，未知 code 原样带出来', () => {
    it.each([
      ['circuit:absolute_spend_cap', '绝对上限'],
      ['circuit:spend_spike', '暴涨'],
      ['circuit:client_daily_cap_exceeded', '日预算上限'],
    ])('%s → 文案里包含"%s"', async (reason, expectedSubstring) => {
      h.trips = [trip({ clientId: 'c-1', adAccountId: 'act_1', reason })]
      const items: ManualItem[] = []
      await pushAdsCircuitItems(SB, items, nameOf)
      expect(items[0].what).toContain(expectedSubstring)
    })

    it('🔴 rollback_failed:<run_id> → 带出动作编号，不是原样打印整个 code', async () => {
      h.trips = [trip({ clientId: 'c-1', adAccountId: 'act_1', reason: 'circuit:rollback_failed:run-abc123' })]
      const items: ManualItem[] = []
      await pushAdsCircuitItems(SB, items, nameOf)
      expect(items[0].what).toContain('run-abc123')
      expect(items[0].what).toContain('撤回失败')
    })

    it('🔴 映射表里没有的 code → 原样带出来，不静默丢掉原因', async () => {
      h.trips = [trip({ clientId: 'c-1', adAccountId: 'act_1', reason: 'circuit:some_future_code_v99' })]
      const items: ManualItem[] = []
      await pushAdsCircuitItems(SB, items, nameOf)
      expect(items[0].what).toContain('some_future_code_v99')
    })
  })

  it('openTripCount > 1 → 文案里提一句"另外还有 N 条"', async () => {
    h.trips = [trip({ clientId: 'c-1', adAccountId: 'act_1', openTripCount: 3 })]
    const items: ManualItem[] = []
    await pushAdsCircuitItems(SB, items, nameOf)
    expect(items[0].what).toContain('另外还有 2 条')
  })

  it('openTripCount === 1 → 不提"另外还有"这句', async () => {
    h.trips = [trip({ clientId: 'c-1', adAccountId: 'act_1', openTripCount: 1 })]
    const items: ManualItem[] = []
    await pushAdsCircuitItems(SB, items, nameOf)
    expect(items[0].what).not.toContain('另外还有')
  })

  it('href 指向这个客户的 ads-health 页面', async () => {
    h.trips = [trip({ clientId: 'c-1', adAccountId: 'act_1' })]
    const items: ManualItem[] = []
    await pushAdsCircuitItems(SB, items, nameOf)
    expect(items[0].href).toContain('/dashboard/clients/c-1/ads-health')
  })

  it('查询失败（listActiveCircuitTrips 抛错）→ 原样往外抛，不吞掉当成没有熔断', async () => {
    const { listActiveCircuitTrips } = await import('@/lib/ads-strategy/circuit-state')
    vi.mocked(listActiveCircuitTrips).mockRejectedValueOnce(new Error('boom'))
    const items: ManualItem[] = []
    await expect(pushAdsCircuitItems(SB, items, nameOf)).rejects.toThrow('boom')
    expect(items).toHaveLength(0)
  })
})
