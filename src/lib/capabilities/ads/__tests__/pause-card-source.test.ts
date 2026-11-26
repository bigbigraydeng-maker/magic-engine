import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/kernel/__tests__/fake-supabase'
import { approvalCardFields, approvalPlanHash, type ApprovalSource } from '@/lib/approval-source/read'
import { setAdSetStatus } from '@/lib/meta/adsets'
import { createPauseUnitCapability } from '@/lib/capabilities/ads/pause-unit'
import type { CapabilityStepContext } from '@/lib/kernel/types'

vi.mock('@/lib/meta/adsets', () => ({ getAdSetStatus: vi.fn(), setAdSetStatus: vi.fn() }))
vi.mock('@/lib/capabilities/ads/common', () => ({
  makeSnapshotPreStep: vi.fn(() => vi.fn()),
  makeReadbackVerification: vi.fn(),
  requireMetaToken: vi.fn(async () => 'test-token'),
}))

const CLIENT = 'client-1'
const source: ApprovalSource = {
  prescriptionId: 'rx-1',
  version: 2,
  goalId: 'goal-1',
  planId: 'plan-1',
  planHash: approvalPlanHash('plan-1', 'hash-1'),
  approvedOn: '2026-11-08',
}

function step(): CapabilityStepContext {
  return {
    ctx: { clientId: CLIENT } as CapabilityStepContext['ctx'],
    stepKey: 'apply',
    attempt: 1,
    idempotencyKey: 'pause-1',
    priorOutputs: {},
    runInput: { cycle_date: '2026-11-08', ad_account_id: 'acct-a', adset_id: 'set-a', ...approvalCardFields(source) },
  }
}

describe('pause card source at the provider write', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not write when the approved plan no longer matches the card', async () => {
    const sb = createFakeSupabase({
      prescriptions: [{
        id: 'rx-1', client_id: CLIENT, status: 'approved', version: 3, goal_id: 'goal-1',
        approved_at: '2026-11-08T00:00:00.000Z', generation_meta: {},
      }],
      goals: [{ id: 'goal-1', client_id: CLIENT, status: 'active' }],
      marketing_plans: [{
        id: 'plan-1', client_id: CLIENT, status: 'approved', plan_data: {},
        generation_meta: {
          from_prescription: { prescription_id: 'rx-1', version: 3 },
          blank_draft: { goal_id: 'goal-1' },
          approval_receipt: { content_hash: 'hash-1' },
        },
      }],
    })
    const capability = createPauseUnitCapability(sb)
    await expect(capability.steps.apply(step())).rejects.toThrow(/版本、目标或计划/)
    expect(setAdSetStatus).not.toHaveBeenCalled()
  })
})
