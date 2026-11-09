import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityStepContext } from '@/lib/kernel/types'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { findOtherClientRegistrations } from '@/lib/meta/ad-account-binding'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getCampaignDetails } from '@/lib/meta/campaign-management'
import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'
import { createCutCampaignBudgetCapability } from '../cut-campaign-budget'

vi.mock('@/lib/meta/ad-account-binding', () => ({
  canonicalAccountDigits: (id: string) => id.replace(/^act_/, ''),
  findOtherClientRegistrations: vi.fn(),
}))
vi.mock('@/lib/meta/campaign-ownership', () => ({ getRegisteredAccountIds: vi.fn() }))
vi.mock('@/lib/meta/campaign-management', () => ({ getCampaignDetails: vi.fn() }))
vi.mock('@/lib/meta/campaign-writes', () => ({ setCampaignDailyBudget: vi.fn() }))
vi.mock('../common', () => ({
  makeSnapshotPreStep: vi.fn(() => vi.fn(async () => ({ output: { captured: true } }))),
  makeReadbackVerification: vi.fn((expected, actual) => ({
    method: 'ads_readback_integrity',
    passed: Object.entries(expected).every(([key, value]) => actual[key] === value),
    checks: [],
  })),
  requireMetaToken: vi.fn(async () => 'fake-token'),
}))

const cap = createCutCampaignBudgetCapability(createFakeSupabase({}))

function step(after = 4_000): CapabilityStepContext {
  return {
    ctx: { clientId: 'client-a' } as CapabilityStepContext['ctx'],
    stepKey: 'apply', attempt: 1, idempotencyKey: 'cut-campaign-test', priorOutputs: {},
    runInput: { cycle_date: '2026-09-30', ad_account_id: 'act_1234567890', campaign_id: '456', after_cents: after },
  }
}

describe('系列级预算能力只降低已登记、独占账户里的 CBO 系列预算', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRegisteredAccountIds).mockResolvedValue({ ids: ['act_1234567890'] })
    vi.mocked(findOtherClientRegistrations).mockResolvedValue([])
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '1234567890' })
    vi.mocked(setCampaignDailyBudget).mockResolvedValue(true)
  })

  it('写入前重读系列和账户，成功后保留原值作为撤回依据', async () => {
    const result = await cap.steps.apply(step())
    expect(getCampaignDetails).toHaveBeenCalledWith('456', 'fake-token')
    expect(setCampaignDailyBudget).toHaveBeenCalledWith('456', 'fake-token', 4_000)
    expect(result.output).toEqual({ campaign_id: '456', applied: true, prior_daily_budget_cents: 5_000, new_daily_budget_cents: 4_000, campaign_status_after: 'ACTIVE' })
  })

  it('预算变更后系列已暂停时不自动重新开启，以免覆盖新的暂停决定', async () => {
    vi.mocked(getCampaignDetails)
      .mockResolvedValueOnce({ id: '456', name: 'campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '1234567890' })
      .mockResolvedValueOnce({ id: '456', name: 'campaign', status: 'PAUSED', daily_budget: '4000', account_id: '1234567890' })
    const result = await cap.steps.apply(step())
    expect(result.output).toMatchObject({
      campaign_status_after: 'PAUSED',
      status_warning: expect.stringContaining('未自动重新开启'),
    })
    expect(setCampaignDailyBudget).toHaveBeenCalledWith('456', 'fake-token', 4_000)
  })

  it('目标高于实时预算时拒绝写入', async () => {
    await expect(cap.steps.apply(step(5_001))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(setCampaignDailyBudget).not.toHaveBeenCalled()
  })

  it('再次核对实时预算，拒绝超过自治信封 20% 的变化', async () => {
    vi.mocked(getCampaignDetails).mockResolvedValueOnce({ id: '456', name: 'campaign', status: 'ACTIVE', daily_budget: '20000', account_id: '1234567890' })
    await expect(cap.steps.apply(step(4_000))).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(setCampaignDailyBudget).not.toHaveBeenCalled()
  })

  it('非登记账户、共享账户、错账户或无系列级预算都 fail closed', async () => {
    vi.mocked(getRegisteredAccountIds).mockResolvedValueOnce({ ids: ['act_4567890123'] })
    await expect(cap.steps.apply(step())).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    vi.mocked(getRegisteredAccountIds).mockResolvedValue({ ids: ['act_1234567890'] })
    vi.mocked(findOtherClientRegistrations).mockResolvedValueOnce([{ client_id: 'client-b', client_name: 'Other' }])
    await expect(cap.steps.apply(step())).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    vi.mocked(findOtherClientRegistrations).mockResolvedValue([])
    vi.mocked(getCampaignDetails).mockResolvedValueOnce({ id: '456', name: 'campaign', status: 'ACTIVE', daily_budget: '5000', account_id: '4567890123' })
    await expect(cap.steps.apply(step())).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    vi.mocked(getCampaignDetails).mockResolvedValueOnce({ id: '456', name: 'campaign', status: 'ACTIVE', account_id: '1234567890' })
    await expect(cap.steps.apply(step())).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(setCampaignDailyBudget).not.toHaveBeenCalled()
  })

  it('撤回只在实时值仍是本次目标时恢复，避免覆盖他人后续改动', async () => {
    const outputs = { apply: { applied: true, prior_daily_budget_cents: 5_000, new_daily_budget_cents: 4_000 } }
    vi.mocked(getCampaignDetails).mockResolvedValueOnce({ id: '456', name: 'campaign', status: 'ACTIVE', daily_budget: '4500', account_id: '1234567890' })
    if (!cap.rollback) throw new Error('expected rollback handler')
    const result = await cap.rollback(step(), outputs)
    expect(result).toMatchObject({ ok: false, failure_reason: expect.stringContaining('未自动恢复原值') })
    expect(setCampaignDailyBudget).not.toHaveBeenCalled()
    vi.mocked(getCampaignDetails).mockResolvedValueOnce({ id: '456', name: 'campaign', status: 'ACTIVE', daily_budget: '4000', account_id: '1234567890' })
    const restored = await cap.rollback(step(), outputs)
    expect(restored.ok).toBe(true)
    expect(setCampaignDailyBudget).toHaveBeenCalledWith('456', 'fake-token', 5_000)
  })
})
