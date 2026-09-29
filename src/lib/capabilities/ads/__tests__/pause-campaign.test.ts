import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityStepContext } from '@/lib/kernel/types'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { findOtherClientRegistrations } from '@/lib/meta/ad-account-binding'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getCampaignDetails } from '@/lib/meta/campaign-management'
import { setCampaignStatus } from '@/lib/meta/campaign-writes'
import { createPauseCampaignCapability } from '../pause-campaign'

vi.mock('@/lib/meta/ad-account-binding', () => ({ canonicalAccountDigits: (id: string) => id.replace(/^act_/, ''), findOtherClientRegistrations: vi.fn() }))
vi.mock('@/lib/meta/campaign-ownership', () => ({ getRegisteredAccountIds: vi.fn() }))
vi.mock('@/lib/meta/campaign-management', () => ({ getCampaignDetails: vi.fn() }))
vi.mock('@/lib/meta/campaign-writes', () => ({ setCampaignStatus: vi.fn() }))
vi.mock('../common', () => ({
  makeSnapshotPreStep: vi.fn(() => vi.fn(async () => ({ output: { captured: true } }))),
  makeReadbackVerification: vi.fn((expected, actual) => ({ method: 'ads_readback_integrity', passed: Object.entries(expected).every(([key, value]) => actual[key] === value), checks: [] })),
  requireMetaToken: vi.fn(async () => 'token'),
}))

const cap = createPauseCampaignCapability(createFakeSupabase({}))
const step: CapabilityStepContext = {
  ctx: { clientId: 'client-a' } as CapabilityStepContext['ctx'], stepKey: 'apply', attempt: 1,
  idempotencyKey: 'pause-campaign-test', priorOutputs: {},
  runInput: { cycle_date: '2026-09-30', ad_account_id: 'act_1234567890', campaign_id: '456' },
}

describe('ads.pause_campaign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRegisteredAccountIds).mockResolvedValue({ ids: ['act_1234567890'] })
    vi.mocked(findOtherClientRegistrations).mockResolvedValue([])
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'Campaign', status: 'ACTIVE', account_id: '1234567890' })
    vi.mocked(setCampaignStatus).mockResolvedValue(true)
  })

  it('只暂停客户登记且未共享账户中的系列，并保留撤回前状态', async () => {
    const result = await cap.steps.apply(step)
    expect(setCampaignStatus).toHaveBeenCalledWith('456', 'token', 'PAUSED')
    expect(result.output).toEqual({ campaign_id: '456', applied: true, prior_status: 'ACTIVE' })
  })

  it('系列已暂停时不重复写 Meta', async () => {
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'Campaign', status: 'PAUSED', account_id: '1234567890' })
    expect((await cap.steps.apply(step)).output).toMatchObject({ applied: false })
    expect(setCampaignStatus).not.toHaveBeenCalled()
  })

  it('账户未登记或被多个客户共用时拒绝写入', async () => {
    vi.mocked(getRegisteredAccountIds).mockResolvedValueOnce({ ids: [] })
    await expect(cap.steps.apply(step)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    vi.mocked(findOtherClientRegistrations).mockResolvedValueOnce([{ client_id: 'client-b', client_name: 'Other' }])
    await expect(cap.steps.apply(step)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(setCampaignStatus).not.toHaveBeenCalled()
  })
})
