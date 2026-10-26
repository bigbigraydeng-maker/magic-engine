import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminAccess } from './access-fixtures'

// vi.mock is hoisted above plain consts, so the mock fns must come from vi.hoisted.
const { requireCatalogAccess, loadDraftCatalog, runAssistant, reserveAssistantCall, recordAssistantCost, getSettings } =
  vi.hoisted(() => ({
    getSettings: vi.fn(),
    requireCatalogAccess: vi.fn(),
    loadDraftCatalog: vi.fn(),
    runAssistant: vi.fn(),
    reserveAssistantCall: vi.fn(),
    recordAssistantCost: vi.fn(),
  }))

vi.mock('@/lib/tour-catalog/access', () => ({ requireCatalogAccess }))
vi.mock('@/lib/tour-catalog/store', () => ({ loadDraftCatalog }))
vi.mock('@/lib/tour-catalog/store-access', () => ({ reserveAssistantCall, recordAssistantCost, getSettings }))
// Keep the real limits and error class; only the model call is replaced.
vi.mock('@/lib/tour-catalog/assistant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tour-catalog/assistant')>()),
  runAssistant,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { POST } from '../assistant/route'
import { AssistantRunError } from '@/lib/tour-catalog/assistant'
import { editorAccess } from './access-fixtures'

const CLIENT_ID = 'client-1'

function makeContext() {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/clients/client-1/tour-catalog/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireCatalogAccess.mockResolvedValue(adminAccess('admin@example.com'))
  loadDraftCatalog.mockResolvedValue({ tours: [], departures: [], aliases: [] })
  runAssistant.mockResolvedValue({ reply: 'ok', proposals: [], costUsd: 0.01 })
  reserveAssistantCall.mockResolvedValue('ok')
  recordAssistantCost.mockResolvedValue(undefined)
  getSettings.mockResolvedValue({ logoUrl: null, brandPrimary: null, brandSecondary: null, channelsConnected: false })
})

describe('POST tour-catalog assistant route', () => {
  it('returns the access response when access is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    requireCatalogAccess.mockResolvedValue({ ok: false, response: denied })

    const res = await POST(makeRequest({ message: 'hi' }), makeContext())

    expect(res).toBe(denied)
    expect(loadDraftCatalog).not.toHaveBeenCalled()
    expect(runAssistant).not.toHaveBeenCalled()
  })

  it('returns 400 when message is missing', async () => {
    const res = await POST(makeRequest({}), makeContext())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'message_required' })
    expect(runAssistant).not.toHaveBeenCalled()
  })

  it('returns 400 when message is too long', async () => {
    const res = await POST(makeRequest({ message: 'x'.repeat(2001) }), makeContext())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'message_required' })
    expect(runAssistant).not.toHaveBeenCalled()
  })

  it('passes the open tour id through to the assistant', async () => {
    await POST(makeRequest({ message: '出发日期改一下', focusTourId: 'tour-9' }), makeContext())
    expect(runAssistant).toHaveBeenCalledWith(expect.objectContaining({ focusTourId: 'tour-9' }))
  })

  it('ignores an open tour id that is not a short string', async () => {
    await POST(makeRequest({ message: '改一下', focusTourId: { id: 'x' } }), makeContext())
    expect(runAssistant).toHaveBeenCalledWith(expect.objectContaining({ focusTourId: null }))
    await POST(makeRequest({ message: '改一下', focusTourId: 'x'.repeat(65) }), makeContext())
    expect(runAssistant).toHaveBeenLastCalledWith(expect.objectContaining({ focusTourId: null }))
  })

  it('returns reply and proposals without costUsd on the happy path', async () => {
    const proposals = [{ proposal: { kind: 'update_tour' }, check: { ok: true } }]
    runAssistant.mockResolvedValue({ reply: '已改好', proposals, costUsd: 0.42 })

    const res = await POST(makeRequest({ message: '改一下' }), makeContext())

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ reply: '已改好', proposals })
    expect(json).not.toHaveProperty('costUsd')
  })

  it('passes only the last 10 valid history entries to runAssistant', async () => {
    const history = Array.from({ length: 15 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m${i}`,
    }))
    history.push({ role: 'system', content: 'ignored' } as never)

    await POST(makeRequest({ message: 'go', history }), makeContext())

    expect(runAssistant).toHaveBeenCalledTimes(1)
    const arg = runAssistant.mock.calls[0][0]
    expect(arg.history).toHaveLength(10)
    expect(arg.history[0]).toEqual({ role: 'assistant', content: 'm5' })
    expect(arg.history[9]).toEqual({ role: 'user', content: 'm14' })
    expect(arg.message).toBe('go')
    expect(arg.snapshot).toEqual({ tours: [], departures: [], aliases: [] })
    expect(typeof arg.today).toBe('string')
  })

  it('returns 502 assistant_truncated when the assistant is truncated', async () => {
    runAssistant.mockRejectedValue(new Error('assistant_truncated'))

    const res = await POST(makeRequest({ message: 'go' }), makeContext())

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'assistant_truncated' })
  })

  it('returns 502 assistant_unavailable on any other error', async () => {
    runAssistant.mockRejectedValue(new Error('boom'))

    const res = await POST(makeRequest({ message: 'go' }), makeContext())

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'assistant_unavailable' })
  })
})

describe('size limits', () => {
  it('refuses a body larger than 64KB before parsing', async () => {
    const res = await POST(makeRequest({ message: 'x', history: [{ role: 'user', content: 'a'.repeat(70 * 1024) }] }), makeContext())
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'request_too_large' })
    expect(runAssistant).not.toHaveBeenCalled()
  })

  it('truncates an over-long history item to 4000 characters', async () => {
    loadDraftCatalog.mockResolvedValue({ tours: [], departures: [], aliases: [] })
    runAssistant.mockResolvedValue({ reply: 'ok', proposals: [], costUsd: 0 })
    await POST(makeRequest({ message: 'hi', history: [{ role: 'assistant', content: 'b'.repeat(5000) }] }), makeContext())
    const call = runAssistant.mock.calls[0][0] as { history: Array<{ content: string }> }
    expect(call.history[0].content.length).toBe(4000)
  })
})

describe('daily allowance (design §6.10.1 item 9)', () => {
  const todayUtc = () => new Date().toISOString().slice(0, 10)

  it('reserves with the session email, the UTC day and the three limits before calling the model', async () => {
    const order: string[] = []
    reserveAssistantCall.mockImplementation(async () => {
      order.push('reserve')
      return 'ok'
    })
    runAssistant.mockImplementation(async () => {
      order.push('model')
      return { reply: 'ok', proposals: [], costUsd: 0.05 }
    })

    await POST(makeRequest({ message: 'hi', email: 'spoof@evil.example', actor: 'spoof@evil.example' }), makeContext())

    expect(order).toEqual(['reserve', 'model'])
    expect(reserveAssistantCall).toHaveBeenCalledWith(expect.anything(), CLIENT_ID, todayUtc(), 'admin@example.com', {
      userDaily: 40,
      clientDaily: 150,
      clientDailyCostUsd: 10,
    })
  })

  it('answers 429 assistant_limit on call N+1 and does not call the model or record a cost', async () => {
    const limit = 3
    let used = 0
    reserveAssistantCall.mockImplementation(async () => {
      if (used >= limit) return 'limit'
      used += 1
      return 'ok'
    })

    for (let i = 0; i < limit; i++) {
      const ok = await POST(makeRequest({ message: 'hi' }), makeContext())
      expect(ok.status).toBe(200)
    }
    const refused = await POST(makeRequest({ message: 'hi' }), makeContext())

    expect(refused.status).toBe(429)
    await expect(refused.json()).resolves.toEqual({ error: 'assistant_limit' })
    expect(runAssistant).toHaveBeenCalledTimes(limit)
    expect(loadDraftCatalog).toHaveBeenCalledTimes(limit)
    expect(recordAssistantCost).toHaveBeenCalledTimes(limit)
  })

  it('refuses with 502 and does not call the model when the reservation cannot be made', async () => {
    reserveAssistantCall.mockResolvedValue('error')

    const res = await POST(makeRequest({ message: 'hi' }), makeContext())

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'assistant_unavailable' })
    expect(runAssistant).not.toHaveBeenCalled()
    expect(recordAssistantCost).not.toHaveBeenCalled()
  })

  it('treats any unexpected reservation answer as a refusal', async () => {
    reserveAssistantCall.mockResolvedValue(undefined)
    const res = await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(res.status).toBe(502)
    expect(runAssistant).not.toHaveBeenCalled()
  })

  it('does not reserve for a request that is refused before the model (bad body, denied access)', async () => {
    await POST(makeRequest({}), makeContext())
    requireCatalogAccess.mockResolvedValue({ ok: false, response: new Response('{}', { status: 403 }) })
    await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(reserveAssistantCall).not.toHaveBeenCalled()
  })

  it('records the cost after a successful call', async () => {
    runAssistant.mockResolvedValue({ reply: 'ok', proposals: [], costUsd: 0.07 })
    await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(recordAssistantCost).toHaveBeenCalledTimes(1)
    expect(recordAssistantCost).toHaveBeenCalledWith(expect.anything(), CLIENT_ID, todayUtc(), 'admin@example.com', 0.07)
  })

  it('still records what was spent when the model call throws', async () => {
    runAssistant.mockRejectedValue(new AssistantRunError('provider_down', 0.31))

    const res = await POST(makeRequest({ message: 'hi' }), makeContext())

    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'assistant_unavailable' })
    expect(recordAssistantCost).toHaveBeenCalledWith(expect.anything(), CLIENT_ID, todayUtc(), 'admin@example.com', 0.31)
  })

  it('records the cost of a truncated reply and keeps the truncated error code', async () => {
    runAssistant.mockRejectedValue(new AssistantRunError('assistant_truncated', 0.12))
    const res = await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: 'assistant_truncated' })
    expect(recordAssistantCost).toHaveBeenCalledWith(expect.anything(), CLIENT_ID, todayUtc(), 'admin@example.com', 0.12)
  })

  it('records zero when the failure happened before any model call (catalog read failed)', async () => {
    loadDraftCatalog.mockRejectedValue(new Error('relation "tour_catalog_tours" does not exist'))
    const res = await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(res.status).toBe(502)
    const body = await res.text()
    expect(body).not.toContain('tour_catalog_tours')
    expect(recordAssistantCost).toHaveBeenCalledWith(expect.anything(), CLIENT_ID, todayUtc(), 'admin@example.com', 0)
  })

  it('passes viewerCanPublish from the permissions: true for an admin, false for a client editor', async () => {
    await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(runAssistant).toHaveBeenLastCalledWith(expect.objectContaining({ viewerCanPublish: true }))

    requireCatalogAccess.mockResolvedValue(editorAccess('staff@example.com'))
    await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(runAssistant).toHaveBeenLastCalledWith(expect.objectContaining({ viewerCanPublish: false }))
    expect(reserveAssistantCall).toHaveBeenLastCalledWith(
      expect.anything(),
      CLIENT_ID,
      todayUtc(),
      'staff@example.com',
      expect.anything(),
    )
  })

  it('passes channelsConnected from the saved settings; unreadable settings count as not connected', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(getSettings).toHaveBeenLastCalledWith(expect.anything(), CLIENT_ID)
    expect(runAssistant).toHaveBeenLastCalledWith(expect.objectContaining({ channelsConnected: false }))

    getSettings.mockResolvedValue({ logoUrl: null, brandPrimary: null, brandSecondary: null, channelsConnected: true })
    await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(runAssistant).toHaveBeenLastCalledWith(expect.objectContaining({ channelsConnected: true }))

    getSettings.mockRejectedValue(new Error('settings down'))
    const res = await POST(makeRequest({ message: 'hi' }), makeContext())
    expect(res.status).toBe(200)
    expect(runAssistant).toHaveBeenLastCalledWith(expect.objectContaining({ channelsConnected: false }))
    spy.mockRestore()
  })
})
