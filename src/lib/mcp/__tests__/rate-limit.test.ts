/**
 * P34.5 + P34-P3.5 — rate limit. Counts mcp_access_log by the kind-specific
 * FK column (client_key_id / admin_key_id), supports custom limit, fails open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

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

beforeEach(() => vi.resetAllMocks())

describe('checkRateLimit', () => {
  it('allows under the limit', async () => {
    mockCount({ count: 5, error: null })
    const res = await checkRateLimit(KEY_ID)
    expect(res).toEqual({ ok: true, used: 5, limit: RATE_LIMIT })
  })

  it('blocks at / over the limit', async () => {
    mockCount({ count: RATE_LIMIT, error: null })
    expect((await checkRateLimit(KEY_ID)).ok).toBe(false)
    mockCount({ count: RATE_LIMIT + 10, error: null })
    expect((await checkRateLimit(KEY_ID)).ok).toBe(false)
  })

  it('default kind=client counts client_key_id column', async () => {
    const { eq, gte } = mockCount({ count: 0, error: null })
    await checkRateLimit(KEY_ID)
    expect(eq).toHaveBeenCalledWith('client_key_id', KEY_ID)
    expect(gte.mock.calls[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('kind=admin counts admin_key_id column + honours custom limit', async () => {
    const { eq } = mockCount({ count: 29, error: null })
    const res = await checkRateLimit(KEY_ID, { limit: 30, kind: 'admin' })
    expect(eq).toHaveBeenCalledWith('admin_key_id', KEY_ID)
    expect(res).toEqual({ ok: true, used: 29, limit: 30 })
    // 30 used vs limit 30 → blocked
    mockCount({ count: 30, error: null })
    expect((await checkRateLimit(KEY_ID, { limit: 30, kind: 'admin' })).ok).toBe(false)
  })

  it('fails OPEN on a counting error', async () => {
    mockCount({ count: null, error: { message: 'boom' } })
    expect((await checkRateLimit(KEY_ID)).ok).toBe(true)
  })
})
