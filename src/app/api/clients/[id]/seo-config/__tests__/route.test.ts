/**
 * Tests for GET/PATCH /api/clients/[id]/seo-config, focused on the
 * repo_meta_executor extension (客户数据红线 #1121). weekly_blog behaviour
 * is pre-existing and only covered here where the shared PATCH validation
 * path changed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn().mockResolvedValue({
    ok: true,
    user: { id: 'test-user', email: 'test@magiclab.com' },
    role: 'admin',
    tier: 'admin',
    allowedClientId: null,
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { GET, PATCH } from '../route'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const CLIENT_ID = 'client-abc'

function makeRequest(method: 'GET' | 'PATCH', body?: object) {
  return new NextRequest(`http://localhost/api/clients/${CLIENT_ID}/seo-config`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function makeContext() {
  return { params: Promise.resolve({ id: CLIENT_ID }) }
}

/** One .from() call → select().eq().single(), resolves to the given seo_config. */
function mockReadChain(seoConfig: unknown, error: string | null = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: error ? null : { seo_config: seoConfig },
      error: error ? { message: error } : null,
    }),
  }
}

/** One .from() call → update().eq(), resolves the write result directly. */
function mockWriteChain(error: string | null = null) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: error ? { message: error } : null }),
  }
}

const FULL_CONFIG = {
  enabled: true,
  dataDir: 'src/lib/data',
  brandSuffix: '| Example Travel',
  voiceHint: 'Boutique adventure-travel brand, Queenstown NZ.',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET', () => {
  it('no repo_meta_executor stored → returns null, not a guessed default', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockReadChain({ weekly_blog: true }) as unknown as ReturnType<typeof supabaseAdmin.from>,
    )
    const res = await GET(makeRequest('GET'), makeContext())
    const json = await res.json()
    expect(json.config).toEqual({ weekly_blog: true, repo_meta_executor: null })
  })

  it('an incomplete stored repo_meta_executor (e.g. missing voiceHint) reads back as null — fail-closed', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockReadChain({
        repo_meta_executor: { enabled: true, dataDir: 'src/lib/data', brandSuffix: '', voiceHint: '' },
      }) as unknown as ReturnType<typeof supabaseAdmin.from>,
    )
    const res = await GET(makeRequest('GET'), makeContext())
    const json = await res.json()
    expect(json.config.repo_meta_executor).toBeNull()
  })

  it('a full valid stored repo_meta_executor round-trips', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockReadChain({ repo_meta_executor: FULL_CONFIG }) as unknown as ReturnType<typeof supabaseAdmin.from>,
    )
    const res = await GET(makeRequest('GET'), makeContext())
    const json = await res.json()
    expect(json.config.repo_meta_executor).toEqual(FULL_CONFIG)
  })
})

describe('PATCH · repo_meta_executor', () => {
  it('enabling with an incomplete config → 400, nothing written', async () => {
    vi.mocked(supabaseAdmin.from).mockReturnValue(
      mockReadChain({}) as unknown as ReturnType<typeof supabaseAdmin.from>,
    )
    const res = await PATCH(
      makeRequest('PATCH', { repo_meta_executor: { enabled: true, dataDir: '', brandSuffix: '', voiceHint: '' } }),
      makeContext(),
    )
    expect(res.status).toBe(400)
  })

  it('enabling with a full valid config → 200, stored as-is', async () => {
    const readChain = mockReadChain({})
    const writeChain = mockWriteChain()
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(readChain as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce(writeChain as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await PATCH(makeRequest('PATCH', { repo_meta_executor: FULL_CONFIG }), makeContext())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.config.repo_meta_executor).toEqual(FULL_CONFIG)
    expect(writeChain.update).toHaveBeenCalledWith({
      seo_config: expect.objectContaining({ repo_meta_executor: FULL_CONFIG }),
    })
  })

  it('{ enabled: false } alone disables without needing to resend dataDir/brandSuffix/voiceHint', async () => {
    const readChain = mockReadChain({ repo_meta_executor: FULL_CONFIG })
    const writeChain = mockWriteChain()
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(readChain as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce(writeChain as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await PATCH(makeRequest('PATCH', { repo_meta_executor: { enabled: false } }), makeContext())
    const json = await res.json()

    expect(res.status).toBe(200)
    // Fail-closed read-back: disabled means the cron treats it as not_configured.
    expect(json.config.repo_meta_executor).toBeNull()
    // But the underlying fields are preserved in storage, not wiped —
    // re-enabling later shouldn't require resending them.
    expect(writeChain.update).toHaveBeenCalledWith({
      seo_config: expect.objectContaining({
        repo_meta_executor: expect.objectContaining({ ...FULL_CONFIG, enabled: false }),
      }),
    })
  })

  it('neither weekly_blog nor repo_meta_executor in body → 400', async () => {
    const res = await PATCH(makeRequest('PATCH', {}), makeContext())
    expect(res.status).toBe(400)
  })
})

/**
 * repo_meta_executor grants a cron write path into the client's own GitHub
 * repo — a materially bigger blast radius than weekly_blog, so it is
 * admin-only even though paid_client/self_serve can reach this route at all
 * for weekly_blog (Codex review on #1121).
 */
describe('PATCH · repo_meta_executor is admin-only', () => {
  const nonAdminAccess = (tier: 'paid_client' | 'self_serve') => ({
    ok: true as const,
    user: { id: 'test-user', email: 'client@example.com' },
    role: 'client-viewer' as const,
    tier,
    allowedClientId: CLIENT_ID,
  })

  it.each(['paid_client', 'self_serve'] as const)(
    '%s tier → 403, nothing read or written',
    async (tier) => {
      vi.mocked(requireDashboardClientAccess).mockResolvedValueOnce(nonAdminAccess(tier) as never)
      const fromSpy = vi.mocked(supabaseAdmin.from)

      const res = await PATCH(makeRequest('PATCH', { repo_meta_executor: FULL_CONFIG }), makeContext())

      expect(res.status).toBe(403)
      expect(fromSpy).not.toHaveBeenCalled()
    },
  )

  it('admin tier → still allowed to configure repo_meta_executor', async () => {
    vi.mocked(requireDashboardClientAccess).mockResolvedValueOnce({
      ok: true,
      user: { id: 'admin-user', email: 'admin@magiclab.com' },
      role: 'admin',
      tier: 'admin',
      allowedClientId: null,
    } as never)
    const readChain = mockReadChain({})
    const writeChain = mockWriteChain()
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(readChain as unknown as ReturnType<typeof supabaseAdmin.from>)
      .mockReturnValueOnce(writeChain as unknown as ReturnType<typeof supabaseAdmin.from>)

    const res = await PATCH(makeRequest('PATCH', { repo_meta_executor: FULL_CONFIG }), makeContext())
    expect(res.status).toBe(200)
  })

  it.each(['paid_client', 'self_serve'] as const)(
    '%s tier → weekly_blog alone still works (existing behaviour preserved)',
    async (tier) => {
      vi.mocked(requireDashboardClientAccess).mockResolvedValueOnce(nonAdminAccess(tier) as never)
      const readChain = mockReadChain({})
      const writeChain = mockWriteChain()
      vi.mocked(supabaseAdmin.from)
        .mockReturnValueOnce(readChain as unknown as ReturnType<typeof supabaseAdmin.from>)
        .mockReturnValueOnce(writeChain as unknown as ReturnType<typeof supabaseAdmin.from>)

      const res = await PATCH(makeRequest('PATCH', { weekly_blog: true }), makeContext())
      expect(res.status).toBe(200)
    },
  )
})
