import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const holder = vi.hoisted(() => ({
  fake: null as unknown,
  tablesTouched: [] as string[],
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))

vi.mock('@/lib/content/brief-injector', () => ({
  getActiveBrief: vi.fn(),
  formatBriefForPrompt: vi.fn(() => 'BRIEF_TEXT'),
}))

vi.mock('@/lib/content/campaign-injector', () => ({
  getCampaignById: vi.fn(),
  formatCampaignForPrompt: vi.fn(() => 'CAMPAIGN_TEXT'),
}))

vi.mock('@/lib/ai/openai-client', () => ({
  getOpenAIClient: vi.fn(),
}))

vi.mock('@/lib/content/visual-brief-generator', () => ({
  generateVisualBrief: vi.fn(),
}))

vi.mock('@/lib/content/social-quality-audit', () => ({
  auditSocialPost: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      holder.tablesTouched.push(table)

      if (table === 'execution_items' || table === 'production_packages') {
        const fake = holder.fake as {
          from: (t: string) => unknown
        }
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
        select: async () => {
          if (table === 'production_items') {
            return { data: [{ id: 'item-1' }, { id: 'item-2' }], error: null }
          }
          return { data: [{ id: 'post-1' }, { id: 'post-2' }], error: null }
        },
      })
      return chain
    },
  },
}))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { getCampaignById } from '@/lib/content/campaign-injector'
import { getOpenAIClient } from '@/lib/ai/openai-client'
import { generateVisualBrief } from '@/lib/content/visual-brief-generator'
import { auditSocialPost } from '@/lib/content/social-quality-audit'
import { createFakeTables, type FakeTables } from '@/lib/content/__tests__/fake-tables'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockGetActiveBrief = vi.mocked(getActiveBrief)
const mockGetCampaignById = vi.mocked(getCampaignById)
const mockGetOpenAIClient = vi.mocked(getOpenAIClient)
const mockGenerateVisualBrief = vi.mocked(generateVisualBrief)
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

function post(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/content/route-c', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    client_id: CLIENT_A,
    topic: 'A sensible topic',
    platforms: ['facebook'],
    ...overrides,
  }
}

function expectNothingDownstream() {
  expect(mockGetActiveBrief).not.toHaveBeenCalled()
  expect(mockGetCampaignById).not.toHaveBeenCalled()
  expect(mockGetOpenAIClient).not.toHaveBeenCalled()
  expect(mockGenerateVisualBrief).not.toHaveBeenCalled()
  expect(mockAuditSocialPost).not.toHaveBeenCalled()

  expect(holder.tablesTouched).not.toContain('content_posts')
  expect(holder.tablesTouched).not.toContain('production_items')
}

beforeEach(() => {
  fake = createFakeTables(SEED)
  holder.fake = fake
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

  mockGetOpenAIClient.mockReturnValue({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'T',
                  script: 'S',
                  caption: 'C',
                  hashtags: ['h'],
                }),
              },
            },
          ],
        }),
      },
    },
  } as never)

  mockGenerateVisualBrief.mockResolvedValue('vb' as never)
  mockAuditSocialPost.mockResolvedValue(null as never)
})

afterEach(() => {
  vi.clearAllMocks()
  holder.tablesTouched = []
})

describe('POST /api/content/route-c', () => {
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

  it('returns 403 paid_only for self_serve clients', async () => {
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

  it('returns 400 when a required field is missing and never authenticates', async () => {
    const res = await POST(post({ client_id: CLIENT_A, platforms: ['facebook'] }))
    expect(res.status).toBe(400)
    expect(mockAccess).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid execution_item_id and never reaches downstream', async () => {
    const res = await POST(post(validBody({ execution_item_id: 'not-a-uuid' })))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('execution_item_id')
    expectNothingDownstream()
  })

  it("returns 403 for another client's execution item", async () => {
    const res = await POST(post(validBody({ execution_item_id: ITEM_B })))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Forbidden')
    expectNothingDownstream()
  })

  it("returns 403 for another client's production package and 200 for an owned one", async () => {
    const foreign = await POST(post(validBody({ production_package_id: PKG_B })))
    expect(foreign.status).toBe(403)
    expectNothingDownstream()

    fake = createFakeTables(SEED)
    holder.fake = fake
    holder.tablesTouched = []

    const own = await POST(
      post(validBody({ execution_item_id: ITEM_A, production_package_id: PKG_A })),
    )
    expect(own.status).toBe(200)
  })

  it('returns 200 with two posts and two variants on the success path', async () => {
    const res = await POST(post(validBody()))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      posts: unknown[]
      variants: unknown[]
    }
    expect(body.success).toBe(true)
    expect(body.posts).toHaveLength(2)
    expect(body.variants).toHaveLength(2)
    expect(mockAccess).toHaveBeenCalledWith(CLIENT_A)
  })
})
