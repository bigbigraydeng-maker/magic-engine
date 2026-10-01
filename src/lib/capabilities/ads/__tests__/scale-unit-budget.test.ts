import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityStepContext } from '@/lib/kernel/types'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { getAdSetStatus, setAdSetDailyBudget } from '@/lib/meta/adsets'
import { getCampaignDetails } from '@/lib/meta/campaign-management'
import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'
import { makeReadbackVerification } from '../common'
import { createScaleUnitBudgetCapability } from '../scale-unit-budget'

vi.mock('@/lib/meta/adsets', () => ({ getAdSetStatus: vi.fn(), setAdSetDailyBudget: vi.fn() }))
vi.mock('@/lib/meta/campaign-management', () => ({ getCampaignDetails: vi.fn() }))
vi.mock('@/lib/meta/campaign-writes', () => ({ setCampaignDailyBudget: vi.fn() }))
vi.mock('@/lib/meta/ad-account-binding', () => ({
  canonicalAccountDigits: (id: string) => id.replace(/^act_/, ''),
  findOtherClientRegistrations: vi.fn(async () => []),
}))
vi.mock('@/lib/meta/campaign-ownership', () => ({ getRegisteredAccountIds: vi.fn(async () => ({ ids: ['1234567890'], error: null })) }))
vi.mock('../common', () => ({
  makeSnapshotPreStep: vi.fn(() => vi.fn()),
  makeReadbackVerification: vi.fn(),
  requireMetaToken: vi.fn(async () => 'test-token'),
}))

function step(before: number, after: number): CapabilityStepContext {
  return {
    ctx: { clientId: 'client-a' } as CapabilityStepContext['ctx'],
    stepKey: 'apply', attempt: 1, idempotencyKey: 'test-scale', priorOutputs: {},
    runInput: { adset_id: 'adset-a', ad_account_id: 'act_1234567890', before_cents: before, after_cents: after },
  }
}

function campaignStep(before: number, after: number): CapabilityStepContext {
  return {
    ...step(before, after),
    runInput: { adset_id: 'adset-a', campaign_id: '456', ad_account_id: 'act_1234567890', before_cents: before, after_cents: after },
  }
}

describe('O1 放量写入前复核获批预算基线', () => {
  const capability = createScaleUnitBudgetCapability(createFakeSupabase({}))
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setAdSetDailyBudget).mockResolvedValue(true)
    vi.mocked(setCampaignDailyBudget).mockResolvedValue(true)
  })

  it('Meta 当前预算与获批基线一致时，保存回滚依据并写入新预算', async () => {
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '1000' })
    const result = await capability.steps.apply(step(1000, 1200))
    expect(setAdSetDailyBudget).toHaveBeenCalledWith('adset-a', 'test-token', 1200)
    expect(result.output).toMatchObject({ prior_daily_budget_cents: 1000, new_daily_budget_cents: 1200 })
  })

  it('获批后 Meta 预算发生变化时停止，不覆盖人工改动', async () => {
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '1100' })
    await expect(capability.steps.apply(step(1000, 1200))).rejects.toThrow('Meta 当前预算与审批时看到的金额不同')
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it.each([['above 20%', 1000, 1201], ['a decrease', 1000, 900], ['fractional cents', 1000, 1200.5]])(
    'ABO capability rejects %s before provider write', async (_label, before, after) => {
      await expect(capability.steps.apply(step(before, after))).rejects.toThrow()
      expect(getAdSetStatus).not.toHaveBeenCalled()
      expect(setAdSetDailyBudget).not.toHaveBeenCalled()
    },
  )

  it('CBO 来源广告组命中 O1 时，提高其广告系列预算并保存回滚基线', async () => {
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '5000' })
    const result = await capability.steps.apply(campaignStep(5000, 6000))
    expect(setCampaignDailyBudget).toHaveBeenCalledWith('456', 'test-token', 6000)
    expect(result.output).toMatchObject({ campaign_id: '456', prior_daily_budget_cents: 5000, new_daily_budget_cents: 6000 })
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('CBO 广告系列预算与审批基线不同就停止写入', async () => {
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '5100' })
    await expect(capability.steps.apply(campaignStep(5000, 6000))).rejects.toThrow('Meta 当前系列预算与审批时的金额不同')
    expect(setCampaignDailyBudget).not.toHaveBeenCalled()
  })

  it('CBO 上调超过 20% 时 capability 自身也拒绝写入', async () => {
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '5000' })
    await expect(capability.steps.apply(campaignStep(5000, 6001))).rejects.toThrow('不能超过 20%')
    expect(setCampaignDailyBudget).not.toHaveBeenCalled()
  })

  it('CBO 写入后回读 Meta 确认新预算', async () => {
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '6000' })
    const result = await capability.steps.readback(campaignStep(5000, 6000))
    expect(result.output).toMatchObject({ campaign_id: '456', daily_budget_now: 6000 })
    expect(makeReadbackVerification).toHaveBeenCalledWith({ daily_budget: 6000 }, { daily_budget: 6000 })
  })

  it('CBO 出错撤回时只在 Meta 仍是本次写入值时恢复', async () => {
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '6000' })
    await capability.rollback?.(campaignStep(5000, 6000), { apply: { applied: true, prior_daily_budget_cents: 5000, new_daily_budget_cents: 6000 } })
    expect(setCampaignDailyBudget).toHaveBeenCalledWith('456', 'test-token', 5000)

    vi.clearAllMocks()
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '6500' })
    const result = await capability.rollback?.(campaignStep(5000, 6000), { apply: { applied: true, prior_daily_budget_cents: 5000, new_daily_budget_cents: 6000 } })
    expect(result).toMatchObject({ ok: false })
    expect(setCampaignDailyBudget).not.toHaveBeenCalled()
  })

  it('ABO 出错撤回时只有 Meta 仍是本次写入值才恢复', async () => {
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '1200' })
    const context = step(1000, 1200)
    await capability.rollback?.(context, { apply: { applied: true, prior_daily_budget_cents: 1000, new_daily_budget_cents: 1200 } })
    expect(setAdSetDailyBudget).toHaveBeenCalledWith('adset-a', 'test-token', 1000)

    vi.clearAllMocks()
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '1300' })
    const result = await capability.rollback?.(context, { apply: { applied: true, prior_daily_budget_cents: 1000, new_daily_budget_cents: 1200 } })
    expect(result).toMatchObject({ ok: false, failure_reason: expect.stringContaining('未覆盖新值') })
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('ABO rollback fails closed if the Kernel lost apply output', async () => {
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '1200' })
    const result = await capability.rollback?.(step(1000, 1200), {})
    expect(result).toMatchObject({ ok: false })
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('CBO rollback fails closed if the Kernel lost apply output', async () => {
    vi.mocked(getCampaignDetails).mockResolvedValue({ id: '456', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '6000' })
    const result = await capability.rollback?.(campaignStep(5000, 6000), {})
    expect(result).toMatchObject({ ok: false })
    expect(setCampaignDailyBudget).not.toHaveBeenCalled()
  })

  it('ABO rollback refuses if Meta returns a different account', async () => {
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', account_id: '9999999999', daily_budget: '1200' })
    const result = await capability.rollback?.(step(1000, 1200), { apply: { applied: true, prior_daily_budget_cents: 1000, new_daily_budget_cents: 1200 } })
    expect(result).toMatchObject({ ok: false })
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })
})
