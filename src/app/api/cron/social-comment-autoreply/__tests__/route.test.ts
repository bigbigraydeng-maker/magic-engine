import { describe, it, expect, vi, beforeEach } from 'vitest'

const finish = vi.fn(async (_o: { failed?: number; error?: string }) => {})
const processClientComments = vi.fn()

vi.mock('@/lib/cron/run-logger', () => ({ startCronRun: async () => ({ finish }) }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ client_id: 'c1', fb_page_id: 'p1' }], error: null }),
      }),
    }),
  },
}))
vi.mock('@/lib/social/comment-autoreply-engine', () => ({
  processClientComments: (...a: unknown[]) => processClientComments(...a),
  isKilled: () => false,
}))

import { GET } from '../route'
import { NextRequest } from 'next/server'

const req = () => new NextRequest('http://x/api/cron/social-comment-autoreply', { headers: { authorization: 'Bearer s3cret' } })

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret'
  finish.mockClear()
  processClientComments.mockReset()
})

describe('social-comment-autoreply cron run record', () => {
  it('🔴 a client whose scan failed is recorded as a FAILED run (error set), not completed', async () => {
    processClientComments.mockResolvedValue({ client_id: 'c1', ok: false, error: 'fetchPagePosts 1: 500 reduce the amount of data' })
    await GET(req())
    const arg = finish.mock.calls[0][0]
    expect(arg.failed).toBe(1)
    expect(arg.error).toContain('c1')
    expect(arg.error).toContain('reduce the amount of data')
  })

  it('a clean run carries no error', async () => {
    processClientComments.mockResolvedValue({ client_id: 'c1', ok: true })
    await GET(req())
    const arg = finish.mock.calls[0][0]
    expect(arg.failed).toBe(0)
    expect(arg.error).toBeUndefined()
  })
})
