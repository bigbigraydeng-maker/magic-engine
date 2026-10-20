/**
 * 内容工厂看板：YouTube 回执只是附加信息，读失败（例如生产库缺 content_post_id 列）不能让整页死；
 * 其它读失败要把真实原因说出来，不能再被吞成 "Unknown error"。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Result = { data: unknown; error: unknown }
const m = vi.hoisted(() => ({
  access: vi.fn(),
  tables: {} as Record<string, Result>,
  warn: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: m.access }))
vi.mock('@/lib/supabase', () => {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    const pass = () => c
    c.select = pass; c.eq = pass; c.in = pass; c.order = pass; c.limit = pass
    c.single = async () => m.tables[table] ?? { data: null, error: null }
    c.then = (resolve: (v: unknown) => unknown) => resolve(m.tables[table] ?? { data: [], error: null })
    return c
  }
  return { supabaseAdmin: { from: (t: string) => chain(t) } }
})

import { GET } from '../route'

const post = { id: 'p1', title: '选题一', status: 'draft', source_video_url: null, platforms: [], scheduled_at: null, published_at: null, created_at: '2026-10-20T00:00:00Z', script: '', caption: '', source: '', pillar_id: null, visual_brief: '', format: '', generation_context_snapshot: null }
const call = () => GET(new NextRequest('http://localhost/x'), { params: { id: 'client-1' } })

beforeEach(() => {
  m.warn.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(m.warn)
  m.access.mockResolvedValue({ ok: true })
  m.tables = {
    content_posts: { data: [post], error: null },
    youtube_publish_receipts: { data: [], error: null },
    content_factory_render_jobs: { data: [], error: null },
    clients: { data: { factory_config: null }, error: null },
  }
})

describe('GET content-factory/board', () => {
  it('YouTube 回执表缺列（Postgrest 错误对象）→ 仍返回 200，stages 正常，只记一条警告', async () => {
    m.tables.youtube_publish_receipts = { data: null, error: { message: 'column youtube_publish_receipts.content_post_id does not exist', code: '42703' } }
    const res = await call()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.counts['选题']).toBe(1)
    expect(json.stages['选题'][0].id).toBe('p1')
    expect(json.stages['选题'][0].youtubeStage).toBeNull()
    expect(m.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(m.warn.mock.calls[0])).toContain('content_post_id does not exist')
  })

  it('YouTube 回执读成功 → 卡片带上 YouTube 阶段（正常路径没被改坏）', async () => {
    m.tables.youtube_publish_receipts = { data: [{ content_post_id: 'p1', status: 'staged', video_id: 'v1', created_at: '2026-10-20T01:00:00Z' }], error: null }
    const json = await (await call()).json()
    expect(json.stages['选题'][0].youtubeStage).toEqual({ status: 'staged', videoId: 'v1', createdAt: '2026-10-20T01:00:00Z' })
    expect(m.warn).not.toHaveBeenCalled()
  })

  it('主表（content_posts）读失败 → 500，错误信息可读（含原因和错误码），不再是 Unknown error', async () => {
    m.tables.content_posts = { data: null, error: { message: 'permission denied for table content_posts', code: '42501' } }
    const res = await call()
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('permission denied for table content_posts (42501)')
    expect(json.error).not.toBe('Unknown error')
  })

  it('没权限 → 原样返回，不读库', async () => {
    m.access.mockResolvedValue({ ok: false, status: 403, error: 'no' })
    expect((await call()).status).toBe(403)
  })
})
