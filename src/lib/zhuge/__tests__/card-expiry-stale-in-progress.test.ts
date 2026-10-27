import { describe, expect, it } from 'vitest'

import { FakeDb } from '@/lib/seo-weekly-list/__tests__/fake-supabase'
import { SEO_PLAN_LOOP } from '@/lib/zhuge/action-persister'
import {
  closeStaleInProgressCards,
  STALE_IN_PROGRESS_DAYS,
  staleInProgressReason,
} from '@/lib/zhuge/card-expiry'

// 真时钟：以当下时间为基准往回推天数，不用 vi.useFakeTimers()。
const DAY_MS = 86_400_000
const daysAgo = (n: number): string => new Date(Date.now() - n * DAY_MS).toISOString()

describe('closeStaleInProgressCards()', () => {
  it('把超过阈值没更新的进行中卡片收成 skipped，并写明原因', async () => {
    const db = new FakeDb({
      execution_items: [
        { id: 'old', status: 'in_progress', source: 'fde', updated_at: daysAgo(STALE_IN_PROGRESS_DAYS + 1), steps_json: null },
      ],
    })
    const r = await closeStaleInProgressCards(db.client())
    expect(r).toEqual({ closed: 1, days: STALE_IN_PROGRESS_DAYS })
    const row = db.rows('execution_items')[0]
    expect(row.status).toBe('skipped')
    expect(row.auto_run_error).toBe(staleInProgressReason(STALE_IN_PROGRESS_DAYS))
    // 不能冒充做完
    expect(row.completed_at).toBeUndefined()
  })

  it('阈值内刚动过的卡片不碰', async () => {
    const db = new FakeDb({
      execution_items: [
        { id: 'fresh', status: 'in_progress', source: 'fde', updated_at: daysAgo(STALE_IN_PROGRESS_DAYS - 1), steps_json: null },
      ],
    })
    const r = await closeStaleInProgressCards(db.client())
    expect(r.closed).toBe(0)
    expect(db.rows('execution_items')[0].status).toBe('in_progress')
  })

  it('只动 in_progress：pending / completed 再旧也不碰', async () => {
    const old = daysAgo(STALE_IN_PROGRESS_DAYS + 30)
    const db = new FakeDb({
      execution_items: [
        { id: 'p', status: 'pending', source: 'zhuge', updated_at: old, steps_json: null },
        { id: 'c', status: 'completed', source: 'zhuge', updated_at: old, steps_json: null },
      ],
    })
    const r = await closeStaleInProgressCards(db.client())
    expect(r.closed).toBe(0)
    expect(db.rows('execution_items').map(x => x.status)).toEqual(['pending', 'completed'])
  })

  it('SEO 每周清单（steps_json.loop）有自己的过期流程，这里不碰', async () => {
    const old = daysAgo(STALE_IN_PROGRESS_DAYS + 5)
    const db = new FakeDb({
      execution_items: [
        { id: 'plan', status: 'in_progress', source: 'zhuge', updated_at: old, steps_json: { loop: SEO_PLAN_LOOP, keyword: 'k' } },
        { id: 'other', status: 'in_progress', source: 'zhuge', updated_at: old, steps_json: { keyword: 'k' } },
      ],
    })
    const r = await closeStaleInProgressCards(db.client())
    expect(r.closed).toBe(1)
    expect(db.rows('execution_items').find(x => x.id === 'plan')?.status).toBe('in_progress')
    expect(db.rows('execution_items').find(x => x.id === 'other')?.status).toBe('skipped')
  })

  it('阈值是参数：传 7 天就按 7 天算，原因字符串跟着变', async () => {
    const db = new FakeDb({
      execution_items: [
        { id: 'a', status: 'in_progress', source: 'fde', updated_at: daysAgo(8), steps_json: null },
        { id: 'b', status: 'in_progress', source: 'fde', updated_at: daysAgo(6), steps_json: null },
      ],
    })
    const r = await closeStaleInProgressCards(db.client(), new Date(), 7)
    expect(r).toEqual({ closed: 1, days: 7 })
    expect(db.rows('execution_items').find(x => x.id === 'a')?.auto_run_error).toBe('stale_in_progress_7d')
    expect(db.rows('execution_items').find(x => x.id === 'b')?.status).toBe('in_progress')
  })

  it('数据库写失败时抛出，不吞（调用方单独捕获并记到自己的字段）', async () => {
    const db = new FakeDb({
      execution_items: [
        { id: 'old', status: 'in_progress', source: 'fde', updated_at: daysAgo(STALE_IN_PROGRESS_DAYS + 1), steps_json: null },
      ],
    })
    db.writeErrors.execution_items = 'boom'
    await expect(closeStaleInProgressCards(db.client())).rejects.toThrow(/stale in_progress close failed/)
    expect(db.rows('execution_items')[0].status).toBe('in_progress')
  })
})
