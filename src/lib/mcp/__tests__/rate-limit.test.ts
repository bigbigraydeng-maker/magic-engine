/**
 * P34.5 — rate-limit tests. Counts mcp_access_log rows per key in the window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { checkRateLimit, RATE_LIMIT } from '../rate-limit'
import { supabaseAdmin } from '@/lib/supabase'

const KEY_ID = 'kkkkkkkk-0000-0000-0000-000000000001'
const mockFrom = vi.mocked(supabaseAdmin.from)

function mockCount(result: { count: number | null; error: unknown }) {
  const gte = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ gte })
  const select = vi.fn().mockReturnValue({ eq })
  mockFrom.mockReturnValue({ select } as unknown as ReturnType<typeof supabaseAdmin.from>)
  return { select, eq, gte }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('checkRateLimit', () => {
  it('allows when under the limit', async () => {
    mockCount({ count: 5, error: null })
    const res = await checkRateLimit(KEY_ID)
    expect(res.ok).toBe(true)
    expect(res.used).toBe(5)
    expect(res.limit).toBe(RATE_LIMIT)
  })

  it('blocks at the limit', async () => {
    mockCount({ count: RATE_LIMIT, error: null })
    const res = await checkRateLimit(KEY_ID)
    expect(res.ok).toBe(false)
  })

  it('blocks over the limit', async () => {
    mockCount({ count: RATE_LIMIT + 10, error: null })
    const res = await checkRateLimit(KEY_ID)
    expect(res.ok).toBe(false)
  })

  it('scopes the count to this key and a time window', async () => {
    const { eq, gte } = mockCount({ count: 0, error: null })
    await checkRateLimit(KEY_ID)
    expect(eq).toHaveBeenCalledWith('key_id', KEY_ID)
    // gte called with an ISO timestamp (the window start).
    const sinceArg = gte.mock.calls[0][1] as string
    expect(sinceArg).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('fails OPEN on a counting error (read-only surface must not go dark)', async () => {
    mockCount({ count: null, error: { message: 'boom' } })
    const res = await checkRateLimit(KEY_ID)
    expect(res.ok).toBe(true)
  })
})
