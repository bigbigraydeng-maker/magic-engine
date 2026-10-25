// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ admin: vi.fn(), access: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: mocks.admin }))
vi.mock('@/lib/auth/client-access', () => ({ requireOnboardingClientAccess: mocks.access }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
import { DELETE } from '../route'
const id = '11111111-1111-4111-8111-111111111111'
const grant = '22222222-2222-4222-8222-222222222222'
const request = () => new NextRequest(`https://me.example.test/api/clients/${id}/platform/instagram?connectionId=${grant}`)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.admin.mockResolvedValue({ ok: true }); mocks.access.mockResolvedValue({ ok: true })
  mocks.from.mockReturnValue({ update: mocks.update })
  const chain = { eq: mocks.eq, select: mocks.select, maybeSingle: mocks.single }
  mocks.update.mockReturnValue(chain); mocks.eq.mockReturnValue(chain); mocks.select.mockReturnValue(chain)
  mocks.single.mockResolvedValue({ data: { id: grant }, error: null })
})
describe('Instagram local disconnect atomic boundaries', () => {
  it('updates only the exact client/provider/purpose/connection and reads no tokens', async () => {
    expect((await DELETE(request(), { params: { id } })).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ status: 'revoked', updated_at: expect.any(String) })
    expect(mocks.eq.mock.calls).toEqual([['id', grant], ['client_id', id], ['provider', 'instagram'], ['purpose', 'legacy']])
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith('id')
  })
  it.each(['admin', 'client'])('denies %s failure before writes', async guard => {
    mocks[guard === 'admin' ? 'admin' : 'access'].mockResolvedValue({ ok: false, error: 'Forbidden', status: 403 })
    expect((await DELETE(request(), { params: { id } })).status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each(['client_id', 'provider', 'purpose', 'id'])('does not revoke a row belonging to another %s', async field => {
    const row = { client_id: id, provider: 'instagram', purpose: 'legacy', id: grant, [field]: 'another' }
    mocks.single.mockImplementation(async () => ({ data: mocks.eq.mock.calls.every(([key, value]) => row[key as keyof typeof row] === value) ? { id: grant } : null, error: null }))
    expect((await DELETE(request(), { params: { id } })).status).toBe(404)
  })
  it('sanitizes database errors', async () => {
    mocks.single.mockResolvedValue({ error: { message: 'private-token' } })
    const response = await DELETE(request(), { params: { id } })
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-token')
  })
})
