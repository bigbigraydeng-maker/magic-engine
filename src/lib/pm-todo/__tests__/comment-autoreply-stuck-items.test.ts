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
  updated_at: string
  /** 只有"重试没耗尽"这条分支需要——用来判断是不是已经越过回看窗口。 */
  comment_created_at?: string
}

/** `failed` 按 attempts 比较符拆成两支：耗尽（exhausted）/ 没耗尽（partial，越窗才算卡死）。 */
type Branch = 'exhausted' | 'dm_sent' | 'processing' | 'partial'

/**
 * 假 `.from('social_comment_engagements')` 链：四条查询（耗尽 failed / dm_sent /
 * 卡死的 processing / 没耗尽的 failed）各自独立调用 `.from()`，靠 `reply_status`
 * 过滤值 + attempts 比较符（`gte`/`lt`）区分该回哪一份数据，`fetchAll` 的分页在
 * `.order().range()` 收尾（单页测试数据 < 1000 行，一次 `.range()` 就到底，不需要
 * 模拟翻页）。
 */
function engagementsChain(rowsByBranch: Partial<Record<Branch, EngagementRow[]>>, errorMessage?: string) {
  let replyStatus: string | null = null
  let attemptsCmp: 'gte' | 'lt' | null = null
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      if (col === 'reply_status') replyStatus = val as string
      return chain
    },
    gte: (col: string) => {
      if (col === 'attempts') attemptsCmp = 'gte'
      return chain
    },
    lt: (col: string) => {
      if (col === 'attempts') attemptsCmp = 'lt' // processing 分支也调用 lt()，但比较的是 updated_at，不是 attempts
      return chain
    },
    is: () => chain,
    in: (_col: string, ids: readonly string[]) => {
      chain._ids = ids
      return chain
    },
    order: () => chain,
    _ids: [] as readonly string[],
    range: async () => {
      if (errorMessage) return { data: null, error: { message: errorMessage } }
      const branch: Branch | null =
        replyStatus === 'dm_sent' ? 'dm_sent' :
        replyStatus === 'processing' ? 'processing' :
        replyStatus === 'failed' && attemptsCmp === 'gte' ? 'exhausted' :
        replyStatus === 'failed' && attemptsCmp === 'lt' ? 'partial' :
        null
      const rows = (branch && rowsByBranch[branch]) || []
      return { data: rows.filter((r) => chain._ids.includes(r.client_id)), error: null }
    },
  }
  return chain
}

interface FakeDbOptions {
  exhaustedRows?: EngagementRow[]
  dmRows?: EngagementRow[]
  processingRows?: EngagementRow[]
  /** 没耗尽重试次数的 failed 行——只有 `comment_created_at` 早于回看窗口才算卡死。 */
  partialRows?: EngagementRow[]
  errorMessage?: string
  /** `scopedEnvVarName` 读 `clients` 表算实际变量名用的（Codex round 10 P1）。 */
  clientsRow?: { domain?: string | null; facebook_page_id?: string | null } | null
  /** `fetchLookbackDaysByClient` 读的每客户回看天数；缺省客户用 DEFAULT_LOOKBACK_DAYS=7 兜底。 */
  lookbackDays?: Record<string, number>
}

function fakeDb(opts: FakeDbOptions) {
  const inSpy = vi.fn()
  const configInSpy = vi.fn()
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
      if (table === 'social_comment_config') {
        return {
          select: () => ({
            in: (_col: string, ids: readonly string[]) => {
              configInSpy(ids)
              const rows = Object.entries(opts.lookbackDays ?? {})
                .filter(([clientId]) => ids.includes(clientId))
                .map(([client_id, lookback_days]) => ({ client_id, lookback_days }))
              return {
                order: () => ({
                  range: async () => ({ data: rows, error: null }),
                }),
              }
            },
          }),
        }
      }
      if (table !== 'social_comment_engagements') throw new Error(`unexpected table ${table}`)
      const chain = engagementsChain(
        {
          exhausted: opts.exhaustedRows ?? [],
          dm_sent: opts.dmRows ?? [],
          processing: opts.processingRows ?? [],
          partial: opts.partialRows ?? [],
        },
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
  return { sb, inSpy, configInSpy }
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
      exhaustedRows: [
        { client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-21T00:00:00Z' },
        { client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-08-23T00:00:00Z' }, // 最早的一条，决定天数
        { client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-08T00:00:00Z' },
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
      dmRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-01T00:00:00Z' }],
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
      processingRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-01T00:00:00Z' }],
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
      exhaustedRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-08T00:00:00Z' }],
      dmRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-10T00:00:00Z' }],
      processingRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-08-23T00:00:00Z' }],
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
      processingRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items[0].what).toContain('1 条处理到一半中断')
    expect(items[0].what).not.toContain('确定该有公开回复')
    expect(items[0].how).toContain('先自己判断该怎么处理')
    expect(items[0].how).not.toContain('没有回复的才手动回一下')
  })

  // Codex round 12 复审 P1：还没耗尽重试次数、但已经越过这个客户回看窗口的 failed
  // 行——engine 按 comment.createdAt 过滤，越窗的评论永远不会再被拿去重试，
  // attempts 永远停在耗尽之前，原来的查询（只认 attempts>=MAX_ATTEMPTS）完全看不到它。
  describe('越过回看窗口、还没耗尽重试次数的 failed 行（Codex round 12 P1）', () => {
    it('评论发出时间早于这个客户的回看窗口 → 算卡死，且不说"该回复"（用不确定语气以外的"确定但不会自动重试"措辞）', async () => {
      assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
      resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
      const { sb } = fakeDb({
        partialRows: [
          {
            client_id: 'cts',
            page_id: PAGE_ID,
            updated_at: '2026-09-20T00:00:00Z',
            comment_created_at: '2026-09-01T00:00:00Z', // 27 天前，超过默认 7 天回看窗口
          },
        ],
      })
      const items: ManualItem[] = []
      await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
      expect(items).toHaveLength(1)
      expect(items[0].what).toContain('1 条失败一两次后还没到重试上限就先超出了系统回看评论的时间窗口')
      expect(items[0].how).toContain('超出回看窗口的这些同样要手动回')
      expect(items[0].how).toContain('不会因为权限修好就自动重新处理')
    })

    it('评论发出时间还在回看窗口内 → 不算卡死（下一轮正常会重试）', async () => {
      const { sb } = fakeDb({
        partialRows: [
          {
            client_id: 'cts',
            page_id: PAGE_ID,
            updated_at: '2026-09-27T00:00:00Z',
            comment_created_at: '2026-09-26T00:00:00Z', // 2 天前，在默认 7 天回看窗口内
          },
        ],
      })
      const items: ManualItem[] = []
      await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
      expect(items).toEqual([])
    })

    it('按这个客户实际配置的回看天数判断，不是写死 7 天', async () => {
      assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
      resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
      const { sb } = fakeDb({
        partialRows: [
          {
            client_id: 'cts',
            page_id: PAGE_ID,
            updated_at: '2026-09-20T00:00:00Z',
            comment_created_at: '2026-09-19T00:00:00Z', // 9 天前
          },
        ],
        lookbackDays: { cts: 30 }, // 这个客户配的是 30 天，9 天前还在窗口内
      })
      const items: ManualItem[] = []
      await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
      expect(items).toEqual([]) // 30 天窗口内，不算卡死
    })

    it('"卡了几天"按 updated_at（进入当前状态的时间）算，不按 comment_created_at（评论发出时间）算', async () => {
      assessConfiguredPageMock.mockResolvedValue({ verified: false, reason: 'check_failed' })
      resolveMetaTokenDetailedMock.mockResolvedValue({ token: 'tok', source: 'client_page' })
      const { sb } = fakeDb({
        partialRows: [
          {
            client_id: 'cts',
            page_id: PAGE_ID,
            updated_at: '2026-09-26T00:00:00Z', // 系统 2 天前才最后碰过这一行
            comment_created_at: '2026-08-01T00:00:00Z', // 评论本身 58 天前发的
          },
        ],
      })
      const items: ManualItem[] = []
      await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
      expect(items[0].what).toContain('2 天')
      expect(items[0].what).not.toContain('58 天')
    })
  })

  it('令牌是存量 OAuth（client_oauth）→ how 指向重新连接 Meta，不指向 Render 环境变量', async () => {
    assessConfiguredPageMock.mockResolvedValue({ verified: true, via: 'client_oauth' })
    const { sb } = fakeDb({
      exhaustedRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-01T00:00:00Z' }],
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
      exhaustedRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-01T00:00:00Z' }],
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
      exhaustedRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-01T00:00:00Z' }],
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
      exhaustedRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-01T00:00:00Z' }],
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
      exhaustedRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-01T00:00:00Z' }],
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
      exhaustedRows: [{ client_id: 'cts', page_id: PAGE_ID, updated_at: '2026-09-01T00:00:00Z' }],
    })
    const items: ManualItem[] = []
    await pushCommentAutoreplyStuckItems(sb, items, NOW, nameOf, ['cts'])
    expect(items).toHaveLength(1)
    expect(items[0].how).toContain('Render 后台')
  })

  it('按 activeClientIds 过滤查询（四条 engagements 查询 + 一条 lookback_days 查询都要过滤）', async () => {
    const { sb, inSpy, configInSpy } = fakeDb({})
    await pushCommentAutoreplyStuckItems(sb, [], NOW, nameOf, ['cts', 'nal'])
    expect(inSpy).toHaveBeenCalledWith('client_id', ['cts', 'nal'])
    expect(inSpy).toHaveBeenCalledTimes(4) // 耗尽 failed / dm_sent / processing / 没耗尽 failed 各一次
    expect(configInSpy).toHaveBeenCalledWith(['cts', 'nal'])
  })

  it('failed 分支读取失败 → 抛错（调用方用 .catch 兜底，这里不吞）', async () => {
    const { sb } = fakeDb({ errorMessage: 'boom' })
    await expect(pushCommentAutoreplyStuckItems(sb, [], NOW, nameOf, ['cts'])).rejects.toThrow('boom')
  })
})
