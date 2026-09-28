import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushCommentAutoreplyStuckItems } from '../comment-autoreply-stuck-items'
import { MAX_ATTEMPTS } from '@/lib/social/comment-autoreply-engine'
import type { ManualItem } from '../manual-item-types'

const NOW = new Date('2026-09-28T00:00:00Z')
const PAGE_ID = '1616575215312482'
const nameOf = (id: string) => (id === 'cts' ? 'CTS Tours NZ' : '未知客户')

/**
 * `page-sync-authorization.ts` 有自己的测试文件（覆盖 evaluate() 的存量令牌 /
 * 员工核实 / 共享令牌等全部分支，含解密），这里直接假掉 `assessConfiguredPage`
 * 的返回值，只测本文件自己的分支逻辑（令牌来源判定结果 → 挑哪段 how 文案），
 * 不重新过一遍它内部的 DB 链路。
 */
const assessConfiguredPageMock = vi.fn()
vi.mock('@/lib/meta/page-sync-authorization', () => ({
  assessConfiguredPage: (...args: unknown[]) => assessConfiguredPageMock(...args),
}))

interface EngagementRow {
  client_id: string
  page_id: string
  comment_created_at: string
}

/**
 * 假 `.from('social_comment_engagements')` 链：两条查询（failed 分支 / dm_sent
 * 分支）各自独立调用 `.from()`，靠这次调用里出现的 `reply_status` 过滤值区分
 * 该回哪一份数据，最后在 `.in()` 收尾。
 */
function engagementsChain(failedRows: EngagementRow[], dmRows: EngagementRow[], errorMessage?: string) {
  let branch: 'failed' | 'dm_sent' | null = null
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      if (col === 'reply_status') branch = val as 'failed' | 'dm_sent'
      return chain
    },
    gte: () => chain,
    is: () => chain,
    in: async (_col: string, ids: readonly string[]) => {
      if (errorMessage) return { data: null, error: { message: errorMessage } }
      const rows = branch === 'failed' ? failedRows : dmRows
      return { data: rows.filter((r) => ids.includes(r.client_id)), error: null }
    },
  }
  return chain
}

interface FakeDbOptions {
  failedRows?: EngagementRow[]
  dmRows?: EngagementRow[]
  errorMessage?: string
}

function fakeDb(opts: FakeDbOptions) {
  const inSpy = vi.fn()
  const sb = {
    from: (table: string) => {
      if (table !== 'social_comment_engagements') throw new Error(`unexpected table ${table}`)
      const chain = engagementsChain(opts.failedRows ?? [], opts.dmRows ?? [], opts.errorMessage)
      const originalIn = chain.in
      chain.in = async (...args: Parameters<typeof originalIn>) => {
        inSpy(...args)
        return originalIn(...args)
      }
      return chain
    },
  } as unknown as SupabaseClient
  return { sb, inSpy }
}

describe('pushCommentAutoreplyStuckItems', () => {
  it('没有活跃客户 → 不查库，不下发', async () => {
    const { sb, inSpy } = fakeDb({})
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, [])
    expect(items).toEqual([])
    expect(inSpy).not.toHaveBeenCalled()
  })

  it('没有卡死的评论 → 不下发', async () => {
    const { sb } = fakeDb({})
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toEqual([])
  })

  it('一个客户有多条卡死评论 → 合并成一条，数量和最早天数都对', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
    const { sb } = fakeDb({
      failedRows: [
        { client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-21T00:00:00Z' },
        { client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-08-23T00:00:00Z' }, // 最早的一条，决定天数
        { client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-08T00:00:00Z' },
      ],
    })
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

  it('dm_sent 但公开回复为空的行也算卡死（Codex round 1 P1）', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
    const { sb } = fakeDb({
      dmRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('1 条')
  })

  it('failed 和 dm_sent 两类同一客户会合并计数', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-08T00:00:00Z' }],
      dmRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-08-23T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('2 条')
    expect(items[0].what).toContain('36 天')
  })

  it('令牌是存量 OAuth（client_oauth）→ how 指向重新连接 Meta，不指向 Render 环境变量', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: true, via: 'client_oauth' })
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items[0].how).toContain('连接 Meta')
    expect(items[0].how).toContain('改 Render 环境变量对这个客户不会生效')
    expect(assessConfiguredPageMock).toHaveBeenCalledWith(sb, 'cts', PAGE_ID, expect.anything())
  })

  it('令牌走的是环境变量（legacy_client_token）→ how 走 Render 环境变量指引', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: true, via: 'legacy_client_token' })
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items[0].how).toContain('pages_manage_engagement')
    expect(items[0].how).toContain('Render 后台')
  })

  it('令牌来源判不出来（读失败）→ how 退回默认的环境变量指引，不整条待办失败', async () => {
    assessConfiguredPageMock.mockRejectedValue(new Error('boom'))
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toHaveLength(1)
    expect(items[0].how).toContain('Render 后台')
  })

  it('按 activeClientIds 过滤查询（两条查询都要过滤）', async () => {
    const { sb, inSpy } = fakeDb({})
    await pushCommentAutoreplyStuckItems(sb, [], NOW, nameOf, ['cts', 'nal'])
    expect(inSpy).toHaveBeenCalledWith('client_id', ['cts', 'nal'])
    expect(inSpy).toHaveBeenCalledTimes(2) // failed 分支 + dm_sent 分支各一次
  })

  it('failed 分支读取失败 → 抛错（调用方用 .catch 兜底，这里不吞）', async () => {
    const { sb } = fakeDb({ errorMessage: 'boom' })
    await expect(pushCommentAutoreplyStuckItems(sb, [], NOW, nameOf, ['cts'])).rejects.toThrow('boom')
  })
})
