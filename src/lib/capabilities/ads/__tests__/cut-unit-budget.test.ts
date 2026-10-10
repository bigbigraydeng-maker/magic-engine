import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityStepContext } from '@/lib/kernel/types'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { getAdSetStatus, setAdSetDailyBudget } from '@/lib/meta/adsets'
import { createCutUnitBudgetCapability } from '../cut-unit-budget'

vi.mock('@/lib/meta/adsets', () => ({ getAdSetStatus: vi.fn(), setAdSetDailyBudget: vi.fn() }))
vi.mock('../common', () => ({
  makeSnapshotPreStep: vi.fn(() => vi.fn()),
  makeReadbackVerification: vi.fn(),
  requireMetaToken: vi.fn(async () => 'test-token'),
}))

// This isolated capability test never authorizes a real Kernel run or calls Meta.
function step(after: number): CapabilityStepContext {
  return {
    ctx: { clientId: 'client-a' } as CapabilityStepContext['ctx'],
    stepKey: 'apply', attempt: 1, idempotencyKey: 'test-cut', priorOutputs: {},
    runInput: { adset_id: 'adset-a', after_cents: after },
  }
}

describe('减预算在实际写入前检查实时金额', () => {
  const capability = createCutUnitBudgetCapability(createFakeSupabase({}))
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setAdSetDailyBudget).mockResolvedValue(true)
  })

  it.each([500, 1000])('允许降低或幂等重试相同金额 %s，保留回滚依据', async after => {
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', daily_budget: '1000' })
    const result = await capability.steps.apply(step(after))
    expect(setAdSetDailyBudget).toHaveBeenCalledWith('adset-a', 'test-token', after)
    expect(result.output).toMatchObject({ prior_daily_budget_cents: 1000, new_daily_budget_cents: after })
  })

  it('计划 1000→800，但实时预算已降至600：不能反向加回800', async () => {
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', daily_budget: '600' })
    await expect(capability.steps.apply(step(800))).rejects.toMatchObject({ code: 'INVALID_INPUT', retryable: false })
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it.each([undefined, '', ' ', 'NaN', 'Infinity', '-100', '1000junk', '1000.5'])('实时预算无效 %s：不得写入', async daily_budget => {
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', daily_budget })
    await expect(capability.steps.apply(step(500))).rejects.toThrow()
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('实体读不到：不得写入', async () => {
    vi.mocked(getAdSetStatus).mockResolvedValue(null)
    await expect(capability.steps.apply(step(500))).rejects.toThrow()
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('无效目标 %s：读取和写入都不发生', async after => {
    await expect(capability.steps.apply(step(after))).rejects.toThrow()
    expect(getAdSetStatus).not.toHaveBeenCalled()
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('供应商拒绝：不能返回已执行成功', async () => {
    vi.mocked(getAdSetStatus).mockResolvedValue({ id: 'adset-a', name: 'test', status: 'ACTIVE', daily_budget: '1000' })
    vi.mocked(setAdSetDailyBudget).mockResolvedValue(false)
    await expect(capability.steps.apply(step(500))).rejects.toThrow()
  })
})
