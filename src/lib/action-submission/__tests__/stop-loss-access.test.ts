/** requireStopLossAccess is the internal-only gate: it must delegate to requirePlanApproverAccess. */
import { describe, it, expect, vi } from 'vitest'

const m = vi.hoisted(() => ({ approver: vi.fn(), paid: vi.fn() }))

vi.mock('@/lib/auth/client-access', () => ({
  requirePlanApproverAccess: m.approver,
  requirePaidClientAccess: m.paid,
}))
vi.mock('@/lib/kernel/runner', () => ({ runAction: vi.fn() }))

import { requireStopLossAccess } from '../stop-loss'

describe('requireStopLossAccess', () => {
  it('uses the plan-approver gate, not the paid-client gate', async () => {
    const denied = { ok: false, status: 403, error: 'x', reason: 'approver_only' }
    m.approver.mockResolvedValue(denied)
    await expect(requireStopLossAccess('client-1')).resolves.toEqual(denied)
    expect(m.approver).toHaveBeenCalledWith('client-1')
    expect(m.paid).not.toHaveBeenCalled()
  })
})
