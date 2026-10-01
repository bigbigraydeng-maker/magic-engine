import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KernelDeps } from '@/lib/kernel/deps'
import { getDecision, getRun } from '@/lib/kernel/store'
import { runAction } from '@/lib/kernel/runner'
import {
  runApprovedAdsO1BudgetScale,
  submitAdsO1BudgetScale,
} from '../ads-o1-budget-scale'

vi.mock('@/lib/kernel/runner', () => ({ runAction: vi.fn() }))
vi.mock('@/lib/kernel/store', () => ({ getDecision: vi.fn(), getRun: vi.fn() }))

const clientId = '11111111-2222-4333-8444-555555555555'
const runId = '22222222-2222-4333-8444-555555555555'
const decisionId = '33333333-2222-4333-8444-555555555555'
const deps = { supabase: {} } as KernelDeps

describe('O1 budget-scale action submission', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forces the request to remain pending for an explicit human approval', async () => {
    vi.mocked(runAction).mockResolvedValue({
      kind: 'pending_approval',
      run: { id: runId, status: 'pending_approval' } as never,
      decision: null, execution: null, humanReason: null,
    })
    const access = { user: { id: 'actor-1' } } as never

    await submitAdsO1BudgetScale(deps, {
      clientId, access, goalId: 'goal-1', cycleDate: '2026-10-01', adAccountId: 'act-1',
      adsetId: 'set-1', beforeCents: 1_000, afterCents: 1_200, evidence: { date: '2026-10-01' },
    })

    expect(runAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actionKey: 'ads.scale_unit_budget',
      input: { cycle_date: '2026-10-01', ad_account_id: 'act-1', adset_id: 'set-1', before_cents: 1_000, after_cents: 1_200 },
    }), { requireHumanApproval: true })
  })

  it('series-budget proposal keeps the O1 source adset and pins the actual CBO target', async () => {
    vi.mocked(runAction).mockResolvedValue({
      kind: 'pending_approval', run: { id: runId, status: 'pending_approval' } as never,
      decision: null, execution: null, humanReason: null,
    })
    await submitAdsO1BudgetScale(deps, {
      clientId, access: { user: { id: 'actor-1' } } as never, goalId: 'goal-1', cycleDate: '2026-10-01',
      adAccountId: 'act-1', adsetId: 'set-1', campaignId: 'campaign-1', beforeCents: 5_000, afterCents: 6_000,
      evidence: { date: '2026-10-01', target_level: 'campaign' },
    })
    expect(runAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      input: expect.objectContaining({ campaign_id: 'campaign-1', adset_id: 'set-1', before_cents: 5_000, after_cents: 6_000 }),
      evidence: expect.objectContaining({ current_daily_budget_cents: 5_000, proposed_daily_budget_cents: 6_000, target_level: 'campaign' }),
    }), { requireHumanApproval: true })
  })

  it('worker refuses a run without a matching human allow decision', async () => {
    vi.mocked(getRun).mockResolvedValue({
      id: runId, client_id: clientId, action_key: 'ads.scale_unit_budget', status: 'authorized',
      authorization_decision_id: decisionId,
    } as never)
    vi.mocked(getDecision).mockResolvedValue({
      id: decisionId, action_run_id: runId, client_id: clientId, verdict: 'allow', decided_by: 'policy',
    } as never)

    await expect(runApprovedAdsO1BudgetScale(deps, clientId, runId)).rejects.toThrow('no matching human approval')
    expect(runAction).not.toHaveBeenCalled()
  })
})
