import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushCommentAutoreplyStuckItems } from '../comment-autoreply-stuck-items'
import { MAX_ATTEMPTS } from '@/lib/social/comment-autoreply-engine'
import type { ManualItem } from '../manual-item-types'

const NOW = new Date('2026-09-28T00:00:00Z')
const nameOf = (id: string) => (id === 'cts' ? 'CTS Tours NZ' : '未知客户')

function fakeSupabase(rows: Array<{ client_id: string; comment_created_at: string }>, errorMessage?: string) {
  const inSpy = vi.fn()
  const chain = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    in: async (...args: unknown[]) => {
      inSpy(...args)
      return errorMessage ? { data: null, error: { message: errorMessage } } : { data: rows, error: null }
    },
  }
  const sb = {
    from: (table: string) => {
      if (table !== 'social_comment_engagements') throw new Error('unexpected table ' + table)
      return chain
    },
  } as unknown as SupabaseClient
  return { sb, inSpy }
}

describe('pushCommentAutoreplyStuckItems', () => {
  it('没有活跃客户 → 不查库，不下发', async () => {
    const { sb, inSpy } = fakeSupabase([])
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, [])
    expect(items).toEqual([])
    expect(inSpy).not.toHaveBeenCalled()
  })

  it('没有卡死的评论 → 不下发', async () => {
    const { sb } = fakeSupabase([])
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toEqual([])
  })

  it('一个客户有多条卡死评论 → 合并成一条，数量和最早天数都对', async () => {
    const { sb } = fakeSupabase([
      { client_id: 'cts', comment_created_at: '2026-09-21T00:00:00Z' },
      { client_id: 'cts', comment_created_at: '2026-08-23T00:00:00Z' }, // 最早的一条，决定天数
      { client_id: 'cts', comment_created_at: '2026-09-08T00:00:00Z' },
    ])
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('comment_autoreply_stuck')
    expect(items[0].client_id).toBe('cts')
    expect(items[0].client_name).toBe('CTS Tours NZ')
    expect(items[0].what).toContain('3 条')
    expect(items[0].what).toContain(`${MAX_ATTEMPTS} 次`)
    expect(items[0].what).toContain('36 天') // 2026-08-23T00:00Z → 2026-09-28T00:00Z（NOW）整 36 天
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/cts/settings')
  })

  it('按 activeClientIds 过滤查询', async () => {
    const { sb, inSpy } = fakeSupabase([])
    await pushCommentAutoreplyStuckItems(sb, [], NOW, nameOf, ['cts', 'nal'])
    expect(inSpy).toHaveBeenCalledWith('client_id', ['cts', 'nal'])
  })

  it('读取失败 → 抛错（调用方用 .catch 兜底，这里不吞）', async () => {
    const { sb } = fakeSupabase([], 'boom')
    await expect(pushCommentAutoreplyStuckItems(sb, [], NOW, nameOf, ['cts'])).rejects.toThrow('boom')
  })
})
