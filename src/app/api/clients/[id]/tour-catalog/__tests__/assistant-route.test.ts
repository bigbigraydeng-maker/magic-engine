import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted above plain consts, so the mock fns must come from vi.hoisted.
const { requireCatalogAdmin, loadDraftCatalog, runAssistant } = vi.hoisted(() => ({
  requireCatalogAdmin: vi.fn(),
  loadDraftCatalog: vi.fn(),
  runAssistant: vi.fn(),
}))

vi.mock('@/lib/tour-catalog/access', () => ({ requireCatalogAdmin }))
vi.mock('@/lib/tour-catalog/store', () => ({ loadDraftCatalog }))
vi.mock('@/lib/tour-catalog/assistant', () => ({ runAssistant }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { POST } from '../assistant/route'

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
  requireCatalogAdmin.mockResolvedValue({ ok: true, actor: 'admin@example.com' })
  loadDraftCatalog.mockResolvedValue({ tours: [], departures: [], aliases: [] })
  runAssistant.mockResolvedValue({ reply: 'ok', proposals: [], costUsd: 0.01 })
})

describe('POST tour-catalog assistant route', () => {
  it('returns the access response when access is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
    requireCatalogAdmin.mockResolvedValue({ ok: false, response: denied })

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
