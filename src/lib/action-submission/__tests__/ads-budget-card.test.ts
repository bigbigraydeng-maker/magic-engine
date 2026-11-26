import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { runAction } from '@/lib/kernel/runner'
import { executeOnKernel } from '@/lib/ads-budget-card/kernel-path'
import { planHashOf, type PrescriptionLock } from '@/lib/ads-budget-card/prescription-lock'
import type { BudgetExecuteCall } from '@/lib/ads-budget-card/path'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/kernel/runner', () => ({ runAction: vi.fn() }))

const lock: PrescriptionLock = {
  prescriptionId: 'p1110000-0000-4000-8000-000000000001',
  version: 2,
  goalId: '90a10000-0000-4000-8000-00000000000a',
  planId: 'plan-1',
  planHash: planHashOf('plan-1', { schema_version: 1 }),
  approvedOn: '2026-11-02',
}

function call(raising: boolean): BudgetExecuteCall {
  return {
    clientId: 'c11e0000-0000-4000-8000-00000000000a',
    goalId: lock.goalId,
    cycleDate: lock.approvedOn,
    adAccountId: 'act_1',
    adsetId: '1',
    beforeCents: 100,
    afterCents: raising ? 110 : 80,
    nonce: 'nonce-1',
    raising,
    idempotencyKey: 'ads.cut_unit_budget:test',
    lock,
  }
}

describe('budget card human trigger', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the confirming session user as the human ref', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({
      ok: true, user: { id: 'user-from-session' },
    } as never)
    vi.mocked(runAction).mockResolvedValue({
      kind: 'pending_approval', run: { id: 'run-1' }, decision: null, execution: null, humanReason: null,
    } as never)
    await executeOnKernel({} as never, call(false))
    expect(requirePaidClientAccess).toHaveBeenCalledWith(call(false).clientId)
    expect(runAction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      triggeredBy: 'human',
      triggeredByRef: 'user-from-session',
      actionKey: 'ads.cut_unit_budget',
      evidence: expect.objectContaining({ source: 'budget_step_card' }),
      input: expect.objectContaining({ before_cents: 100, card_prescription_id: lock.prescriptionId }),
    }), {})
  })

  it('does not submit a raise without that session, and a raise still waits for approval', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 401 } as never)
    const refused = await executeOnKernel({} as never, call(true))
    expect(refused.kind).toBe('refused')
    expect(runAction).not.toHaveBeenCalled()

    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: true, user: { id: 'user-from-session' } } as never)
    vi.mocked(runAction).mockResolvedValue({
      kind: 'pending_approval', run: { id: 'run-2' }, decision: null, execution: null, humanReason: null,
    } as never)
    await executeOnKernel({} as never, call(true))
    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionKey: 'ads.scale_unit_budget', triggeredByRef: 'user-from-session' }),
      { requireHumanApproval: true },
    )
  })
})
