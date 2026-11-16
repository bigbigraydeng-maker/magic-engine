import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { marker: 'db' } }))
vi.mock('@/lib/microsoft/mail-send-new-prod', () => ({ createMailNewStore: vi.fn(() => ({ marker: 'mail' })) }))
vi.mock('@/lib/crm/site-actions/callback-request-prod', () => ({ createCallbackStore: vi.fn(() => ({ marker: 'store' })) }))
vi.mock('@/lib/crm/site-actions/callback-request', async () => {
  const actual = await vi.importActual<typeof import('@/lib/crm/site-actions/callback-request')>('@/lib/crm/site-actions/callback-request')
  return { ...actual, recordCallbackRequest: vi.fn(async () => ({ outcome: 'recorded', clientId: 'c1', requestId: 'r1' })) }
})

import { recordCallbackRequest } from '@/lib/crm/site-actions/callback-request'
import { POST } from './route'

const post = (raw: string) => POST(new NextRequest('http://x/api/public/crm/site-callback-request', { method: 'POST', body: raw }))
const good = JSON.stringify({ token: 'AAAAAAAAAAAA', date: '2026-11-20', window: 'afternoon', tourPath: null, ua: 'Mozilla/5.0', quiz: null })
const record = recordCallbackRequest as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('POST /api/public/crm/site-callback-request', () => {
  it('a well-formed request is recorded and answered 204 with no body, and logged without the token', async () => {
    const res = await post(good)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(record).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify((console.info as ReturnType<typeof vi.fn>).mock.calls)
    expect(logged).toContain('recorded')
    expect(logged).not.toContain('AAAAAAAAAAAA')
  })

  it('an ignored request answers 204 too (the caller learns nothing about the token)', async () => {
    record.mockResolvedValueOnce({ outcome: 'ignored', reason: 'unknown_token', clientId: null, requestId: null })
    expect((await post(good)).status).toBe(204)
  })

  it('a malformed request is refused before anything is read', async () => {
    expect((await post(JSON.stringify({ token: 'AAAAAAAAAAAA', date: 'tomorrow', window: 'afternoon' }))).status).toBe(400)
    expect((await post('{nope')).status).toBe(400)
    expect(record).not.toHaveBeenCalled()
  })

  it('a body over 2KB is refused', async () => {
    const res = await post(JSON.stringify({ token: 'AAAAAAAAAAAA', date: '2026-11-20', window: 'afternoon', ua: 'x'.repeat(3000) }))
    expect(res.status).toBe(413)
    expect(record).not.toHaveBeenCalled()
  })

  it('over the real-guest allowance → 429, so the site shows its phone number', async () => {
    record.mockResolvedValueOnce({ outcome: 'busy', clientId: 'c1', requestId: 'r1' })
    expect((await post(good)).status).toBe(429)
  })

  it('a failed read or write → 503, so the guest is not told a call is coming', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    record.mockRejectedValueOnce(new Error('db down'))
    expect((await post(good)).status).toBe(503)
  })
})
