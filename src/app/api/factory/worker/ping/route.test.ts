import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const calls: string[] = []
const rows: unknown[] = []
let existingId: string | null = null
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: existingId ? [{ id: existingId }] : [], error: null }) }) }) }),
    insert: async (r: { job_name: string }) => { calls.push(`insert:${r.job_name}`); rows.push(r); return { error: null } },
    update: () => ({ eq: async (_k: string, id: string) => { calls.push(`update:${id}`); return { error: null } } }),
  }) },
}))
import { POST } from './route'

const req = (body: unknown, token = 'tok') => new NextRequest('http://x/api/factory/worker/ping', {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
})

describe('POST /api/factory/worker/ping', () => {
  beforeEach(() => { calls.length = 0; rows.length = 0; existingId = null; process.env.FACTORY_WORKER_TOKEN = 'tok'; process.env.FACTORY_WORKER_CLIENT_IDS = `${A},${B}` })

  it('token 不对 → 401，什么都不写', async () => {
    expect((await POST(req({ worker_id: 'w' }, 'bad'))).status).toBe(401)
    expect(calls).toEqual([])
  })
  it('没有 worker_id → 400', async () => {
    expect((await POST(req({}))).status).toBe(400)
  })
  it('越权 client_id → 403；没配白名单 → 503', async () => {
    expect((await POST(req({ worker_id: 'w', client_id: 'not-allowed' }))).status).toBe(403)
    delete process.env.FACTORY_WORKER_CLIENT_IDS
    expect((await POST(req({ worker_id: 'w' }))).status).toBe(503)
  })
  it('没限定客户的 worker 展开成整个白名单；限定了只算那一个', async () => {
    await POST(req({ worker_id: 'w' }))
    await POST(req({ worker_id: 'w2', client_id: B }))
    expect(rows.map(r => (r as { summary: { client_ids: string[] } }).summary.client_ids)).toEqual([[A, B], [B]])
  })
  it('存渲染工人报告；缺字段不当成健康，坏形状写成读不到', async () => {
    await POST(req({ worker_id: 'w', render_worker: { ok: false, reason: 'engine down' } }))
    expect((rows[0] as { summary: { render_worker: unknown } }).summary.render_worker).toEqual({
      ok: false,
      reason: 'engine down',
    })
    rows.length = 0
    await POST(req({ worker_id: 'w2' }))
    expect((rows[0] as { summary: object }).summary).not.toHaveProperty('render_worker')
    rows.length = 0
    await POST(req({ worker_id: 'w3', render_worker: 'nope' }))
    expect((rows[0] as { summary: { render_worker: unknown } }).summary.render_worker).toEqual({
      ok: false,
      reason: '读不到',
    })
  })

  it('第一次插入一行，之后原地刷新同一行（不堆积）', async () => {
    expect((await POST(req({ worker_id: 'w' }))).status).toBe(200)
    existingId = 'row-1'
    await POST(req({ worker_id: 'w' }))
    expect(calls).toEqual(['insert:factory-worker-alive', 'update:row-1'])
  })
})
