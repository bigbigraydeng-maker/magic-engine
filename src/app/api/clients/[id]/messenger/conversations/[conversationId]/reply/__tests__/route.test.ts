/**
 * Tests for the send-reply endpoint.
 *
 * The endpoint is reachable by a client's own staff, so the tests are about
 * refusing before anything leaves the building:
 *   - an unauthenticated or non-member caller never reaches sendReply
 *   - a send is never made anonymous — no email, no send
 *   - sendReply's own refusals (wrong client, closed window) surface as their
 *     real status codes rather than a generic 500
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/messenger/send', () => ({ sendReply: vi.fn() }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendReply } from '@/lib/messenger/send'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockSend = vi.mocked(sendReply)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CONVO = 'convo-uuid'

function request(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/messenger/x/reply`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function params(id = CTS) {
  return { params: { id, conversationId: CONVO } }
}

// `email: null` models a session with no email at all — passing `undefined`
// would silently fall back to the default parameter and test nothing.
function allow(email: string | null = 'bdm@ctstours.co.nz') {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: email ?? undefined } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CTS,
  } as never)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST reply — authorisation', () => {
  it('rejects an unauthenticated caller without attempting to send', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await POST(request({ body: 'hi' }), params())

    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not a member of the client in the URL', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await POST(request({ body: 'hi' }), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('checks access against the client id in the URL, not one from the body', async () => {
    allow()
    mockSend.mockResolvedValue({ ok: true, metaMessageId: 'mid.1', window: 'standard' } as never)

    await POST(request({ body: 'hi', clientId: OZTOP }), params(CTS))

    expect(mockAccess).toHaveBeenCalledWith(CTS)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ clientId: CTS }))
  })

  it('refuses to send when the session carries no email to attribute it to', async () => {
    allow(null)

    const res = await POST(request({ body: 'hi' }), params())

    expect(res.status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('POST reply — payload', () => {
  it('rejects a non-string body', async () => {
    allow()

    const res = await POST(request({ body: 42 }), params())

    expect(res.status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('passes the sender email and draft flag through to the sender', async () => {
    allow()
    mockSend.mockResolvedValue({ ok: true, metaMessageId: null, window: 'standard' } as never)

    await POST(request({ body: 'Happy to help', usedAiDraft: true }), params())

    expect(mockSend).toHaveBeenCalledWith({
      clientId: CTS,
      conversationId: CONVO,
      body: 'Happy to help',
      sentByEmail: 'bdm@ctstours.co.nz',
      usedAiDraft: true,
    })
  })

  it('defaults usedAiDraft to false so the audit never overstates AI involvement', async () => {
    allow()
    mockSend.mockResolvedValue({ ok: true, metaMessageId: null, window: 'standard' } as never)

    await POST(request({ body: 'typed by hand' }), params())

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ usedAiDraft: false }))
  })
})

describe('POST reply — failures surface accurately', () => {
  it('returns 403 when the thread belongs to another client', async () => {
    allow()
    mockSend.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      reason: 'wrong_client',
    } as never)

    const res = await POST(request({ body: 'hi' }), params())

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ reason: 'wrong_client' })
  })

  it('returns 409 with a reason the UI can act on when the window has closed', async () => {
    allow()
    mockSend.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Messenger 回复窗口已关闭',
      reason: 'window_closed',
    } as never)

    const res = await POST(request({ body: 'hi' }), params())

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'window_closed' })
  })
})
