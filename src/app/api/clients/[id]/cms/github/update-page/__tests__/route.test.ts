import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProtectedPageError } from '@/lib/seo/protected-pages'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/cms/github-page-upgrade-publisher', () => ({ publishPageUpgradeToGithub: vi.fn() }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { publishPageUpgradeToGithub } from '@/lib/cms/github-page-upgrade-publisher'

const mockAuth = vi.mocked(requirePaidClientAccess)
const mockPublish = vi.mocked(publishPageUpgradeToGithub)
const CTX = { params: { id: 'client-1' } }
const BODY = {
  page_id: 'p1', page_url: 'https://x.com/about', enhanced_title: 'T', enhanced_meta_title: 'T',
  enhanced_meta_description: 'D', enhanced_html_body: '<p>b</p>',
}
const req = (body: unknown) => new Request('http://localhost/api/clients/client-1/cms/github/update-page', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ ok: true, user: { email: 'fde@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } } as never)
})

describe('POST /api/clients/[id]/cms/github/update-page — protected-page gate', () => {
  it('🔴 a gate refusal becomes 403 PROTECTED_PAGE', async () => {
    mockPublish.mockRejectedValue(new ProtectedPageError('protected', 'refused'))
    const res = await POST(req(BODY), CTX)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ success: false, code: 'PROTECTED_PAGE' })
  })

  it('passes a guard bound to this client into the write function', async () => {
    mockPublish.mockResolvedValue({ ok: true, prUrl: 'u', prNumber: 1, branchName: 'b', filePath: 'f', updatedFields: [], bodyApplied: true, flywheelActionId: null })
    const res = await POST(req(BODY), CTX)
    expect(res.status).toBe(200)
    expect(mockPublish.mock.calls[0][0].guard.clientId).toBe('client-1')
  })

  it('a non-gate error is rethrown (not swallowed into a fake protection message)', async () => {
    mockPublish.mockRejectedValue(new Error('boom'))
    await expect(POST(req(BODY), CTX)).rejects.toThrow('boom')
  })
})
