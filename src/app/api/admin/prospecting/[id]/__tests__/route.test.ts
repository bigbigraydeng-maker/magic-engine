/**
 * PATCH /api/admin/prospecting/[id] { action: 'send' } — Resend send path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

let selectRow: Record<string, unknown> | null
let claimRows: Array<{ id: string }> | null
const updates: Array<Record<string, unknown>> = []
// Per-update list of the [col, val] pairs passed to .eq() — lets us assert the
// claim actually carries the status guard, so mutating it fails the test (魏征 C2).
const updateEqArgs: Array<Array<[string, unknown]>> = []
const sendMock = vi.fn()

vi.mock('@/lib/auth/require-admin', () => ({ guardAdmin: vi.fn().mockResolvedValue(null) }))

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: (...a: unknown[]) => sendMock(...a) } })),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: selectRow, error: null }) }) }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload)
        const eqPairs: Array<[string, unknown]> = []
        updateEqArgs.push(eqPairs)
        const node = {
          eq: (col: string, val: unknown) => { eqPairs.push([col, val]); return node },
          select: () => Promise.resolve({ data: claimRows, error: null }),
          then: (resolve: (v: { error: null }) => unknown) => resolve({ error: null }),
        }
        return node
      },
    }),
  },
}))

import { PATCH } from '../route'

const ID = '11111111-2222-3333-4444-555555555555'
const send = () =>
  PATCH({ json: () => Promise.resolve({ action: 'send' }) } as never, { params: { id: ID } })

beforeEach(() => {
  updates.length = 0
  updateEqArgs.length = 0
  sendMock.mockReset().mockResolvedValue({ error: null })
  process.env.RESEND_API_KEY = 'test-key'
  process.env.OUTREACH_FROM_EMAIL = 'hello@magicengine.cloud'
  selectRow = {
    business_name: 'Oz Flooring Co',
    status: 'outreach_ready',
    audit: { tracking: { emails: ['owner@ozflooring.co.nz'] } },
    outreach_email: { subject: 'A quick look', body: 'Hi there, this is a real draft body over forty chars long.' },
  }
  claimRows = [{ id: ID }]
})

describe("PATCH { action: 'send' }", () => {
  it('sends via Resend and claims the row to contacted', async () => {
    const res = await send()
    expect(res.status).toBe(200)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const arg = sendMock.mock.calls[0][0] as { to: string; from: string; subject: string; text: string }
    expect(arg.to).toBe('owner@ozflooring.co.nz')
    expect(arg.from).toContain('Big Ray Deng')
    expect(arg.text).toContain('/unsubscribe/')          // compliance footer present
    expect(arg.text).toContain('/report/')               // report link present
    expect(updates[0].status).toBe('contacted')          // claimed before send
    // The claim MUST be guarded on the current outreach_ready status — this is
    // the anti-double-send lock; mutating the guard must fail this test.
    expect(updateEqArgs[0]).toContainEqual(['status', 'outreach_ready'])
    expect(updateEqArgs[0]).toContainEqual(['id', ID])
    // Stable idempotency key so an ambiguous-failure retry can't double-send.
    expect(sendMock.mock.calls[0][1]).toEqual({ idempotencyKey: `outreach/${ID}` })
  })

  it('503s when RESEND_API_KEY is missing — never claims', async () => {
    delete process.env.RESEND_API_KEY
    const res = await send()
    expect(res.status).toBe(503)
    expect(updates).toHaveLength(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('400s a prospect with no email — never sends', async () => {
    selectRow!.audit = { tracking: { emails: [] } }
    const res = await send()
    expect(res.status).toBe(400)
    expect(sendMock).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('409s when the prospect is not outreach_ready', async () => {
    selectRow!.status = 'contacted'
    const res = await send()
    expect(res.status).toBe(409)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('409s (no double-send) when the claim matches zero rows', async () => {
    claimRows = []
    const res = await send()
    expect(res.status).toBe(409)
    expect(sendMock).not.toHaveBeenCalled()       // claim lost the race → never send
  })

  it('502s and reverts the claim when Resend fails', async () => {
    sendMock.mockResolvedValue({ error: { message: 'domain not verified' } })
    const res = await send()
    expect(res.status).toBe(502)
    // First update claims (contacted); second reverts (outreach_ready).
    expect(updates[0].status).toBe('contacted')
    expect(updates[1].status).toBe('outreach_ready')
    expect(updates[1].contacted_at).toBeNull()
  })
})
