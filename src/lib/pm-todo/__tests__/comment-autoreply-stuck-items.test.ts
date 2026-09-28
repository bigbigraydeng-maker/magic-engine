import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushCommentAutoreplyStuckItems } from '../comment-autoreply-stuck-items'
import type { ManualItem } from '../manual-item-types'

const NOW = new Date('2026-09-28T00:00:00Z')
const PAGE_ID = '1616575215312482'
const nameOf = (id: string) => (id === 'cts' ? 'CTS Tours NZ' : '未知客户')

/**
 * `page-sync-authorization.ts` / `token-selection.ts` 各有自己的测试文件（覆盖
 * evaluate() 的存量令牌 / 员工核实 / 共享令牌等全部分支，含解密），这里直接假掉
 * 两个函数的返回值，只测本文件自己的分支逻辑（令牌来源判定结果 → 挑哪段 how
 * 文案），不重新过一遍它们内部的 DB 链路。
 */
const assessConfiguredPageMock = vi.fn()
vi.mock('@/lib/meta/page-sync-authorization', () => ({
  assessConfiguredPage: (...args: unknown[]) => assessConfiguredPageMock(...args),
}))

const resolveMetaTokenDetailedMock = vi.fn()
vi.mock('@/lib/meta/token-selection', async (importOriginal) => {
  // domainToEnvKey / pageIdToEnvVar 是纯函数（Codex round 10 P1 用来点名实际
  // env var），用真实实现而不是另外假一份——同一套推导逻辑没有理由在测试里
  // 复制第二遍，复制出来的两份迟早会不同步。
  const actual = await importOriginal<typeof import('@/lib/meta/token-selection')>()
  return {
    ...actual,
    resolveMetaTokenDetailed: (...args: unknown[]) => resolveMetaTokenDetailedMock(...args),
  }
})

interface EngagementRow {
  client_id: string
  page_id: string
  comment_created_at: string
}

type Branch = 'failed' | 'dm_sent' | 'processing'

/**
 * 假 `.from('social_comment_engagements')` 链：三条查询（failed / dm_sent /
 * 卡死的 processing）各自独立调用 `.from()`，靠这次调用里出现的 `reply_status`
 * 过滤值区分该回哪一份数据，`fetchAll` 的分页在 `.order().range()` 收尾
 * （单页测试数据 < 1000 行，一次 `.range()` 就到底，不需要模拟翻页）。
 */
function engagementsChain(rowsByBranch: Partial<Record<Branch, EngagementRow[]>>, errorMessage?: string) {
  let branch: Branch | null = null
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      if (col === 'reply_status') branch = val as Branch
      return chain
    },
    gte: () => chain,
    lt: () => chain,
    is: () => chain,
    in: (_col: string, ids: readonly string[]) => {
      chain._ids = ids
      return chain
    },
    order: () => chain,
    _ids: [] as readonly string[],
    range: async () => {
      if (errorMessage) return { data: null, error: { message: errorMessage } }
      const rows = (branch && rowsByBranch[branch]) || []
      // reply_status 就是查询本身的过滤条件（每条分支查询只会命中同一个
      // reply_status），直接从 branch 推，不用要求每条测试夹具都手写这一列。
      return { data: rows.filter((r) => chain._ids.includes(r.client_id)).map((r) => ({ ...r, reply_status: branch })), error: null }
    },
  }
  return chain
}

interface FakeDbOptions {
  failedRows?: EngagementRow[]
  dmRows?: EngagementRow[]
  processingRows?: EngagementRow[]
  errorMessage?: string
  /** `scopedEnvVarName` 读 `clients` 表算实际变量名用的（Codex round 10 P1）。 */
  clientsRow?: { domain?: string | null; facebook_page_id?: string | null } | null
}

function fakeDb(opts: FakeDbOptions) {
  const inSpy = vi.fn()
  const sb = {
    from: (table: string) => {
      if (table === 'clients') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.clientsRow ?? null, error: null }),
            }),
          }),
        }
      }
      if (table !== 'social_comment_engagements') throw new Error(`unexpected table ${table}`)
      const chain = engagementsChain(
        { failed: opts.failedRows ?? [], dm_sent: opts.dmRows ?? [], processing: opts.processingRows ?? [] },
        opts.errorMessage,
      )
      const originalIn = chain.in
      chain.in = (...args: Parameters<typeof originalIn>) => {
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
    resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
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
    expect(items[0].what).toContain('36 天') // 2026-08-23T00:00Z → 2026-09-28T00:00Z（NOW）整 36 天
    // Codex round 11 P2：裸 /settings 落在默认的 connect 页签，「评论审计」板块在 content 页签里
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/cts/settings?tab=content&audit=1')
    // Codex round 3 P1：卡在 processing 的行可能其实已经发出去了，how 必须先讲"看一眼再回"，不能无条件让人去补发
    expect(items[0].how).toContain('是不是已经有回复了')
  })

  it('dm_sent 但公开回复为空的行也算卡死（Codex round 1 P1）', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
    resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
    const { sb } = fakeDb({
      dmRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('1 条')
  })

  it('卡在 processing 超过宽限期的行也算卡死（Codex round 2 P1）', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
    resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
    const { sb } = fakeDb({
      processingRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('1 条')
  })

  it('三类同一客户会合并计数', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
    resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-08T00:00:00Z' }],
      dmRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-10T00:00:00Z' }],
      processingRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-08-23T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toHaveLength(1)
    // Codex round 8 P1：failed/dm_sent（确定该回复）跟 processing 卡死（不确定，见下面专门的测试）分开计数描述，不再合并成一个笼统的总数
    expect(items[0].what).toContain('2 条确定该有公开回复')
    expect(items[0].what).toContain('1 条处理到一半中断')
    expect(items[0].what).toContain('36 天')
  })

  it('processing 卡死不确定原本该不该回，跟 failed/dm_sent 分开描述、how 里提示先判断再动手（Codex round 8 P1）', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
    resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
    const { sb } = fakeDb({
      processingRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items[0].what).toContain('1 条处理到一半中断')
    expect(items[0].what).not.toContain('确定该有公开回复')
    expect(items[0].how).toContain('先自己判断该怎么处理')
    expect(items[0].how).not.toContain('没有回复的才手动回一下')
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
    // Codex round 7 P2：待办页面只把 href 渲成可点按钮，how 只是纯文本——URL 必须在 href 里，不能只写进 how 文案
    // Codex round 8 P1：intent=comment_reply 让回调把新令牌存去评论引擎实际用的主页，不是 clients.facebook_page_id
    expect(items[0].href).toBe('https://app.magicengine.com.au/api/auth/facebook/connect?client_id=cts&intent=comment_reply')
    expect(assessConfiguredPageMock).toHaveBeenCalledWith(sb, 'cts', PAGE_ID, expect.anything())
  })

  // Codex round 10 P1：client_domain / client_page 两种「专属变量」各自对应不同的实际
  // env var，`pickScopedMetaToken` 域名优先于主页——笼统说"专属变量"会让 FDE 改错那一个。
  it('令牌走的是专属环境变量、来源是域名（client_domain）→ how 点名实际的域名变量', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: true, via: 'legacy_client_token' })
    resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_domain' })
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
      clientsRow: { domain: 'ctstours.co.nz', facebook_page_id: PAGE_ID },
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items[0].how).toContain('pages_manage_engagement')
    expect(items[0].how).toContain('Render 后台')
    expect(items[0].how).toContain('META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ')
    // 不能连主页变量也一起提，两条一起写等于又把人指错方向
    expect(items[0].how).not.toContain('META_SYSTEM_USER_TOKEN_PAGE_')
  })

  it('令牌走的是专属环境变量、来源是主页（client_page）→ how 点名实际的主页变量', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: true, via: 'legacy_client_token' })
    resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
      clientsRow: { domain: null, facebook_page_id: PAGE_ID },
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items[0].how).toContain(`META_SYSTEM_USER_TOKEN_PAGE_${PAGE_ID}`)
  })

  it('令牌走的是专属环境变量，但 clients 行读不出来 → how 退回不点名的通用指引，不整条待办失败', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: true, via: 'legacy_client_token' })
    resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
      clientsRow: null,
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items[0].how).toContain('pages_manage_engagement')
    expect(items[0].how).toContain('这个客户专属的令牌变量')
    expect(items[0].how).not.toContain('META_SYSTEM_USER_TOKEN_PAGE_')
  })

  it('令牌走的是公共钥匙（shared_fallback）→ how 说清是公共钥匙，不是这个客户专属变量（Codex round 3 P1）', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: true, via: 'staff_verified' })
    resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'shared_fallback' })
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items[0].how).toContain('META_SYSTEM_USER_TOKEN')
    expect(items[0].how).toContain('没有专属 Meta 令牌')
  })

  it('令牌来源判不出来（两处都读失败）→ how 退回默认的专属变量指引，不整条待办失败', async () => {
    assessConfiguredPageMock.mockRejectedValue(new Error('boom'))
    resolveMetaTokenDetailedMock.mockRejectedValue(new Error('boom'))
    const { sb } = fakeDb({
      failedRows: [{ client_id: 'cts', page_id: PAGE_ID, comment_created_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toHaveLength(1)
    expect(items[0].how).toContain('Render 后台')
  })

  it('按 activeClientIds 过滤查询（三条查询都要过滤）', async () => {
    const { sb, inSpy } = fakeDb({})
    await pushCommentAutoreplyStuckItems(sb, [], NOW, nameOf, ['cts', 'nal'])
    expect(inSpy).toHaveBeenCalledWith('client_id', ['cts', 'nal'])
    expect(inSpy).toHaveBeenCalledTimes(3) // failed / dm_sent / processing 各一次
  })

  it('failed 分支读取失败 → 抛错（调用方用 .catch 兜底，这里不吞）', async () => {
    const { sb } = fakeDb({ errorMessage: 'boom' })
    await expect(pushCommentAutoreplyStuckItems(sb, [], NOW, nameOf, ['cts'])).rejects.toThrow('boom')
  })
})
