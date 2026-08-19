/**
 * 选题确认/打回/发布的闸门测试。
 *
 * 🔴 2026-08-19 Codex 复审抓出的真事故：字幕校对后会重排一次自动剪辑，卡片这时
 * 理应回到「备料」，但如果人在旧的抽屉快照上点了「满意·去发布」，这条路由原来
 * 完全不查有没有活跃做片任务，直接把状态改成 scheduled——reel-render.ts 最后
 * 回写成片时靠 status='approved' 这个原子条件，命不中就悄悄不覆盖，改好的字幕
 * 永远进不去，发布出去的还是没改之前那版，界面上还显示"已通过"，没有任何报错。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  from: vi.fn(),
  enqueueRenderJob: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

// hasActiveRenderJob 走真实现(纯查询)，只 mock enqueueRenderJob —— 跟 video/route.test.ts 同一个模式
vi.mock('@/lib/factory/render-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/factory/render-queue')>()
  return { ...actual, enqueueRenderJob: mocks.enqueueRenderJob }
})

import { PATCH } from '../route'

const CLIENT = '377468af-b103-45f0-984a-b353febb56a1'
const POST_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/**
 * content_posts.update().eq().eq().select().single() 写；
 * content_factory_render_jobs.select().eq().in().limit() 查活跃任务(hasActiveRenderJob)。
 */
function fakeDb(opts: { format?: string | null; activeJobs?: number } = {}) {
  const jobs = Array.from({ length: opts.activeJobs ?? 0 }, (_, i) => ({ id: `job-${i}` }))
  const updateSingle = vi.fn().mockResolvedValue({
    data: { id: POST_ID, status: 'scheduled', format: opts.format ?? null },
    error: null,
  })
  const updateSelect = vi.fn(() => ({ single: updateSingle }))
  const updateEq2 = vi.fn(() => ({ select: updateSelect }))
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }))
  const update = vi.fn(() => ({ eq: updateEq1 }))

  mocks.from.mockImplementation((table: string) => {
    if (table === 'content_factory_render_jobs') {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: jobs, error: null }) })) })) })),
      }
    }
    return { update }
  })
  return { update, updateEq1, updateEq2, updateSelect, updateSingle }
}

const req = (body: unknown) => ({ json: async () => body }) as never
const params = { params: { id: CLIENT, postId: POST_ID } }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAccess.mockResolvedValue({ ok: true })
  mocks.enqueueRenderJob.mockResolvedValue({ jobId: 'job-new', created: true })
})

describe('鉴权', () => {
  it('没登录 → 直接挡掉', async () => {
    mocks.requireAccess.mockResolvedValue({ ok: false, error: '未登录', status: 401 })
    const res = await PATCH(req({ action: 'confirm' }), params)
    expect(res.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('action 校验', () => {
  it('不认识的 action → 400', async () => {
    fakeDb()
    const res = await PATCH(req({ action: 'whatever' }), params)
    expect(res.status).toBe(400)
  })
})

describe('confirm', () => {
  it('确认 → approved + 建做片任务', async () => {
    fakeDb()
    const res = await PATCH(req({ action: 'confirm' }), params)
    expect(res.status).toBe(200)
    expect(mocks.enqueueRenderJob).toHaveBeenCalledWith({ clientId: CLIENT, contentPostId: POST_ID })
  })

  it('讲课式确认不建做片任务(要走单讲工作台)', async () => {
    fakeDb({ format: '讲课式' })
    const res = await PATCH(req({ action: 'confirm' }), params)
    expect(res.status).toBe(200)
    expect(mocks.enqueueRenderJob).not.toHaveBeenCalled()
  })

  it('建任务失败不回滚确认，只把错误带回去(best-effort)', async () => {
    fakeDb()
    mocks.enqueueRenderJob.mockRejectedValue(new Error('排队失败'))
    const res = await PATCH(req({ action: 'confirm' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.render.error).toContain('排队失败')
  })
})

describe('reject', () => {
  it('打回 → rejected，不建做片任务', async () => {
    fakeDb()
    const res = await PATCH(req({ action: 'reject' }), params)
    expect(res.status).toBe(200)
    expect(mocks.enqueueRenderJob).not.toHaveBeenCalled()
  })
})

describe('🔴 schedule(满意去发布) 不许在做片流水线还在跑的时候抢跑', () => {
  it('有活跃做片任务 → 409，不许标 scheduled', async () => {
    const db = fakeDb({ activeJobs: 1 })
    const res = await PATCH(req({ action: 'schedule' }), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('做片') })
    expect(db.update, '有活跃任务就不该碰内容状态').not.toHaveBeenCalled()
  })

  it('没有活跃任务 → 正常放行标 scheduled', async () => {
    const db = fakeDb({ activeJobs: 0 })
    const res = await PATCH(req({ action: 'schedule' }), params)
    expect(res.status).toBe(200)
    expect(db.update).toHaveBeenCalledWith({ status: 'scheduled' })
  })

  it('confirm/reject 不受这条闸限制(只有 schedule 才查)', async () => {
    const db = fakeDb({ activeJobs: 1 })
    const res = await PATCH(req({ action: 'confirm' }), params)
    expect(res.status).toBe(200)
    expect(db.update).toHaveBeenCalled()
  })
})
