import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProtectedPageError } from '@/lib/seo/protected-pages'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/cms/seo-fix-orchestrator', () => ({ orchestrateSeoFix: vi.fn() }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { orchestrateSeoFix } from '@/lib/cms/seo-fix-orchestrator'

const mockAuth = vi.mocked(requirePaidClientAccess)
const mockFix = vi.mocked(orchestrateSeoFix)
const CTX = { params: { id: 'client-1' } }
const BODY = { file_path: 'src/lib/data/pages.ts', slug: 'china-tours', field: 'metaTitle', old_value: 'Old', new_value: 'New', reason: 'r' }
const req = (body: unknown) => new Request('http://localhost/api/clients/client-1/seo-fix', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ ok: true, user: { email: 'fde@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } } as never)
})

describe('POST /api/clients/[id]/seo-fix — protected-page gate', () => {
  it('🔴 a gate refusal from the write function becomes 403 PROTECTED_PAGE (not a 500)', async () => {
    mockFix.mockRejectedValue(new ProtectedPageError('protected', 'refused'))
    const res = await POST(req(BODY), CTX)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ success: false, code: 'PROTECTED_PAGE' })
  })

  it('hands the write function a guard bound to this client (identity is computed inside, not here)', async () => {
    mockFix.mockResolvedValue({ ok: true, prUrl: 'u', prNumber: 1, branchName: 'b', flywheelActionId: 'f' })
    const res = await POST(req(BODY), CTX)
    expect(res.status).toBe(200)
    const arg = mockFix.mock.calls[0][0]
    expect(arg.guard.clientId).toBe('client-1')
    expect(arg.fix.slug).toBe('china-tours')
  })

  it('a non-gate failure is still a 500, not disguised as a protection refusal', async () => {
    mockFix.mockRejectedValue(new Error('boom'))
    const res = await POST(req(BODY), CTX)
    expect(res.status).toBe(500)
  })
})
