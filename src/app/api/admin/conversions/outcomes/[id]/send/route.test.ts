/**
 * POST /outcomes/[id]/send — a resolved send must name one event.
 * An unnamed call still retries the whole outcome, which is the manual retry button.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: vi.fn(async () => null),
}))
vi.mock('@/lib/conversions/route-guard', () => ({
  guardConversionRoute: vi.fn(async () => ({
    ok: true,
    ctx: { actor: 'fde@example.com', ip: null, ua: null, requestId: 'req-1' },
  })),
}))
vi.mock('@/lib/conversions/writeback-service', () => ({
  sendApprovedOutcome: vi.fn(async () => ({
    status: 'confirmed',
    message: '已发给广告平台并收到确认',
    writebackId: 'wb-stage',
  })),
}))
vi.mock('@/lib/meta/capi/writer', () => ({ metaCapiWriter: { kind: 'meta_capi' } }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { sendApprovedOutcome } from '@/lib/conversions/writeback-service'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const OUTCOME = '11111111-2222-3333-4444-555555555555'
const STAGE = `${OUTCOME}:conversion-stage`

beforeEach(() => {
  vi.mocked(sendApprovedOutcome).mockClear()
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    const q: Record<string, unknown> = {}
    const self = () => q
    q.select = self
    q.eq = self
    q.maybeSingle = async () =>
      table === 'me_sale_outcomes'
        ? { data: { id: OUTCOME, client_id: 'c-1', review_status: 'approved' }, error: null }
        : { data: null, error: null }
    q.insert = async () => ({ data: null, error: null })
    return q
  }) as never)
})

function post(body?: string) {
  return POST(
    new Request('http://x/send', {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body,
    }),
    { params: { id: OUTCOME } },
  )
}

describe('send scope', () => {
  it('passes the resolved stage event id and does not send the whole deal', async () => {
    const res = await post(JSON.stringify({ event_id: STAGE }))
    expect(res.status).toBe(200)
    expect(sendApprovedOutcome).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendApprovedOutcome).mock.calls[0]?.[2]).toEqual({ eventId: STAGE })
  })

  it('rejects an event id that is not this deal or its stage', async () => {
    const res = await post(JSON.stringify({ event_id: 'someone-else:conversion-stage' }))
    expect(res.status).toBe(400)
    expect(sendApprovedOutcome).not.toHaveBeenCalled()
  })
})
