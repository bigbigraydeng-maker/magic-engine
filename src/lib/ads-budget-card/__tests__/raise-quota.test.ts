import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type Row } from '@/lib/kernel/__tests__/fake-supabase'
import { createScaleUnitBudgetCapability } from '@/lib/capabilities/ads/scale-unit-budget'
import type { CapabilityStepContext } from '@/lib/kernel/types'
import { getAdSetStatus, setAdSetDailyBudget } from '@/lib/meta/adsets'
import { planHashOf, type PrescriptionLock } from '../prescription-lock'
import { raiseQuotaBlock, type RaiseQuotaFacts } from '../raise-quota'
import { cardFields } from '../write-gate'

vi.mock('@/lib/meta/adsets', () => ({ getAdSetStatus: vi.fn(), setAdSetDailyBudget: vi.fn() }))
vi.mock('@/lib/meta/campaign-management', () => ({ getCampaignDetails: vi.fn() }))
vi.mock('@/lib/meta/campaign-writes', () => ({ setCampaignDailyBudget: vi.fn() }))
vi.mock('@/lib/meta/ad-account-binding', () => ({
  canonicalAccountDigits: (id: string) => id.replace(/^act_/, ''),
  findOtherClientRegistrations: vi.fn(async () => []),
}))
vi.mock('@/lib/meta/campaign-ownership', () => ({
  getRegisteredAccountIds: vi.fn(async () => ({ ids: ['act_1'], error: null })),
}))
vi.mock('@/lib/capabilities/ads/common', () => ({
  makeSnapshotPreStep: vi.fn(() => vi.fn()),
  makeReadbackVerification: vi.fn(),
  requireMetaToken: vi.fn(async () => 'test-token'),
}))

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const GOAL = '90a10000-0000-4000-8000-00000000000a'
const ACCOUNT = 'act_1'
const NOW = new Date()
const FRESH = new Date(NOW.getTime() - 60_000).toISOString()
const STALE = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
const SEED = { schema_version: 1 }
const lock: PrescriptionLock = {
  prescriptionId: 'p1110000-0000-4000-8000-000000000001',
  version: 2,
  goalId: GOAL,
  planId: 'plan-1',
  planHash: planHashOf('plan-1', SEED),
  approvedOn: '2026-11-02',
}

function facts(over: Partial<RaiseQuotaFacts> = {}): RaiseQuotaFacts {
  return {
    accountLiveCents: 1200,
    accountCapCents: 1400,
    clientLiveCents: 1200,
    clientCapCents: 1400,
    siblingAccountCents: 0,
    siblingClientCents: 0,
    ...over,
  }
}

function snap(level: string, entity: string, budget: number | null, over: Row = {}): Row {
  return {
    id: `${ACCOUNT}:${level}:${entity}`,
    client_id: CLIENT,
    ad_account_id: ACCOUNT,
    shared_account: false,
    level,
    entity_id: entity,
    adset_id: level === 'adset' ? entity : null,
    campaign_id: level === 'adset' ? 'cmp-1' : null,
    budget_level: level === 'adset' ? 'abo' : level === 'campaign' ? 'abo' : null,
    daily_budget_minor: budget,
    currency: 'NZD',
    effective_status: level === 'adset' ? 'ACTIVE' : 'PAUSED',
    capture_reason: 'kernel_pre',
    captured_at: FRESH,
    ...over,
  }
}

function captures(at = FRESH): Row[] {
  return ['account', 'campaign', 'adset'].map((level) => ({
    client_id: CLIENT,
    ad_account_id: ACCOUNT,
    level,
    captured_at: at,
    capture_reason: 'kernel_pre',
    complete: true,
    skipped_shared: false,
  }))
}

function baseRows(): Row[] {
  return [
    snap('account', ACCOUNT, null),
    snap('campaign', 'cmp-1', null),
    snap('adset', 'as-1', 1000),
    snap('adset', 'as-2', 200),
  ]
}

function db(over: {
  snaps?: Row[]
  captures?: Row[]
  accounts?: Row[]
  runs?: Row[]
  clientCap?: number | null
} = {}) {
  return createFakeSupabase({
    prescriptions: [{
      id: lock.prescriptionId,
      client_id: CLIENT,
      status: 'approved',
      version: 2,
      goal_id: GOAL,
      approved_at: '2026-11-02T00:00:00.000Z',
      content: { plan_seed: SEED },
      generation_meta: { plan_draft: { status: 'created', plan_id: 'plan-1' } },
    }],
    client_automation_policies: [{
      id: 'policy-card',
      client_id: CLIENT,
      action_key: 'ads.adjust_adset_daily_budget',
      mode: 'auto_approve',
      metadata: { max_budget_step_ratio: 0.2 },
      effective_from: '2020-01-01T00:00:00.000Z',
      effective_to: null,
    }],
    ad_strategy_configs: [{ client_id: CLIENT, daily_budget_cap_cents: over.clientCap === undefined ? 1400 : over.clientCap }],
    client_meta_ad_accounts: over.accounts ?? [
      { client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 1400 },
    ],
    ad_snapshot_captures: over.captures ?? captures(),
    ad_entity_snapshots: over.snaps ?? baseRows(),
    action_runs: over.runs ?? [],
  })
}

function raiseStep(runId = 'run-self'): CapabilityStepContext {
  return {
    ctx: { clientId: CLIENT, runId } as CapabilityStepContext['ctx'],
    stepKey: 'apply',
    attempt: 1,
    idempotencyKey: 'card-scale',
    priorOutputs: { snapshot_pre: { snapshotted_at: FRESH } },
    runInput: {
      adset_id: 'as-1',
      ad_account_id: ACCOUNT,
      before_cents: 1000,
      after_cents: 1100,
      ...cardFields(lock),
    },
  }
}

function sibling(id: string, adset: string, before: number, after: number, status = 'running'): Row {
  return {
    id,
    client_id: CLIENT,
    action_key: 'ads.scale_unit_budget',
    status,
    updated_at: FRESH,
    input: { ad_account_id: ACCOUNT, adset_id: adset, before_cents: before, after_cents: after },
  }
}

describe('raise quota before the provider write', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setAdSetDailyBudget).mockResolvedValue(true)
    vi.mocked(getAdSetStatus).mockResolvedValue({
      id: 'as-1', name: 'test', status: 'ACTIVE', account_id: ACCOUNT, daily_budget: '1000',
    })
  })

  it('counts two open raises together and refuses the one that would pass the cap', () => {
    expect(raiseQuotaBlock(1000, 1100, facts())).toBeNull()
    expect(raiseQuotaBlock(1000, 1100, facts({ siblingAccountCents: 200, siblingClientCents: 200 }))).toMatch(/这个广告账户的每日上限/)
    expect(raiseQuotaBlock(1000, 1100, facts({
      accountCapCents: 2000,
      clientLiveCents: 1200,
      siblingClientCents: 200,
    }))).toMatch(/加在一起/)
    expect(raiseQuotaBlock(1000, 800, facts({ accountLiveCents: 2000, clientLiveCents: 2000 }))).toBeNull()
  })

  it('does not write when another running raise on the same customer uses the remaining room', async () => {
    const capability = createScaleUnitBudgetCapability(db({ runs: [sibling('run-other', 'as-2', 200, 400)] }))
    await expect(capability.steps.apply(raiseStep())).rejects.toThrow(/这个广告账户的每日上限/)
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('still writes one raise that fits, and does not count its own run', async () => {
    const capability = createScaleUnitBudgetCapability(db({
      runs: [sibling('run-self', 'as-9', 100, 900)],
    }))
    await capability.steps.apply(raiseStep())
    expect(setAdSetDailyBudget).toHaveBeenCalledTimes(1)
  })

  it('refuses a queued raise when the cross-account snapshot is already past the freshness window', async () => {
    const capability = createScaleUnitBudgetCapability(db({
      snaps: baseRows().map((row) => row.entity_id === 'as-2' ? { ...row, captured_at: STALE } : row),
    }))
    await expect(capability.steps.apply(raiseStep())).rejects.toThrow(/先刷新再改/)
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('refuses a raise when the account currency is missing or the currencies differ', async () => {
    const missing = createScaleUnitBudgetCapability(db({
      snaps: baseRows().map((row) => row.level === 'account' ? { ...row, currency: null } : row),
    }))
    await expect(missing.steps.apply(raiseStep())).rejects.toThrow(/币种/)
    const aud = (level: string, entity: string, budget: number | null): Row => ({
      ...snap(level, entity, budget),
      id: `act_2:${level}:${entity}`,
      ad_account_id: 'act_2',
      currency: 'AUD',
      campaign_id: level === 'adset' ? 'cmp-2' : null,
    })
    const mixed = createScaleUnitBudgetCapability(db({
      clientCap: 2800,
      snaps: [...baseRows(), aud('account', 'act_2', null), aud('campaign', 'cmp-2', null), aud('adset', 'as-9', 200)],
      accounts: [
        { client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 1400 },
        { client_id: CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: 1400 },
      ],
      captures: [
        ...captures(),
        ...['account', 'campaign', 'adset'].map((level) => ({
          client_id: CLIENT, ad_account_id: 'act_2', level, captured_at: FRESH,
          capture_reason: 'kernel_pre', complete: true, skipped_shared: false,
        })),
      ],
    }))
    await expect(mixed.steps.apply(raiseStep())).rejects.toThrow(/币种/)
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })

  it('refuses a raise when an account cap is missing', async () => {
    const capability = createScaleUnitBudgetCapability(db({
      clientCap: 2800,
      accounts: [
        { client_id: CLIENT, ad_account_id: ACCOUNT, daily_budget_cap_cents: 1400 },
        { client_id: CLIENT, ad_account_id: 'act_2', daily_budget_cap_cents: null },
      ],
    }))
    await expect(capability.steps.apply(raiseStep())).rejects.toThrow(/上限/)
    expect(setAdSetDailyBudget).not.toHaveBeenCalled()
  })
})
