import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const holder = vi.hoisted(() => ({
  current: null as unknown,
  tablesTouched: [] as string[],
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      holder.tablesTouched.push(table)
      const fake = holder.current as {
        from: (t: string) => unknown
      }
      if (table === 'execution_items' || table === 'production_packages') {
        return fake.from(table)
      }
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = self
      chain.eq = self
      chain.order = self
      chain.limit = self
      chain.in = self
      chain.not = self
      chain.update = self
      chain.maybeSingle = async () => ({ data: null, error: null })
      chain.single = async () => ({ data: null, error: null })
      chain.insert = () => ({
        select: async () =>
          table === 'production_items'
            ? { data: [{ id: 'item-1' }, { id: 'item-2' }], error: null }
            : { data: [{ id: 'post-1' }, { id: 'post-2' }], error: null },
      })
      return chain
    },
  },
}))

vi.mock('@/lib/content/brief-injector', () => ({ getActiveBrief: vi.fn() }))
vi.mock('@/lib/content/campaign-injector', () => ({ getCampaignById: vi.fn() }))
vi.mock('@/lib/supadata/client', () => ({ getVideoTranscript: vi.fn() }))
vi.mock('@/lib/content/video-analyzer', () => ({ analyzeViralVideo: vi.fn() }))
vi.mock('@/lib/content/route-b-rewriter', () => ({ rewriteForBrand: vi.fn() }))
vi.mock('@/lib/content/social-quality-audit', () => ({ auditSocialPost: vi.fn() }))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { getCampaignById } from '@/lib/content/campaign-injector'
import { getVideoTranscript } from '@/lib/supadata/client'
import { analyzeViralVideo } from '@/lib/content/video-analyzer'
import { rewriteForBrand } from '@/lib/content/route-b-rewriter'
import { auditSocialPost } from '@/lib/content/social-quality-audit'
import { createFakeTables, type FakeTables } from '@/lib/content/__tests__/fake-tables'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockGetActiveBrief = vi.mocked(getActiveBrief)
const mockGetCampaignById = vi.mocked(getCampaignById)
const mockGetVideoTranscript = vi.mocked(getVideoTranscript)
const mockAnalyzeViralVideo = vi.mocked(analyzeViralVideo)
const mockRewriteForBrand = vi.mocked(rewriteForBrand)
const mockAuditSocialPost = vi.mocked(auditSocialPost)

const CLIENT_A = 'a0000000-0000-4000-8000-000000000001'
const CLIENT_B = 'b0000000-0000-4000-8000-000000000002'
const ITEM_A = 'e0000000-0000-4000-8000-0000000000a1'
const ITEM_B = 'e0000000-0000-4000-8000-0000000000b1'
const PKG_A = 'f0000000-0000-4000-8000-0000000000a1'
const PKG_B = 'f0000000-0000-4000-8000-0000000000b1'

const SEED = {
  execution_items: [
    { id: ITEM_A, client_id: CLIENT_A },
    { id: ITEM_B, client_id: CLIENT_B },
  ],
  production_packages: [
    { id: PKG_A, client_id: CLIENT_A },
    { id: PKG_B, client_id: CLIENT_B },
  ],
}

let fake: FakeTables

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/content/route-b', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function validBody(): Record<string, unknown> {
  return {
    client_id: CLIENT_A,
    video_url: 'https://example.test/v.mp4',
    platforms: ['facebook'],
  }
}

function expectNothingDownstream() {
  expect(mockGetActiveBrief).not.toHaveBeenCalled()
  expect(mockGetCampaignById).not.toHaveBeenCalled()
  expect(mockGetVideoTranscript).not.toHaveBeenCalled()
  expect(mockAnalyzeViralVideo).not.toHaveBeenCalled()
  expect(mockRewriteForBrand).not.toHaveBeenCalled()
  expect(mockAuditSocialPost).not.toHaveBeenCalled()

  for (const table of ['content_posts', 'production_items']) {
    expect(holder.tablesTouched).not.toContain(table)
  }
}

beforeEach(() => {
  fake = createFakeTables(SEED)
  holder.current = fake
  holder.tablesTouched = []

  mockAccess.mockResolvedValue({ ok: true } as never)
  mockGetActiveBrief.mockResolvedValue({
    id: 'brief-1',
    brand_name: 'Brand',
    tone: null,
    avoid_words: null,
    platforms: null,
    primary_audience: null,
  } as never)
  mockGetCampaignById.mockResolvedValue(null as never)
  mockGetVideoTranscript.mockResolvedValue({
    transcript: 'x'.repeat(100),
    metadata: { platform: 'tiktok', title: 't' },
  } as never)
  mockAnalyzeViralVideo.mockResolvedValue({} as never)
  mockRewriteForBrand.mockResolvedValue({
    title: 'T',
    script: 'S',
    caption: 'C',
    hashtags: ['h'],
    visual_brief: 'vb',
  } as never)
  mockAuditSocialPost.mockResolvedValue(null as never)
})

afterEach(() => {
  vi.clearAllMocks()
  holder.tablesTouched = []
})

describe('POST /api/content/route-b', () => {
  it('returns 401 when unauthenticated and touches nothing downstream', async () => {
    mockAccess.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Unauthorized',
      reason: 'unauthorized',
    } as never)

    const res = await POST(post(validBody()))

    expect(res.status).toBe(401)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(false)
    expectNothingDownstream()
  })

  it('returns 403 when logged in but not this client', async () => {
    mockAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      reason: 'forbidden',
    } as never)

    const res = await POST(post(validBody()))

    expect(res.status).toBe(403)
    expectNothingDownstream()
  })

  it('returns 403 with paid_only reason for self_serve', async () => {
    mockAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'This feature requires a paid plan. Contact Magic Lab to unlock.',
      reason: 'paid_only',
    } as never)

    const res = await POST(post(validBody()))

    expect(res.status).toBe(403)
    const body = (await res.json()) as { reason: string }
    expect(body.reason).toBe('paid_only')
    expectNothingDownstream()
  })

  it('returns 500 when the permission lookup fails', async () => {
    mockAccess.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Authorization check failed',
      reason: 'lookup_failed',
    } as never)

    const res = await POST(post(validBody()))

    expect(res.status).toBe(500)
    expectNothingDownstream()
  })

  it('calls requirePaidClientAccess exactly once with the client id', async () => {
    await POST(post(validBody()))

    expect(mockAccess).toHaveBeenCalledTimes(1)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
  })

  it('authorises the client named in the request, not a fixed one', async () => {
    await POST(post({ ...validBody(), client_id: CLIENT_B }))

    expect(mockAccess).toHaveBeenCalledWith(CLIENT_B)
    expect(mockAccess).not.toHaveBeenCalledWith(CLIENT_A)
  })

  it('authenticates before loading the brief', async () => {
    await POST(post(validBody()))

    expect(mockAccess.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetActiveBrief.mock.invocationCallOrder[0],
    )
  })

  it('returns 400 when video_url is missing and never authenticates', async () => {
    const body = validBody()
    delete body.video_url

    const res = await POST(post(body))

    expect(res.status).toBe(400)
    expect(mockAccess).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid execution_item_id and never reaches downstream', async () => {
    const res = await POST(post({ ...validBody(), execution_item_id: 'not-a-uuid' }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('execution_item_id')
    expectNothingDownstream()
  })

  it("returns 403 for another client's execution item", async () => {
    const res = await POST(post({ ...validBody(), execution_item_id: ITEM_B }))

    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Forbidden')
    expectNothingDownstream()
    expect(holder.tablesTouched).toEqual(['execution_items'])
  })

  it('proceeds to 200 for an owned execution item', async () => {
    const res = await POST(post({ ...validBody(), execution_item_id: ITEM_A }))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(true)
  })

  it('returns 200 with two variants and two saved posts on the success path', async () => {
    const res = await POST(post(validBody()))

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      saved_posts: unknown[]
      variants: unknown[]
    }
    expect(body.success).toBe(true)
    expect(body.saved_posts).toHaveLength(2)
    expect(body.variants).toHaveLength(2)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
  })
})
