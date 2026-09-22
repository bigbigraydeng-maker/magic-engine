// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ access: vi.fn(), view: vi.fn(), settings: vi.fn(), authorize: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: mock.access }))
vi.mock('../service', () => ({ readView: mock.view, saveSettings: mock.settings }))
vi.mock('../targets', () => ({ canonicalDomain: (s: string) => s, approvedUrl: (s: string) => s }))
vi.mock('../runner', () => ({ authorize: mock.authorize }))
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: mock.send } }))
vi.mock('@/lib/inngest/functions/web-intelligence', () => ({ WEB_CAPTURE_EVENT: 'web_intelligence.website.capture.requested' }))
import { GET, PATCH, POST } from '@/app/api/clients/[id]/web-intelligence/route'
const id = '00000000-0000-4000-8000-000000000001'
const requestedId = '00000000-0000-4000-8000-000000000002'
const ctx = { params: Promise.resolve({ id }) }
const request = () => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ domain: 'example.com', url: 'https://example.com/' }) })
beforeEach(() => { vi.resetAllMocks() })
describe('server-side client access and handoff', () => {
  it.each([GET, PATCH, POST])('rejects another client before any reads or writes', async handler => {
    mock.access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await handler(request(), ctx)).status).toBe(403)
    expect(mock.view).not.toHaveBeenCalled(); expect(mock.settings).not.toHaveBeenCalled(); expect(mock.authorize).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled()
  })
  it.each([PATCH, POST])('rejects a nonadmin paid member from cost/config writes', async handler => {
    mock.access.mockResolvedValue({ ok: true, role: 'client-viewer' })
    expect((await handler(request(), ctx)).status).toBe(403); expect(mock.send).not.toHaveBeenCalled()
  })
  it('dispatches the existing atomically reserved identity on duplicate click', async () => {
    mock.access.mockResolvedValue({ ok: true, role: 'admin' }); mock.authorize.mockResolvedValue({ id })
    const response = await POST(request(), ctx)
    expect(response.status).toBe(202)
    expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ id, data: expect.objectContaining({ request_id: id, client_id: id }) }))
  })
  it('preserves a caller request identity so a partial batch can retry safely', async () => {
    mock.access.mockResolvedValue({ ok: true, role: 'admin' }); mock.authorize.mockResolvedValue({ id: requestedId })
    const input = new Request('http://localhost/api', { method: 'POST', body: JSON.stringify({ domain: 'example.com', url: 'https://example.com/', request_id: requestedId }) })
    const response = await POST(input, ctx)
    expect(response.status).toBe(202)
    expect(mock.authorize).toHaveBeenCalledWith(expect.objectContaining({ request_id: requestedId }))
    expect(mock.send).toHaveBeenCalledWith(expect.objectContaining({ id: requestedId }))
  })
  it('does not dispatch when budget rejects the request', async () => {
    mock.access.mockResolvedValue({ ok: true, role: 'admin' }); mock.authorize.mockRejectedValue(new Error('hard_stop'))
    expect((await POST(request(), ctx)).status).toBe(409); expect(mock.send).not.toHaveBeenCalled()
  })
})
