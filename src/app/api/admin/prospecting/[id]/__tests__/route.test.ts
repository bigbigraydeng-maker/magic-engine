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

const buildKeywordReportMock = vi.fn()
vi.mock('@/lib/prospecting/keyword-report', () => ({
  buildKeywordReport: (...a: unknown[]) => buildKeywordReportMock(...a),
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
          // transition() guards on `.in('status', [...])`; capture it like eq so
          // a test can assert which from-statuses the transition allows.
          in: (col: string, val: unknown) => { eqPairs.push([col, val]); return node },
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
  buildKeywordReportMock.mockReset().mockResolvedValue([])
  process.env.RESEND_API_KEY = 'test-key'
  process.env.OUTREACH_FROM_EMAIL = 'hello@magicengine.cloud'
  selectRow = {
    business_name: 'Oz Flooring Co',
    status: 'outreach_ready',
    domain: 'ozflooring.co.nz',
    country: 'NZ',
    updated_at: 't0',
    ai_report: { segment: 'core_target', top_problems: [] },
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

  it('422s a placeholder/service email (mysite.com) — never sends or claims', async () => {
    selectRow!.audit = { tracking: { emails: ['info@mysite.com'] } }
    const res = await send()
    expect(res.status).toBe(422)
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

const startOnboarding = () =>
  PATCH({ json: () => Promise.resolve({ action: 'start_onboarding' }) } as never, { params: { id: ID } })

describe("PATCH { action: 'start_onboarding' }", () => {
  it('moves a paid reply to onboarding, guarded on replied/contacted only', async () => {
    claimRows = [{ id: ID }]
    const res = await startOnboarding()
    expect(res.status).toBe(200)
    expect(updates[0].status).toBe('onboarding')
    // The from-status guard: onboarding must only be reachable from a warm
    // reply/contact — mutating this list (e.g. allowing 'discovered') breaks it.
    expect(updateEqArgs[0]).toContainEqual(['status', ['replied', 'contacted']])
    expect(updateEqArgs[0]).toContainEqual(['id', ID])
  })

  it('409s when the row is not in a warm state (claim matches zero rows)', async () => {
    claimRows = []
    const res = await startOnboarding()
    expect(res.status).toBe(409)
  })
})

const markConverted = () =>
  PATCH({ json: () => Promise.resolve({ action: 'mark_converted' }) } as never, { params: { id: ID } })

describe("PATCH { action: 'mark_converted' }", () => {
  it('moves onboarding → converted, guarded on onboarding only', async () => {
    claimRows = [{ id: ID }]
    const res = await markConverted()
    expect(res.status).toBe(200)
    expect(updates[0].status).toBe('converted')
    // Forward exit is reachable ONLY from onboarding — the funnel endpoint.
    expect(updateEqArgs[0]).toContainEqual(['status', ['onboarding']])
  })

  it('409s when the row is not in onboarding', async () => {
    claimRows = []
    const res = await markConverted()
    expect(res.status).toBe(409)
  })
})

const genKeywords = () =>
  PATCH({ json: () => Promise.resolve({ action: 'generate_keyword_report' }) } as never, { params: { id: ID } })

describe("PATCH { action: 'generate_keyword_report' }", () => {
  beforeEach(() => { selectRow!.status = 'onboarding' })  // delivery-stage only

  it('stores the report on ai_report.keyword_report when data comes back', async () => {
    buildKeywordReportMock.mockResolvedValue([{ phrase: 'kitchen reno', volume: 800, difficulty: 'easy' }])
    const res = await genKeywords()
    expect(res.status).toBe(200)
    expect(buildKeywordReportMock).toHaveBeenCalledWith('ozflooring.co.nz', 'NZ')
    // Merged into the existing ai_report, not overwriting it.
    const written = updates[0].ai_report as { segment: string; keyword_report: unknown[] }
    expect(written.segment).toBe('core_target')
    expect(written.keyword_report).toHaveLength(1)
    // Optimistic lock: the write is guarded on the read updated_at.
    expect(updateEqArgs[0]).toContainEqual(['updated_at', 't0'])
  })

  it('degrades to count:0 without writing when the data source is empty', async () => {
    buildKeywordReportMock.mockResolvedValue([])
    const res = await genKeywords()
    expect(res.status).toBe(200)
    const body = await res.json() as { count: number }
    expect(body.count).toBe(0)
    expect(updates).toHaveLength(0)          // nothing persisted on empty
  })

  it('409s when the prospect is not in onboarding (cost gate) — never calls DataForSEO', async () => {
    selectRow!.status = 'replied'
    const res = await genKeywords()
    expect(res.status).toBe(409)
    expect(buildKeywordReportMock).not.toHaveBeenCalled()
  })

  it('409s a prospect with no AI analysis yet', async () => {
    selectRow!.ai_report = null
    const res = await genKeywords()
    expect(res.status).toBe(409)
    expect(buildKeywordReportMock).not.toHaveBeenCalled()
  })

  it('409s on an optimistic-lock conflict (row changed mid-fetch)', async () => {
    buildKeywordReportMock.mockResolvedValue([{ phrase: 'kitchen reno', volume: 800, difficulty: 'easy' }])
    claimRows = []                            // update matched zero rows
    const res = await genKeywords()
    expect(res.status).toBe(409)
  })
})
