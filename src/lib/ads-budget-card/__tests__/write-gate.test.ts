import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { isWithinHumanStopEnvelope, type EnvelopeFacts, type EnvelopeRequest } from '@/lib/kernel/autonomy-envelope'
import { getAdSetStatus, setAdSetDailyBudget } from '@/lib/meta/adsets'
import { setCampaignDailyBudget } from '@/lib/meta/campaign-writes'
import { createCutUnitBudgetCapability } from '@/lib/capabilities/ads/cut-unit-budget'
import { createScaleUnitBudgetCapability } from '@/lib/capabilities/ads/scale-unit-budget'
import type { CapabilityStepContext } from '@/lib/kernel/types'
import { approvalPlanHash } from '@/lib/approval-source/read'
import { type PrescriptionLock } from '../prescription-lock'
import { readAccountCurrency } from '../meta'
import { budgetCardWriteBlock, cardFields } from '../write-gate'

vi.mock('@/lib/meta/adsets', () => ({ getAdSetStatus: vi.fn(), setAdSetDailyBudget: vi.fn() }))
vi.mock('@/lib/meta/campaign-management', () => ({ getCampaignDetails: vi.fn() }))
vi.mock('@/lib/meta/campaign-writes', () => ({ setCampaignDailyBudget: vi.fn() }))
vi.mock('@/lib/meta/ad-account-binding', () => ({
  canonicalAccountDigits: (id: string) => id.replace(/^act_/, ''),
  findOtherClientRegistrations: vi.fn(async () => []),
}))
vi.mock('@/lib/meta/campaign-ownership', () => ({
  getRegisteredAccountIds: vi.fn(async () => ({ ids: ['1234567890'], error: null })),
}))
vi.mock('@/lib/capabilities/ads/common', () => ({
  makeSnapshotPreStep: vi.fn(() => vi.fn()),
  makeReadbackVerification: vi.fn(),
  requireMetaToken: vi.fn(async () => 'test-token'),
}))

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const GOAL = '90a10000-0000-4000-8000-00000000000a'
const PLAN_HASH = 'hash-plan'
const lock: PrescriptionLock = {
  prescriptionId: 'p1110000-0000-4000-8000-000000000001',
  version: 2,
  goalId: GOAL,
  planId: 'plan-1',
  planHash: approvalPlanHash('plan-1', PLAN_HASH),
  approvedOn: '2026-11-02',
}

function prescription(version = 2) {
  return {
    id: lock.prescriptionId,
    client_id: CLIENT,
    status: 'approved',
    version,
    goal_id: GOAL,
    approved_at: '2026-11-02T00:00:00.000Z',
    content: { plan_seed: { schema_version: 1 } },
    generation_meta: { plan_draft: { status: 'created', plan_id: 'plan-1' } },
  }
}

function planRow(version: number) {
  return {
    id: 'plan-1',
    client_id: CLIENT,
    status: 'approved',
    plan_data: {},
    generation_meta: {
      from_prescription: { prescription_id: lock.prescriptionId, version },
      blank_draft: { goal_id: GOAL },
      approval_receipt: { content_hash: PLAN_HASH },
    },
  }
}

function policy(mode: string, ratio: number | null) {
  return {
    id: 'policy-card',
    client_id: CLIENT,
    action_key: 'ads.adjust_adset_daily_budget',
    mode,
    metadata: ratio === null ? {} : { max_budget_step_ratio: ratio },
    effective_from: '2020-01-01T00:00:00.000Z',
    effective_to: null,
  }
}

function db(version = 2, mode = 'auto_approve', ratio: number | null = 0.2) {
  return createFakeSupabase({
    prescriptions: [prescription(version)],
    goals: [{ id: GOAL, client_id: CLIENT, status: 'active' }],
    marketing_plans: [planRow(version)],
    client_automation_policies: [policy(mode, ratio)],
  })
}

function cutStep(after: number, extra: Record<string, unknown> = {}): CapabilityStepContext {
  return {
    ctx: { clientId: CLIENT } as CapabilityStepContext['ctx'],
    stepKey: 'apply', attempt: 1, idempotencyKey: 'card-cut', priorOutputs: {},
    runInput: {
      adset_id: 'adset-a', ad_account_id: 'act_1234567890', before_cents: 1000, after_cents: after,
      ...cardFields(lock), ...extra,
    },
  }
}

describe('budget card recheck at the provider write', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setAdSetDailyBudget).mockResolvedValue(true)
    vi.mocked(getAdSetStatus).mockResolvedValue({
      id: 'adset-a', name: 'test', status: 'ACTIVE', account_id: '1234567890', daily_budget: '1000',
    })
  })

  it('stops a cut when the live budget is no longer the confirmed baseline', async () => {
    vi.mocked(getAdSetStatus).mockResolvedValue({
      id: 'adset-a', name: 'test', status: 'ACTIVE', daily_budget: '1200',
    })
    const capability = createCutUnitBudgetCapability(db())
    await expect(capability.steps.apply(cutStep(800))).rejects.toThrow(/不一样/)
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('still enforces the tighter client ratio when the human-stop envelope would allow the cut', async () => {
    const request: EnvelopeRequest = { kind: 'budget_change', afterCents: 800 }
    const facts: EnvelopeFacts = {
      beforeCents: 1000, accountDailyTotalBeforeCents: null, clientDailyTotalBeforeCents: null,
      dailyCapCents: null, clientDailyCapCents: null, learningPhaseApplicable: true, learningStage: null,
      hoursSinceLastChange: null, adStudyCount: 0, hasRollbackHandler: true,
    }
    expect(isWithinHumanStopEnvelope('ads.cut_unit_budget', request, facts).within).toBe(true)
    const capability = createCutUnitBudgetCapability(db(2, 'auto_approve', 0.1))
    await expect(capability.steps.apply(cutStep(800))).rejects.toThrow(/10%/)
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('stops a queued increase when the prescription or the card switch changed', async () => {
    const capability = createScaleUnitBudgetCapability(db(3))
    const step: CapabilityStepContext = {
      ctx: { clientId: CLIENT } as CapabilityStepContext['ctx'],
      stepKey: 'apply', attempt: 1, idempotencyKey: 'card-scale', priorOutputs: {},
      runInput: {
        adset_id: 'adset-a', ad_account_id: 'act_1234567890', before_cents: 1000, after_cents: 1100,
        ...cardFields(lock),
      },
    }
    await expect(capability.steps.apply(step)).rejects.toThrow(/版本、目标或计划/)
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
    expect(setCampaignDailyBudget).not.toHaveBeenCalled()

    const off = createScaleUnitBudgetCapability(db(2, 'deny', 0.2))
    await expect(off.steps.apply(step)).rejects.toThrow(/关掉了/)
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('refuses to add budgets when the currency cannot be compared', async () => {
    const blocked = await budgetCardWriteBlock(db(2, 'deny', null), CLIENT, {
      ...cardFields(lock), before_cents: 1000,
    }, 1000, 900)
    expect(blocked).toMatch(/关掉了/)
    const chain = {
      select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
      then: (resolve: (value: unknown) => void) => resolve({
        data: [{ currency: 'nzd', captured_at: new Date().toISOString() }],
        error: null,
      }),
    }
    const sb = { from: () => chain } as unknown as SupabaseClient
    expect(await readAccountCurrency(sb, CLIENT, 'act_1234567890')).toBe('NZD')
    const stale = {
      select: () => stale, eq: () => stale, in: () => stale, order: () => stale, limit: () => stale,
      then: (resolve: (value: unknown) => void) => resolve({
        data: [{ currency: 'NZD', captured_at: '2020-01-01T00:00:00.000Z' }],
        error: null,
      }),
    }
    expect(await readAccountCurrency({ from: () => stale } as unknown as SupabaseClient, CLIENT, 'act_1')).toBeNull()
    const missing = {
      select: () => missing, eq: () => missing, in: () => missing, order: () => missing, limit: () => missing,
      then: (resolve: (value: unknown) => void) => resolve({ data: [{ currency: 'NZD' }], error: null }),
    }
    expect(await readAccountCurrency({ from: () => missing } as unknown as SupabaseClient, CLIENT, 'act_1')).toBeNull()
  })
})
