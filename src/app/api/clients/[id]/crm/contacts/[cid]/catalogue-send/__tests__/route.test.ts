import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requirePaidClientAccess: vi.fn(),
  sendCatalogueEmail: vi.fn(),
  store: { insertEvent: vi.fn(), loadEvents: vi.fn(), setMirror: vi.fn() },
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: mocks.requirePaidClientAccess }))
vi.mock('@/lib/crm/catalogue-line/send-catalogue', () => ({ sendCatalogueEmail: mocks.sendCatalogueEmail }))
vi.mock('@/lib/crm/catalogue-line/prod', () => ({ createCatalogueDeps: () => ({}) }))
vi.mock('@/lib/crm/ai-takeover/prod', () => ({ createTakeoverStore: () => mocks.store }))

import { POST } from '../route'

const ctx = { params: { id: 'client-a', cid: 'contact-1' } }
const RID = '22222222-2222-4222-8222-222222222222'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePaidClientAccess.mockResolvedValue({ ok: true, user: { email: 'Lisa@Client.co.nz' } })
  mocks.store.insertEvent.mockResolvedValue({ inserted: true })
  // first read = the not-yet-in-takeover pre-check; later reads = the log after the write
  mocks.store.loadEvents.mockResolvedValueOnce([])
  mocks.store.loadEvents.mockResolvedValue([{ kind: 'ai_takeover_on', createdAt: '2026-11-10T01:00:00Z', actor: 'lisa@client.co.nz' }])
  mocks.store.setMirror.mockResolvedValue(undefined)
})

describe('POST catalogue-send', () => {
  it('not signed in: nothing sent', async () => {
    mocks.requirePaidClientAccess.mockResolvedValue({ ok: false, status: 401, error: 'no' })
    expect((await POST(req({ requestId: RID, expectedRecipient: 'a@b.co' }), ctx)).status).toBe(401)
    expect(mocks.sendCatalogueEmail).not.toHaveBeenCalled()
  })

  it('needs a uuid requestId and a recipient', async () => {
    expect((await POST(req({ requestId: 'x', expectedRecipient: 'a@b.co' }), ctx)).status).toBe(400)
    expect((await POST(req({ requestId: RID }), ctx)).status).toBe(400)
    expect(mocks.sendCatalogueEmail).not.toHaveBeenCalled()
  })

  it('the actor is the signed-in user, never the request body', async () => {
    mocks.sendCatalogueEmail.mockResolvedValue({
      ok: true, messageId: 'm', conversationId: 'c', duplicate: false, templateKey: 'k', templateVersion: 1, versionLabel: 'v9', settingsVersion: 1,
    })
    const res = await POST(req({ requestId: RID, expectedRecipient: 'a@b.co', actorEmail: 'evil@x.co' }), ctx)
    expect(res.status).toBe(200)
    expect(mocks.sendCatalogueEmail.mock.calls[0][0]).toMatchObject({ actorEmail: 'lisa@client.co.nz', requestId: RID })
    expect(mocks.store.insertEvent.mock.calls[0][0]).toMatchObject({ actor: 'lisa@client.co.nz', kind: 'ai_takeover_on' })
  })

  it('a refused send writes no takeover', async () => {
    mocks.sendCatalogueEmail.mockResolvedValue({ ok: false, status: 409, reason: 'do_not_contact', message: '别再联系', mayHaveSent: false })
    const res = await POST(req({ requestId: RID, expectedRecipient: 'a@b.co' }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ sent: false, message: '别再联系' })
    expect(mocks.store.insertEvent).not.toHaveBeenCalled()
  })

  it('a crash mid-way is reported as "unknown", never as "not sent"', async () => {
    mocks.sendCatalogueEmail.mockRejectedValue(new Error('boom'))
    const res = await POST(req({ requestId: RID, expectedRecipient: 'a@b.co' }), ctx)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ sent: 'unknown' })
    expect(mocks.store.insertEvent).not.toHaveBeenCalled()
  })
})
