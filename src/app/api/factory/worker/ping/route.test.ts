import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const calls: string[] = []
let existingId: string | null = null
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: existingId ? [{ id: existingId }] : [], error: null }) }) }) }),
    insert: async (r: { job_name: string }) => { calls.push(`insert:${r.job_name}`); return { error: null } },
    update: () => ({ eq: async (_k: string, id: string) => { calls.push(`update:${id}`); return { error: null } } }),
  }) },
}))
import { POST } from './route'

const req = (body: unknown, token = 'tok') => new NextRequest('http://x/api/factory/worker/ping', {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
})

describe('POST /api/factory/worker/ping', () => {
  beforeEach(() => { calls.length = 0; existingId = null; process.env.FACTORY_WORKER_TOKEN = 'tok' })

  it('token 不对 → 401，什么都不写', async () => {
    expect((await POST(req({ worker_id: 'w' }, 'bad'))).status).toBe(401)
    expect(calls).toEqual([])
  })
  it('没有 worker_id → 400', async () => {
    expect((await POST(req({}))).status).toBe(400)
  })
  it('第一次插入一行，之后原地刷新同一行（不堆积）', async () => {
    expect((await POST(req({ worker_id: 'w' }))).status).toBe(200)
    existingId = 'row-1'
    await POST(req({ worker_id: 'w' }))
    expect(calls).toEqual(['insert:factory-worker-alive', 'update:row-1'])
  })
})
