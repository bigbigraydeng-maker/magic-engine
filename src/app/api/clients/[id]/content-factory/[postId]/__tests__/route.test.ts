/**
 * 选题确认/打回/发布的闸门测试。
 *
 * 🔴 2026-08-19 Codex 复审抓出的真事故：字幕校对后会重排一次自动剪辑，卡片这时
 * 理应回到「备料」，但如果人在旧的抽屉快照上点了「满意·去发布」，这条路由原来
 * 完全不查有没有活跃做片任务，直接把状态改成 scheduled——reel-render.ts 最后
 * 回写成片时靠 status='approved' 这个原子条件，命不中就悄悄不覆盖，改好的字幕
 * 永远进不去，发布出去的还是没改之前那版，界面上还显示"已通过"，没有任何报错。
 *
 * 🔴 2026-08-19 Codex 第8轮复审又抓出一条：上面这条闸原来是「查一次再写」——先
 * hasActiveRenderJob 查，查完再单独发一条 update。两步不在一个事务里，中间有窗口，
 * 另一个标签页在窗口期建一次重排任务就会被漏过。改成 scheduleContentPostAtomic
 * 一次 RPC 调用(factory_schedule_content_post)，检查活跃任务 + 写 scheduled
 * 焊在同一条 Postgres UPDATE 语句里，这里 mock 的就是这一个 RPC 调用点。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  from: vi.fn(),
  enqueueRenderJob: vi.fn(),
  scheduleContentPostAtomic: vi.fn(),
}))

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: mocks.requireAccess,
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/factory/render-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/factory/render-queue')>()
  return {
    ...actual,
    enqueueRenderJob: mocks.enqueueRenderJob,
    scheduleContentPostAtomic: mocks.scheduleContentPostAtomic,
  }
})

import { PATCH } from '../route'

const CLIENT = '377468af-b103-45f0-984a-b353febb56a1'
const POST_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** content_posts.update().eq().eq().select().single() 写 —— 只给 confirm/reject 用，schedule 走 RPC。*/
function fakeDb(opts: { format?: string | null } = {}) {
  const updateSingle = vi.fn().mockResolvedValue({
    data: { id: POST_ID, status: 'approved', format: opts.format ?? null },
    error: null,
  })
  const updateSelect = vi.fn(() => ({ single: updateSingle }))
  const updateEq2 = vi.fn(() => ({ select: updateSelect }))
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }))
  const update = vi.fn(() => ({ eq: updateEq1 }))
  mocks.from.mockReturnValue({ update })
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
    mocks.scheduleContentPostAtomic.mockResolvedValue({ ok: false, blockedReason: 'active_render_job' })
    const res = await PATCH(req({ action: 'schedule' }), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('做片') })
    expect(mocks.scheduleContentPostAtomic).toHaveBeenCalledWith({ clientId: CLIENT, postId: POST_ID })
  })

  it('没有活跃任务 → 正常放行标 scheduled，且只发一次 RPC 调用(不再是查一次再写两步)', async () => {
    mocks.scheduleContentPostAtomic.mockResolvedValue({
      ok: true,
      post: { id: POST_ID, status: 'scheduled', format: null },
    })
    const res = await PATCH(req({ action: 'schedule' }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ post: { id: POST_ID, status: 'scheduled', format: null } })
    expect(mocks.scheduleContentPostAtomic).toHaveBeenCalledTimes(1)
    // schedule 这条路径完全不碰 content_posts.update() —— 一次 RPC 就是全部写入，
    // 不存在"先查/后写"两个独立数据库调用之间的窗口。
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('内容不存在/不属于该客户 → 404', async () => {
    mocks.scheduleContentPostAtomic.mockResolvedValue({ ok: false, blockedReason: 'not_found' })
    const res = await PATCH(req({ action: 'schedule' }), params)
    expect(res.status).toBe(404)
  })

  it('confirm/reject 不受这条闸限制(只有 schedule 才走 RPC)', async () => {
    fakeDb()
    const res = await PATCH(req({ action: 'confirm' }), params)
    expect(res.status).toBe(200)
    expect(mocks.scheduleContentPostAtomic).not.toHaveBeenCalled()
  })
})
