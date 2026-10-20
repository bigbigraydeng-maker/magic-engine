import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true, allowedClientId: 'client-a' })),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

let filters: Record<string, unknown>
function mockRows(rows: Array<{ channel: string | null; last_message_at: string }> | null, error?: string) {
  filters = {}
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => { filters[c] = v; return chain },
      gt: (c: string, v: unknown) => { filters[`gt:${c}`] = v; return chain },
      order: () => chain,
      limit: async () => (error ? { data: null, error: { message: error } } : { data: rows, error: null }),
    }
    return chain
  })
}
const call = (qs: string) => GET(new NextRequest(`http://localhost/x${qs}`), { params: { id: 'client-a' } })

beforeEach(() => { vi.clearAllMocks() })

describe('GET inbound-pulse', () => {
  it('按渠道分组计数，不返回姓名/内容；查询带 client_id 与「最后一句是客人说的」', async () => {
    mockRows([
      { channel: 'whatsapp', last_message_at: '2026-10-20T10:00:00Z' },
      { channel: 'whatsapp', last_message_at: '2026-10-20T09:00:00Z' },
      { channel: 'messenger', last_message_at: '2026-10-20T08:00:00Z' },
      { channel: null, last_message_at: '2026-10-20T07:00:00Z' },
    ])
    const since = new Date(Date.now() - 3_600_000).toISOString()
    const res = await call(`?since=${encodeURIComponent(since)}`)
    const body = await res.json()
    expect(body).toEqual({ count: 4, byChannel: { whatsapp: 2, messenger: 1, other: 1 }, latestAt: '2026-10-20T10:00:00Z' })
    expect(filters.client_id).toBe('client-a')
    expect(filters.last_message_from).toBe('customer')
    expect(filters['gt:last_message_at']).toBe(since)
  })

  it('没有新消息 → count 0，latestAt null', async () => {
    mockRows([])
    const body = await (await call(`?since=${encodeURIComponent(new Date().toISOString())}`)).json()
    expect(body).toEqual({ count: 0, byChannel: {}, latestAt: null })
  })

  it('since 缺失或不是时间 → 400', async () => {
    mockRows([])
    expect((await call('')).status).toBe(400)
    expect((await call('?since=not-a-date')).status).toBe(400)
  })

  it('since 早于 24 小时前 → 按 24 小时前算（不全表扫）', async () => {
    mockRows([])
    await call('?since=2020-01-01T00:00:00Z')
    const used = new Date(String(filters['gt:last_message_at'])).getTime()
    expect(Date.now() - used).toBeLessThanOrEqual(24 * 3_600_000 + 5000)
    expect(Date.now() - used).toBeGreaterThan(23 * 3_600_000)
  })

  it('没权限 → 原样返回 401/403，不查库', async () => {
    ;(requirePaidClientAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status: 403, error: 'forbidden' })
    mockRows([])
    const res = await call(`?since=${encodeURIComponent(new Date().toISOString())}`)
    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('库出错 → 500，不当成 0 条', async () => {
    mockRows(null, 'db down')
    const res = await call(`?since=${encodeURIComponent(new Date().toISOString())}`)
    expect(res.status).toBe(500)
  })
})
