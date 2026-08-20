import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))

import { hasActiveRenderJob, scheduleContentPostAtomic, ACTIVE_JOB_STATUSES } from './render-queue'

const POST = 'post-1'
const CLIENT = 'client-1'

function fakeDb(data: { id: string }[] | null, error: Error | null = null) {
  const limit = vi.fn().mockResolvedValue({ data, error })
  const inFn = vi.fn(() => ({ limit }))
  const eq = vi.fn(() => ({ in: inFn }))
  const select = vi.fn(() => ({ eq }))
  mocks.from.mockReturnValue({ select })
  return { select, eq, inFn, limit }
}

beforeEach(() => vi.resetAllMocks())

describe('hasActiveRenderJob', () => {
  it('有排队/进行中的任务 → true', async () => {
    const db = fakeDb([{ id: 'job-1' }])
    expect(await hasActiveRenderJob(POST)).toBe(true)
    expect(db.inFn).toHaveBeenCalledWith('status', ACTIVE_JOB_STATUSES)
  })

  it('没有活跃任务 → false', async () => {
    fakeDb([])
    expect(await hasActiveRenderJob(POST)).toBe(false)
  })

  it('🔴 查询出错 → 抛错，不能当成"没有活跃任务"(Codex 复审：查询抖一下被误判成false，后面的挂片/清片/发布这些写操作就会在渲染其实还在跑的时候照常放行)', async () => {
    fakeDb(null, new Error('网络抖了一下'))
    await expect(hasActiveRenderJob(POST)).rejects.toThrow('网络抖了一下')
  })
})

describe('scheduleContentPostAtomic', () => {
  it('没有活跃任务 → RPC 一次性写成 scheduled 并回传内容', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ok: true, post_id: POST, status: 'scheduled', format: '快问快答' }],
      error: null,
    })
    const result = await scheduleContentPostAtomic({ clientId: CLIENT, postId: POST })
    expect(mocks.rpc).toHaveBeenCalledWith('factory_schedule_content_post', {
      p_client_id: CLIENT,
      p_post_id: POST,
    })
    expect(result).toEqual({
      ok: true,
      post: { id: POST, status: 'scheduled', format: '快问快答' },
    })
  })

  it('有活跃做片任务 → ok=false, blockedReason=active_render_job', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ok: false, post_id: POST, status: 'approved', format: null, blocked_reason: 'active_render_job' }],
      error: null,
    })
    const result = await scheduleContentPostAtomic({ clientId: CLIENT, postId: POST })
    expect(result).toEqual({ ok: false, blockedReason: 'active_render_job' })
  })

  it('内容不存在/不属于该客户 → ok=false, blockedReason=not_found', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ok: false, post_id: null, status: null, format: null, blocked_reason: 'not_found' }],
      error: null,
    })
    const result = await scheduleContentPostAtomic({ clientId: CLIENT, postId: POST })
    expect(result).toEqual({ ok: false, blockedReason: 'not_found' })
  })

  it('RPC 报错 → 抛错，不能悄悄当成失败放行', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('数据库连不上') })
    await expect(scheduleContentPostAtomic({ clientId: CLIENT, postId: POST })).rejects.toThrow('数据库连不上')
  })

  it('RPC 返回空行(函数改坏了/权限没配对) → 抛错，不能当成任何一种正常结果', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(scheduleContentPostAtomic({ clientId: CLIENT, postId: POST })).rejects.toThrow('没有返回任何行')
  })

  it('🔴 并发场景：两次调用打同一个 RPC，只有一次能拿到 ok=true——原子性由数据库的单条 UPDATE 保证，路由层只做一次调用，不再是"查一次再写"两步', async () => {
    // 模拟 Postgres 的 NOT EXISTS 子查询在同一条 UPDATE 里生效：谁先到谁把状态焊死，
    // 后到的那次连"查"都查不到旧状态，因为它跟"写"是同一条语句。
    let scheduled = false
    mocks.rpc.mockImplementation(async () => {
      if (scheduled) {
        return { data: [{ ok: false, post_id: POST, status: 'approved', format: null, blocked_reason: 'active_render_job' }], error: null }
      }
      scheduled = true
      return { data: [{ ok: true, post_id: POST, status: 'scheduled', format: null }], error: null }
    })

    const [first, second] = await Promise.all([
      scheduleContentPostAtomic({ clientId: CLIENT, postId: POST }),
      scheduleContentPostAtomic({ clientId: CLIENT, postId: POST }),
    ])

    const outcomes = [first, second]
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1)
    expect(outcomes.filter((r) => !r.ok)).toHaveLength(1)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})
