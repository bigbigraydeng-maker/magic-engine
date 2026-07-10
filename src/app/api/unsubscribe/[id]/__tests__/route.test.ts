/**
 * POST /api/unsubscribe/[id] — unit tests (Phase 35 one-click opt-out)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Captured update payload so we can assert the terminal-status flip.
let updatePayload: Record<string, unknown> | null = null
let prospectRow: { business_name: string; status: string; ai_report: unknown } | null
let readError: { message: string } | null = null
let writeError: { message: string } | null = null

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: prospectRow, error: readError }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updatePayload = payload
        return { eq: () => Promise.resolve({ error: writeError }) }
      },
    }),
  },
}))

import { POST } from '../route'

const VALID_ID = '11111111-2222-3333-4444-555555555555'
const call = (id: string) =>
  POST({} as never, { params: { id } })

beforeEach(() => {
  updatePayload = null
  prospectRow = { business_name: 'Oz Flooring Co', status: 'contacted', ai_report: { foo: 1 } }
  readError = null
  writeError = null
})

describe('POST /api/unsubscribe/[id]', () => {
  it('rejects a non-UUID id with 404 and never touches the DB', async () => {
    const res = await call('not-a-uuid')
    expect(res.status).toBe(404)
    expect(updatePayload).toBeNull()
  })

  it('404s an unknown prospect', async () => {
    prospectRow = null
    const res = await call(VALID_ID)
    expect(res.status).toBe(404)
    expect(updatePayload).toBeNull()
  })

  it('flips an active prospect to the terminal opted_out status', async () => {
    const res = await call(VALID_ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, business_name: 'Oz Flooring Co' })
    expect(updatePayload?.status).toBe('opted_out')
  })

  it('records when and how the opt-out happened, preserving existing ai_report', async () => {
    await call(VALID_ID)
    const report = updatePayload?.ai_report as { foo?: number; opt_out?: { via?: string; at?: string } }
    expect(report.foo).toBe(1)                     // existing analysis preserved
    expect(report.opt_out?.via).toBe('unsubscribe_link')
    expect(typeof report.opt_out?.at).toBe('string')
  })

  it('preserves a converted (paying-client) status but still records the opt-out request', async () => {
    prospectRow = { business_name: 'Oz Flooring Co', status: 'converted', ai_report: { foo: 1 } }
    const res = await call(VALID_ID)
    expect(res.status).toBe(200)
    expect(updatePayload?.status).toBe('converted')          // business marker NOT destroyed
    const report = updatePayload?.ai_report as { opt_out?: { via?: string } }
    expect(report.opt_out?.via).toBe('unsubscribe_link')     // request still honoured/recorded
  })

  it('preserves an archived status rather than flipping it to opted_out', async () => {
    prospectRow = { business_name: 'Oz Flooring Co', status: 'archived', ai_report: null }
    await call(VALID_ID)
    expect(updatePayload?.status).toBe('archived')
  })

  it('surfaces a DB write error as 500', async () => {
    writeError = { message: 'write boom' }
    const res = await call(VALID_ID)
    expect(res.status).toBe(500)
  })

  it('is idempotent — an already-opted-out prospect returns ok without re-writing', async () => {
    prospectRow = { business_name: 'Oz Flooring Co', status: 'opted_out', ai_report: null }
    const res = await call(VALID_ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
    expect(updatePayload).toBeNull()               // no second write
  })

  it('surfaces a DB read error as 500', async () => {
    readError = { message: 'boom' }
    const res = await call(VALID_ID)
    expect(res.status).toBe(500)
  })
})
