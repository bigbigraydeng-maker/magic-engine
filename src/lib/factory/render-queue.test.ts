import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { hasActiveRenderJob, ACTIVE_JOB_STATUSES } from './render-queue'

const POST = 'post-1'

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
