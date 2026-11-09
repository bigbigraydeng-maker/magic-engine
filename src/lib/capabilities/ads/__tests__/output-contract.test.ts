/**
 * 产物契约闸：每个广告动作**最后一个步骤**的 output，必须满足它在注册表里声明的
 * `outputSchema.required`。
 *
 * 🔴 为什么单独一份测试：产物口径是「契约里最后一个成功步骤的 output」
 *    （`kernel/gateway.ts` 的 `lastOutputOf`），而 `validateAgainstSchema` 真的查
 *    `required`。少一个字段的后果不是「少个字段」，是**动作其实做成了、却被判
 *    INVALID_OUTPUT → failRun → 对 provider_native 自动撤回，并谎报失败**。
 *    2026-10-15 子牙复审在 `ads.swap_creative` 上发现这个形态，一查五个动作全中。
 *
 *    现有的每动作测试都直接调 `capability.steps.*`，整条 kernel 判定没被覆盖，
 *    所以这个缺陷在它们全绿的情况下看不出来。这份测试把注册表的声明当唯一真相，
 *    不硬编码字段名——以后注册表加一个必填字段，这里会立刻变红。
 */

import { describe, expect, it, vi } from 'vitest'
import { ADS_ACTION_DEFINITIONS } from '@/lib/kernel/registry-ads'
import { validateAgainstSchema } from '@/lib/kernel/registry'
import type { CapabilityStepContext, CapabilityStepResult } from '@/lib/kernel/types'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { getAdSetStatus, setAdSetDailyBudget, setAdSetStatus } from '@/lib/meta/adsets'
import { getCampaignDetails } from '@/lib/meta/campaign-management'
import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'
import { createPauseUnitCapability } from '../pause-unit'
import { createPauseCampaignCapability } from '../pause-campaign'
import { createCutUnitBudgetCapability } from '../cut-unit-budget'
import { createCutCampaignBudgetCapability } from '../cut-campaign-budget'
import { createScaleUnitBudgetCapability } from '../scale-unit-budget'

vi.mock('@/lib/meta/adsets', () => ({
  getAdSetStatus: vi.fn(async () => ({ id: 'adset-a', name: 't', status: 'PAUSED', account_id: '1234567890', daily_budget: '1000' })),
  setAdSetDailyBudget: vi.fn(async () => true),
  setAdSetStatus: vi.fn(async () => true),
}))
vi.mock('@/lib/meta/campaign-management', () => ({
  getCampaignDetails: vi.fn(async () => ({ id: '456', name: 't', status: 'PAUSED', account_id: '1234567890', daily_budget: '1000' })),
}))
vi.mock('@/lib/meta/campaign-writes', () => ({ setCampaignDailyBudget: vi.fn(async () => true) }))
vi.mock('@/lib/meta/ad-account-binding', () => ({
  canonicalAccountDigits: (id: string) => id.replace(/^act_/, ''),
  findOtherClientRegistrations: vi.fn(async () => []),
}))
vi.mock('@/lib/meta/campaign-ownership', () => ({
  getRegisteredAccountIds: vi.fn(async () => ({ ids: ['1234567890'], error: null })),
}))
vi.mock('../common', () => ({
  makeSnapshotPreStep: vi.fn(() => vi.fn()),
  makeReadbackVerification: vi.fn(() => ({ method: 'ads_readback_integrity', passed: true, checks: [] })),
  requireMetaToken: vi.fn(async () => 'test-token'),
}))

const sb = createFakeSupabase({})

/** 每个动作：最后一个步骤的名字 + 跑它要的 input / 前序回执。 */
const CASES = [
  {
    actionKey: 'ads.pause_unit' as const,
    capability: createPauseUnitCapability(sb),
    runInput: { cycle_date: '2026-10-15', ad_account_id: 'act_1234567890', adset_id: 'adset-a' },
    priorOutputs: { apply: { prior_effective_status: 'ACTIVE' } },
  },
  {
    actionKey: 'ads.pause_campaign' as const,
    capability: createPauseCampaignCapability(sb),
    runInput: { cycle_date: '2026-10-15', ad_account_id: 'act_1234567890', campaign_id: '456' },
    priorOutputs: { apply: { prior_status: 'ACTIVE' } },
  },
  {
    actionKey: 'ads.cut_unit_budget' as const,
    capability: createCutUnitBudgetCapability(sb),
    runInput: { cycle_date: '2026-10-15', ad_account_id: 'act_1234567890', adset_id: 'adset-a', before_cents: 2000, after_cents: 1000 },
    priorOutputs: { apply: { prior_daily_budget_cents: 2000, new_daily_budget_cents: 1000 } },
  },
  {
    actionKey: 'ads.cut_campaign_budget' as const,
    capability: createCutCampaignBudgetCapability(sb),
    runInput: { cycle_date: '2026-10-15', ad_account_id: 'act_1234567890', campaign_id: '456', before_cents: 2000, after_cents: 1000 },
    priorOutputs: { apply: { prior_daily_budget_cents: 2000, new_daily_budget_cents: 1000 } },
  },
  {
    actionKey: 'ads.scale_unit_budget' as const,
    capability: createScaleUnitBudgetCapability(sb),
    runInput: { cycle_date: '2026-10-15', ad_account_id: 'act_1234567890', adset_id: 'adset-a', before_cents: 1000, after_cents: 1000 },
    priorOutputs: { apply: { prior_daily_budget_cents: 1000, new_daily_budget_cents: 1200 } },
  },
]

function stepCtx(
  stepKey: string,
  runInput: Record<string, unknown>,
  priorOutputs: Record<string, Record<string, unknown>>,
): CapabilityStepContext {
  return {
    ctx: { clientId: 'client-a' } as CapabilityStepContext['ctx'],
    stepKey, attempt: 1, idempotencyKey: `contract-${stepKey}`, priorOutputs, runInput,
  }
}

describe('广告动作的产物必须满足注册表声明的契约', () => {
  it.each(CASES.map(c => [c.actionKey, c] as const))(
    '%s 的最后一个步骤产出注册表要求的全部必填字段',
    async (actionKey, testCase) => {
      const definition = ADS_ACTION_DEFINITIONS[actionKey]
      const lastStepKey = definition.steps[definition.steps.length - 1]
      const handler = testCase.capability.steps[lastStepKey]
      expect(handler, `${actionKey} 没有实现契约里的最后一步 ${lastStepKey}`).toBeTypeOf('function')

      const result: CapabilityStepResult = await handler(
        stepCtx(lastStepKey, testCase.runInput, testCase.priorOutputs),
      )
      const check = validateAgainstSchema(definition.outputSchema, result.output ?? {})
      expect(check.ok ? null : check.reason).toBeNull()
    },
  )

  it('闸本身有效：故意拿一个缺 applied 的产物去校验，必须被判不合格', () => {
    const definition = ADS_ACTION_DEFINITIONS['ads.pause_unit']
    const check = validateAgainstSchema(definition.outputSchema, { adset_id: 'adset-a' })
    expect(check.ok).toBe(false)
  })
})

// 让 mock 的导入不被 lint 当成未使用
void getAdSetStatus; void setAdSetDailyBudget; void setAdSetStatus; void getCampaignDetails; void setCampaignDailyBudget
