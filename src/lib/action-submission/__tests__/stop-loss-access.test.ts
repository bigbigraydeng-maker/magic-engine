/** requireStopLossAccess is the internal-only gate: paid-client check first, then global admin. */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ paid: vi.fn(), admin: vi.fn() }))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.paid }))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: m.admin }))
vi.mock('@/lib/kernel/runner', () => ({ runAction: vi.fn() }))

import { requireStopLossAccess } from '../stop-loss'

describe('requireStopLossAccess', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the paid-client failure without checking admin', async () => {
    const denied = { ok: false, status: 402, error: 'x', reason: 'paid_only' }
    m.paid.mockResolvedValue(denied)
    await expect(requireStopLossAccess('client-1')).resolves.toEqual(denied)
    expect(m.admin).not.toHaveBeenCalled()
  })

  it('rejects a paid non-admin with 403 approver_only', async () => {
    m.paid.mockResolvedValue({ ok: true, tier: 'paid_client' })
    m.admin.mockResolvedValue({ ok: false })
    await expect(requireStopLossAccess('client-1')).resolves.toMatchObject({ ok: false, status: 403, reason: 'approver_only' })
  })

  it('passes the paid result through for an internal admin', async () => {
    const paid = { ok: true, tier: 'admin' }
    m.paid.mockResolvedValue(paid)
    m.admin.mockResolvedValue({ ok: true })
    await expect(requireStopLossAccess('client-1')).resolves.toEqual(paid)
  })
})
