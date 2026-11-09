import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvelopeFacts, EnvelopeRequest } from '@/lib/kernel/autonomy-envelope'
import type { EnvelopeFactsResolver } from '@/lib/kernel/deps'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import { runAction } from '@/lib/kernel/runner'
import { CLIENT_A, GOAL_A, makeFixture, makeRegistry } from '@/lib/kernel/__tests__/fixtures'
import { getAdSetStatus, setAdSetDailyBudget } from '@/lib/meta/adsets'
import { approvalPlanHash } from '@/lib/approval-source/read'
import { type PrescriptionLock } from '@/lib/ads-budget-card/prescription-lock'
import { cardFields } from '@/lib/ads-budget-card/write-gate'
import { createCutUnitBudgetCapability } from '../cut-unit-budget'

vi.mock('@/lib/meta/adsets', () => ({ getAdSetStatus: vi.fn(), setAdSetDailyBudget: vi.fn() }))
vi.mock('../common', async () => {
  const actual = await vi.importActual<typeof import('../common')>('../common')
  return {
    ...actual,
    requireMetaToken: vi.fn(async () => 'test-token'),
    makeSnapshotPreStep: () => async () => ({ output: {} }),
  }
})

const PLAN_HASH = 'hash-plan'
const lock: PrescriptionLock = {
  prescriptionId: 'p1110000-0000-4000-8000-000000000001',
  version: 2,
  goalId: GOAL_A,
  planId: 'plan-1',
  planHash: approvalPlanHash('plan-1', PLAN_HASH),
  approvedOn: '2026-11-02',
}
const facts: EnvelopeFacts = {
  beforeCents: 1000, accountDailyTotalBeforeCents: null, clientDailyTotalBeforeCents: null,
  dailyCapCents: null, clientDailyCapCents: null, learningPhaseApplicable: true, learningStage: null,
  hoursSinceLastChange: null, adStudyCount: 0, hasRollbackHandler: true,
}
const request: EnvelopeRequest = { kind: 'budget_change', afterCents: 800 }

function harness() {
  const definition = ACTION_REGISTRY.get('ads.cut_unit_budget')
  if (!definition) throw new Error('missing cut definition')
  const resolver: EnvelopeFactsResolver = async () => ({ request, facts })
  return makeFixture({
    registry: makeRegistry([definition]),
    capabilities: (sb) => ({ 'ads.cut_unit_budget': createCutUnitBudgetCapability(sb) }),
    options: {
      policy: { action_key: 'ads.cut_unit_budget', mode: 'auto_approve' },
      resolveEnvelopeFacts: resolver,
      extraTables: {
        prescriptions: [{
          id: lock.prescriptionId, client_id: CLIENT_A, status: 'approved', version: 2, goal_id: GOAL_A,
          approved_at: '2026-11-02T00:00:00.000Z', content: {},
          generation_meta: {},
        }],
        goals: [{ id: GOAL_A, client_id: CLIENT_A, title: '三个月内自然流量翻倍', status: 'active' }],
        marketing_plans: [{
          id: 'plan-1', client_id: CLIENT_A, status: 'approved', plan_data: {},
          generation_meta: {
            from_prescription: { prescription_id: lock.prescriptionId, version: 2 },
            blank_draft: { goal_id: GOAL_A },
            approval_receipt: { content_hash: PLAN_HASH },
          },
        }],
      },
    },
  })
}

describe('budget card read-back uses the real cut rollback path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setAdSetDailyBudget).mockResolvedValue(true)
    vi.mocked(getAdSetStatus).mockResolvedValueOnce({
      id: 'adset-a', name: 'test', status: 'ACTIVE', daily_budget: '1000',
    }).mockResolvedValue({
      id: 'adset-a', name: 'test', status: 'ACTIVE', daily_budget: '900',
    })
  })

  it('does not write the old budget back when the card read-back mismatches', async () => {
    const f = harness()
    const outcome = await runAction(f.kernel, {
      clientId: CLIENT_A, goalId: GOAL_A, purpose: 'growth', actionKey: 'ads.cut_unit_budget',
      triggeredBy: 'human', triggeredByRef: 'user-from-session',
      evidence: { source: 'budget_step_card' },
      input: {
        cycle_date: '2026-11-02', ad_account_id: '123', adset_id: 'adset-a',
        before_cents: 1000, after_cents: 800, ...cardFields(lock),
      },
    })
    expect(outcome.kind, outcome.run.last_error ?? '').toBe('dead_letter')
    expect(outcome.run.needs_human).toBe(true)
    expect(outcome.run.last_error).toMatch(/没有把旧预算写回去/)
    expect(outcome.run.last_error).not.toMatch(/已按 provider-native rollback 撤回/)
    expect(setAdSetDailyBudget).toHaveBeenCalledTimes(1)
    expect(setAdSetDailyBudget).toHaveBeenCalledWith('adset-a', 'test-token', 800)
  })

  it('still rolls a non-card cut back through the provider handler', async () => {
    const f = harness()
    const outcome = await runAction(f.kernel, {
      clientId: CLIENT_A, goalId: GOAL_A, purpose: 'growth', actionKey: 'ads.cut_unit_budget',
      triggeredBy: 'human', triggeredByRef: 'user-from-session',
      input: { cycle_date: '2026-11-02', ad_account_id: '123', adset_id: 'adset-a', after_cents: 800 },
    })
    expect(outcome.kind, outcome.run.last_error ?? '').toBe('dead_letter')
    expect(setAdSetDailyBudget).toHaveBeenNthCalledWith(1, 'adset-a', 'test-token', 800)
    expect(setAdSetDailyBudget).toHaveBeenNthCalledWith(2, 'adset-a', 'test-token', 1000)
    expect(outcome.run.last_error).toMatch(/撤回/)
  })
})
