import { describe, expect, it, vi } from 'vitest'
import type { ManualItem } from '../manual-item-types'
import { pushAdsPlanDeliveryStageMissingItems } from '../ads-plan-delivery-stage-items'
import {
  clientHasDeliveringAds,
  loadApprovedPromoDeliveryStage,
} from '@/lib/marketing-plan/promo/approved-delivery-stage'

vi.mock('@/lib/meta/client-ad-accounts', () => ({
  getActiveClientsWithMetaAccounts: vi.fn(async () => [
    { id: 'c1', name: '测试客户', meta_ad_account_id: 'act_1' },
    { id: 'c2', name: '已有阶段', meta_ad_account_id: 'act_2' },
  ]),
}))

vi.mock('@/lib/marketing-plan/promo/approved-delivery-stage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/marketing-plan/promo/approved-delivery-stage')>()
  return {
    ...actual,
    loadApprovedPromoDeliveryStage: vi.fn(),
    clientHasDeliveringAds: vi.fn(),
  }
})

const loadStage = vi.mocked(loadApprovedPromoDeliveryStage)
const loadLive = vi.mocked(clientHasDeliveringAds)

describe('pushAdsPlanDeliveryStageMissingItems', () => {
  it('缺阶段且在投 → 一条待办，按客户去重', async () => {
    loadStage.mockImplementation(async (_, clientId) => (
      clientId === 'c1' ? { kind: 'missing' } : { kind: 'set', stage: 'test' }
    ))
    loadLive.mockResolvedValue(true)
    const items: ManualItem[] = []
    await pushAdsPlanDeliveryStageMissingItems({} as never, items, () => 'n')
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('ads_plan_delivery_stage_missing')
    expect(items[0]?.client_id).toBe('c1')
    await pushAdsPlanDeliveryStageMissingItems({} as never, items, () => 'n')
    expect(items).toHaveLength(1)
  })

  it('已标阶段 → 不出待办', async () => {
    loadStage.mockResolvedValue({ kind: 'set', stage: 'scale' })
    loadLive.mockResolvedValue(true)
    const items: ManualItem[] = []
    await pushAdsPlanDeliveryStageMissingItems({} as never, items, () => 'n')
    expect(items).toHaveLength(0)
  })

  it('缺阶段但没在投广告 → 不出待办', async () => {
    loadStage.mockResolvedValue({ kind: 'missing' })
    loadLive.mockResolvedValue(false)
    const items: ManualItem[] = []
    await pushAdsPlanDeliveryStageMissingItems({} as never, items, () => 'n')
    expect(items).toHaveLength(0)
  })
})
