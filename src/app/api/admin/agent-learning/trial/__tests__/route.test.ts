import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const guard = vi.fn()
const maybeSingle = vi.fn()
const update = vi.fn()
const completeJson = vi.fn()

vi.mock('@/lib/auth/require-admin', () => ({ guardGlobalAdmin: () => guard() }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update,
      upsert: update,
      insert: update,
      delete: update,
    }),
  },
}))
vi.mock('@/lib/agent-learning/llm/deepseek-client', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-learning/llm/deepseek-client')>()
  return {
    ...actual,
    createDeepSeekClient: () => ({ ok: true, value: { model: 'm', price: actual.DEEPSEEK_FLASH_PRICE, completeJson } }),
  }
})

import { POST } from '../route'
import { resetTrialLedger } from '@/lib/agent-learning/lesson-trial/trial-budget'

function req(body: unknown) {
  return new Request('http://x/api/admin/agent-learning/trial', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

const GOOD = JSON.stringify({ suggestions: [{ title: 't', reason: 'r' }] })

beforeEach(() => {
  vi.clearAllMocks()
  resetTrialLedger()
  guard.mockResolvedValue(null)
  maybeSingle.mockResolvedValue({
    data: { lesson: 'L', rationale: null, evidence: { kind: 'expert_rss_candidate' } },
  })
  completeJson.mockResolvedValue({ ok: true, value: { text: GOOD, inputTokens: 1000, outputTokens: 300, model: 'm' } })
})

describe('POST /api/admin/agent-learning/trial', () => {
  it('rejects non-admins without touching the db or the model', async () => {
    guard.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await POST(req({ lessonKey: 'expert-jon-loomer-a' }))
    expect(res.status).toBe(403)
    expect(maybeSingle).not.toHaveBeenCalled()
    expect(completeJson).not.toHaveBeenCalled()
  })

  it('rejects keys outside the 7-lesson prefix list before any db read', async () => {
    const res = await POST(req({ lessonKey: 'expert-common-thread-collective-a' }))
    expect(res.status).toBe(403)
    expect(maybeSingle).not.toHaveBeenCalled()
    expect(completeJson).not.toHaveBeenCalled()
  })

  it('rejects a listed key whose evidence is not an expert candidate', async () => {
    maybeSingle.mockResolvedValue({ data: { lesson: 'L', rationale: null, evidence: { kind: 'x' } } })
    const res = await POST(req({ lessonKey: 'expert-glenn-gabe-a' }))
    expect(res.status).toBe(403)
    expect(completeJson).not.toHaveBeenCalled()
  })

  it('runs two model calls and never writes to the db', async () => {
    const res = await POST(req({ lessonKey: 'expert-jon-loomer-a' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.result.without).toHaveLength(1)
    expect(json.status.trials).toBe(1)
    expect(completeJson).toHaveBeenCalledTimes(2)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses with 429 once the daily $1 cap is used up', async () => {
    completeJson.mockResolvedValue({ ok: true, value: { text: GOOD, inputTokens: 1_500_000, outputTokens: 100_000, model: 'm' } })
    const first = await POST(req({ lessonKey: 'expert-jon-loomer-a' }))
    expect(first.status).toBe(200)
    const callsBefore = completeJson.mock.calls.length
    const second = await POST(req({ lessonKey: 'expert-jon-loomer-a' }))
    expect(second.status).toBe(429)
    expect((await second.json()).error).toContain('额度用完')
    expect(completeJson.mock.calls.length).toBe(callsBefore)
  })
})
