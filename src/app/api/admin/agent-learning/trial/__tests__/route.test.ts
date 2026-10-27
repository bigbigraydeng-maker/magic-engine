import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  guard: null as unknown,
  lesson: null as unknown,
  rpc: vi.fn(),
  llmCalls: 0,
}))

vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: async () => h.guard }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: h.lesson, error: null }) }),
      }),
    }),
    rpc: (...a: unknown[]) => h.rpc(...a),
  },
}))
vi.mock('@/lib/agent-learning/llm/deepseek-client', async (orig) => {
  const real = await orig<typeof import('@/lib/agent-learning/llm/deepseek-client')>()
  return {
    ...real,
    createDeepSeekClient: () => ({
      ok: true,
      value: {
        model: 'm',
        price: real.DEEPSEEK_FLASH_PRICE,
        completeJson: async () => {
          h.llmCalls += 1
          return {
            ok: true,
            value: {
              text: JSON.stringify({ suggestions: [{ title: 't', reason: 'r' }] }),
              inputTokens: 100,
              outputTokens: 100,
              model: 'm',
            },
          }
        },
      },
    }),
  }
})

import { NextResponse } from 'next/server'
import { POST } from '../route'

const req = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }) as never

beforeEach(() => {
  h.guard = null
  h.llmCalls = 0
  h.lesson = { lesson: 'Use raw HTML', evidence: { kind: 'expert_rss_candidate' } }
  h.rpc.mockReset()
  h.rpc.mockResolvedValue({ data: { ok: true, claimed: true }, error: null })
})

describe('POST /api/admin/agent-learning/trial', () => {
  it('rejects non-admins before anything else', async () => {
    h.guard = NextResponse.json({ error: 'no' }, { status: 403 })
    const res = await POST(req({ lessonKey: 'expert-glenn-gabe-1' }))
    expect(res.status).toBe(403)
    expect(h.llmCalls).toBe(0)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('rejects keys outside the first-batch list without spending', async () => {
    const res = await POST(req({ lessonKey: 'expert-common-thread-collective-1' }))
    expect(res.status).toBe(403)
    expect(h.llmCalls).toBe(0)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('runs a comparison for an eligible lesson', async () => {
    const res = await POST(req({ lessonKey: 'expert-glenn-gabe-1' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.without).toHaveLength(1)
    expect(json.with).toHaveLength(1)
    expect(h.llmCalls).toBe(2)
  })

  it('refuses with a clear message when the daily cap is used up', async () => {
    h.rpc.mockResolvedValue({ data: { ok: false, reason: 'cap_exceeded' }, error: null })
    const res = await POST(req({ lessonKey: 'expert-jon-loomer-1' }))
    const json = await res.json()
    expect(res.status).toBe(429)
    expect(json.error).toContain('额度用完')
    expect(h.llmCalls).toBe(0)
  })
})
