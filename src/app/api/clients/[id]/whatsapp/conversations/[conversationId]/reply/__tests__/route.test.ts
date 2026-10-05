/**
 * A human pressing send in the CRM must not reach a customer marked
 * do-not-contact — before this gate the manual path never asked.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/whatsapp/send', () => ({ sendWhatsApp: vi.fn() }))
vi.mock('@/lib/crm/manual-send-dnc-gate', () => ({
  checkManualSendDnc: vi.fn(async () => ({ blocked: false })),
}))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendWhatsApp } from '@/lib/whatsapp/send'
import { checkManualSendDnc } from '@/lib/crm/manual-send-dnc-gate'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockSend = vi.mocked(sendWhatsApp)
const mockGate = vi.mocked(checkManualSendDnc)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const CONVO = 'convo-uuid'

function request(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/whatsapp/x/reply`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = { params: { id: CTS, conversationId: CONVO } }

function allow() {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: 'bdm@ctstours.co.nz' } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CTS,
  } as never)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('WhatsApp manual reply — do-not-contact gate', () => {
  it('refuses a customer marked do-not-contact and never sends', async () => {
    allow()
    mockGate.mockResolvedValueOnce({ blocked: true, status: 403, reason: 'do_not_contact', error: 'dnc' })

    const res = await POST(request({ body: 'hi' }), params)

    expect(mockGate).toHaveBeenCalledWith(CTS, CONVO)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ reason: 'do_not_contact' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('refuses when the check itself failed (fail closed)', async () => {
    allow()
    mockGate.mockResolvedValueOnce({ blocked: true, status: 503, reason: 'dnc_check_failed', error: 'x' })

    const res = await POST(request({ body: 'hi' }), params)

    expect(res.status).toBe(503)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sends as before when the customer may be contacted', async () => {
    allow()
    mockSend.mockResolvedValue({ ok: true, window: { open: true } } as never)

    const res = await POST(request({ body: 'hi' }), params)

    expect(res.status).toBe(200)
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CTS, conversationId: CONVO, body: 'hi' }),
    )
  })

  it('checks nothing before an unauthenticated caller is turned away', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await POST(request({ body: 'hi' }), params)

    expect(res.status).toBe(401)
    expect(mockGate).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })
})
