import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/require-admin', () => ({
  requireGlobalAdmin: vi.fn(),
}))
vi.mock('@/lib/auth/whitelist', () => ({
  isGlobalAdminEmail: vi.fn(),
}))
vi.mock('@/lib/factory/publish/promote/deps', () => ({
  createProductionPromoteDeps: vi.fn(),
}))
vi.mock('@/lib/factory/publish/promote/action', () => ({
  runPromote: vi.fn(),
}))

import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { isGlobalAdminEmail } from '@/lib/auth/whitelist'
import { createProductionPromoteDeps } from '@/lib/factory/publish/promote/deps'
import { runPromote } from '@/lib/factory/publish/promote/action'
import { POST } from './route'

const ORDER_ID = 'c0000000-0000-4000-8000-000000000001'
const ADMIN_EMAIL = 'admin@example.com'

const mockedRequireAdmin = vi.mocked(requireGlobalAdmin)
const mockedIsAdminEmail = vi.mocked(isGlobalAdminEmail)
const mockedDeps = vi.mocked(createProductionPromoteDeps)
const mockedRunPromote = vi.mocked(runPromote)

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function callPost(body: unknown, id: string = ORDER_ID) {
  return POST(makeRequest(body), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedRequireAdmin.mockResolvedValue({
    ok: true,
    user: { id: 'c0000000-0000-4000-8000-0000000000cc', email: ADMIN_EMAIL },
  } as never)
  mockedIsAdminEmail.mockReturnValue(true)
  mockedDeps.mockReturnValue({} as never)
  mockedRunPromote.mockResolvedValue({ ok: true, kind: 'preview', data: { preview_token: 't' } } as never)
})

describe('POST /factory/work-orders/[id]/promote', () => {
  it('refuses a scoped/demo admin with 403 and does not promote', async () => {
    mockedRequireAdmin.mockResolvedValue({ ok: false, status: 403, error: 'GLOBAL_ADMIN_REQUIRED' } as never)

    const res = await callPost({ confirm: false })

    expect(res.status).toBe(403)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('refuses a company-domain email that is not in the exact admin list with 403 and does not promote', async () => {
    mockedIsAdminEmail.mockReturnValue(false)

    const res = await callPost({ confirm: false })

    expect(res.status).toBe(403)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('passes through a 401 from requireGlobalAdmin', async () => {
    mockedRequireAdmin.mockResolvedValue({ ok: false, status: 401, error: 'UNAUTHENTICATED' } as never)

    const res = await callPost({ confirm: false })

    expect(res.status).toBe(401)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid id with 400', async () => {
    const res = await callPost({ confirm: false }, 'not-a-uuid')

    expect(res.status).toBe(400)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('rejects a null body with 400', async () => {
    const res = await callPost(null)

    expect(res.status).toBe(400)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('rejects an array body with 400', async () => {
    const res = await callPost([{ confirm: false }])

    expect(res.status).toBe(400)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('rejects a body with an extra video_id key with 400 and does not promote', async () => {
    const res = await callPost({ confirm: false, video_id: 'v1' })

    expect(res.status).toBe(400)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('rejects a body with an extra page_id key with 400 and does not promote', async () => {
    const res = await callPost({ confirm: false, page_id: 'p1' })

    expect(res.status).toBe(400)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('rejects a body with an extra client_id key with 400 and does not promote', async () => {
    const res = await callPost({ confirm: false, client_id: 'c1' })

    expect(res.status).toBe(400)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('rejects a missing confirm with 400', async () => {
    const res = await callPost({})

    expect(res.status).toBe(400)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('rejects a non-boolean confirm with 400', async () => {
    const res = await callPost({ confirm: 'yes' })

    expect(res.status).toBe(400)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('rejects a non-string preview_token with 400', async () => {
    const res = await callPost({ confirm: true, preview_token: 123 })

    expect(res.status).toBe(400)
    expect(mockedRunPromote).not.toHaveBeenCalled()
  })

  it('returns 200 with the preview payload and calls runPromote with confirm:false', async () => {
    const res = await callPost({ confirm: false })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.kind).toBe('preview')
    expect(body.preview_token).toBe('t')
    expect(mockedRunPromote).toHaveBeenCalledWith(expect.anything(), {
      orderId: ORDER_ID,
      adminEmail: ADMIN_EMAIL,
      confirm: false,
      previewToken: undefined,
    })
  })

  it('passes preview_token through to runPromote on confirm', async () => {
    mockedRunPromote.mockResolvedValue({ ok: true, kind: 'promoted', data: {} } as never)

    const res = await callPost({ confirm: true, preview_token: 'tok-1' })

    expect(res.status).toBe(200)
    expect(mockedRunPromote).toHaveBeenCalledWith(expect.anything(), {
      orderId: ORDER_ID,
      adminEmail: ADMIN_EMAIL,
      confirm: true,
      previewToken: 'tok-1',
    })
  })

  it('maps a failed runPromote to its status and error', async () => {
    mockedRunPromote.mockResolvedValue({ ok: false, status: 409, error: 'x' } as never)

    const res = await callPost({ confirm: true, preview_token: 'tok-1' })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'x' })
  })
})
