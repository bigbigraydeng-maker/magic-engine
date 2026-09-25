/**
 * 司马迁 · 口碑周巡的待办出口。
 *
 * 铁律 3 下半句：机器做不了的必须下发，且带齐 what / how / href。
 * 这里验的是——该报的报了、不该报的不刷屏、差评排前面、话说到人不用问第二遍。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientPatrolReceipt, ReviewReplyDraft } from '@/lib/reputation/simaqian-drafts'
import type { ManualItem } from '../manual-item-types'
import {
  buildSimaqianTodo,
  fetchSimaqianTodos,
  pushSimaqianReviewItems,
  formatReplyLine,
  GBP_REVIEWS_URL,
  type SimaqianTodo,
} from '../simaqian-review-items'

const NOW = new Date('2026-10-01T20:00:00Z')

function reply(over: Partial<ReviewReplyDraft> = {}): ReviewReplyDraft {
  return {
    review_uid: 'r1',
    author: 'Alice',
    rating: 5,
    text_excerpt: 'Great service',
    reply_draft: 'Thanks Alice!',
    reason: null,
    cost_usd: 0,
    ...over,
  }
}

function receipt(over: Partial<ClientPatrolReceipt> = {}): ClientPatrolReceipt {
  return {
    client_id: 'client-a',
    client_name: 'Client A',
    status: 'drafted',
    new_reviews: 3,
    negative_reviews: 1,
    replies: [],
    post_draft: null,
    cost_usd: 0,
    error: null,
    ...over,
  }
}

describe('buildSimaqianTodo', () => {
  it('没有新评价就不出待办', () => {
    expect(buildSimaqianTodo(receipt({ status: 'no_new_reviews' }))).toBeNull()
  })

  it('🔴 巡不成要报，而且要说清「没报 ≠ 没有新评价」', () => {
    const t = buildSimaqianTodo(
      receipt({ status: 'read_failed', error: 'permission denied' }),
    )!
    expect(t.kind).toBe('simaqian_patrol_failed')
    expect(t.what).toContain('Client A')
    expect(t.what).toContain('没报 ≠ 没有新评价')
    expect(t.href).toBe('')
  })

  it('🔴 有草稿时差评排前面，href 直达评价页', () => {
    const t = buildSimaqianTodo(
      receipt({
        replies: [
          reply({ review_uid: 'a', rating: 5, author: 'Five' }),
          reply({ review_uid: 'b', rating: 1, author: 'One' }),
          reply({ review_uid: 'c', rating: 4, author: 'Four' }),
        ],
      }),
    )!
    expect(t.kind).toBe('simaqian_review_drafts')
    expect(t.what.startsWith('司马迁：')).toBe(true)
    expect(t.what).toContain('3 条新')
    expect(t.what).toContain('1 条差评')
    expect(t.what).toContain('还没发')
    expect(t.how.indexOf('One')).toBeLessThan(t.how.indexOf('Five'))
    expect(t.href).toBe(GBP_REVIEWS_URL)
  })

  it('草稿超过上限时只列前几条，其余指向回执', () => {
    const replies = Array.from({ length: 7 }, (_, i) =>
      reply({ review_uid: `r${i}`, rating: 5, author: `A${i}` }),
    )
    const t = buildSimaqianTodo(receipt({ replies }))!
    expect(t.how).toContain('另有 2 条见回执')
    expect(t.how).not.toContain('⑥')
  })

  it('没起草的条目要说清原因', () => {
    const t = buildSimaqianTodo(
      receipt({
        replies: [reply({ reply_draft: null, reason: '评价只有星级没有文字，不起草' })],
      }),
    )!
    expect(t.how).toContain('没起草')
    expect(t.how).toContain('评价只有星级没有文字，不起草')
  })

  it('有帖子草稿时 how 里带上', () => {
    const t = buildSimaqianTodo(
      receipt({ replies: [reply()], post_draft: 'Thanks everyone!' }),
    )!
    expect(t.how).toContain('好评帖子草稿')
    expect(t.how).toContain('Thanks everyone!')
  })
})

describe('formatReplyLine', () => {
  it('用圈码编号，超出范围退回数字', () => {
    expect(formatReplyLine(reply(), 0).startsWith('①')).toBe(true)
    expect(formatReplyLine(reply(), 9).startsWith('10.')).toBe(true)
  })
})

// ---------------------------------------------------------------------------

function fakeSupabase(rows: unknown[]): SupabaseClient {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.order = () => chain
  chain.limit = () => Promise.resolve({ data: rows, error: null })
  return { from: () => chain } as unknown as SupabaseClient
}

function run(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    finished_at: '2026-09-29T20:00:00Z',
    status: 'completed',
    summary: { clients: [] },
    ...over,
  }
}

describe('fetchSimaqianTodos', () => {
  it('读最近一轮回执，每个客户最多一条', async () => {
    const todos = await fetchSimaqianTodos(
      fakeSupabase([
        run({
          summary: {
            clients: [
              receipt({ client_id: 'client-a', status: 'drafted' }),
              receipt({ client_id: 'client-b', status: 'no_new_reviews' }),
            ],
          },
        }),
      ]),
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].client_id).toBe('client-a')
  })

  it('🔴 回执太旧就不说话 —— 「该跑没跑」有别的待办在管，两处都报会重复', async () => {
    const todos = await fetchSimaqianTodos(
      fakeSupabase([run({ finished_at: '2026-09-24T20:00:00Z' })]),
      NOW,
    )
    expect(todos).toEqual([])
  })

  it('上一轮没跑成（status 不是 completed）就不说话', async () => {
    expect(await fetchSimaqianTodos(fakeSupabase([run({ status: 'failed' })]), NOW)).toEqual([])
  })

  it('summary 里没有 clients 就不出待办，也不炸', async () => {
    expect(await fetchSimaqianTodos(fakeSupabase([run({ summary: {} })]), NOW)).toEqual([])
  })

  it('从没跑过 / 没有 summary 都不出待办', async () => {
    expect(await fetchSimaqianTodos(fakeSupabase([]), NOW)).toEqual([])
    expect(await fetchSimaqianTodos(fakeSupabase([run({ summary: null })]), NOW)).toEqual([])
  })

  it('summary 里混进形状不对的行时跳过它，其余照常', async () => {
    const todos = await fetchSimaqianTodos(
      fakeSupabase([
        run({
          summary: {
            clients: [null, { page_id: 'x' }, receipt({ client_id: 'client-a', status: 'drafted' })],
          },
        }),
      ]),
      NOW,
    )
    expect(todos).toHaveLength(1)
  })
})

describe('pushSimaqianReviewItems', () => {
  it('用 nameOf 填 client_name，href 要么空要么是 https', async () => {
    const items: ManualItem[] = []
    await pushSimaqianReviewItems(
      fakeSupabase([
        run({
          summary: {
            clients: [
              receipt({ client_id: 'client-a', status: 'drafted' }),
              receipt({ client_id: 'client-b', status: 'read_failed', error: 'boom' }),
            ],
          },
        }),
      ]),
      items,
      NOW,
      id => `Name of ${id}`,
    )
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.client_name).toBe(`Name of ${item.client_id}`)
      expect(item.href === '' || item.href.startsWith('https://')).toBe(true)
    }
  })
})
