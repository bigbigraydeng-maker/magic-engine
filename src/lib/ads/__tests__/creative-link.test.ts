/**
 * 广告 ↔ 我们自己的片子。钉住的四件事:
 *
 *   1. **建广告时必须记下素材 id** —— 不记就是每天在丢数据,断链就是这么来的
 *   2. **认不出来就留空,绝不猜** —— 尤其「命中多条挑一条」也算猜
 *   3. **认不出来照样落一行** —— 静默跳过 = 缺口不可数 = 又一次静默失败
 *   4. **永不抛异常** —— 调用它时广告已经在 Meta 上建出来了,抛出去会触发重建花钱
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase'
import {
  AD_CREATION_PATHS,
  decideCreativeLink,
  linkAdToCreative,
  lookupCreativeRefByAdId,
  normalisePostId,
  type CreativeCandidate,
} from '../creative-link'

const CLIENT = 'client-oztop'

const candidate = (creativeRef: string, postId: string): CreativeCandidate => ({
  creativeRef,
  creativeSource: 'content_work_order',
  postId,
})

// ── DB 替身 ──────────────────────────────────────────────────────────────────
let linkUpserts: Record<string, unknown>[]
let upsertOptions: Record<string, unknown>[]

interface MockDbOptions {
  /** content_work_orders 里已发布的行(published_ref.post_id)。 */
  workOrders?: Array<{ id: string; published_ref: unknown }>
  /** 查工单直接报错(模拟 DB 抖动)。 */
  workOrderError?: string
  /** 写 ad_creative_links 报错。 */
  upsertError?: string
  /** lookupCreativeRefByAdId 读到的行。 */
  linkRow?: { creative_ref: unknown } | null
  lookupError?: string
}

function mockDb(opts: MockDbOptions = {}) {
  linkUpserts = []
  upsertOptions = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'content_work_orders') {
      return {
        select: () => ({
          eq: () => ({
            not: () =>
              Promise.resolve(
                opts.workOrderError
                  ? { data: null, error: { message: opts.workOrderError } }
                  : { data: opts.workOrders ?? [], error: null },
              ),
          }),
        }),
      }
    }
    if (table === 'ad_creative_links') {
      return {
        upsert: (row: Record<string, unknown>, o: Record<string, unknown>) => {
          linkUpserts.push(row)
          upsertOptions.push(o)
          return Promise.resolve({
            error: opts.upsertError ? { message: opts.upsertError } : null,
          })
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve(
                    opts.lookupError
                      ? { data: null, error: { message: opts.lookupError } }
                      : { data: opts.linkRow ?? null, error: null },
                  ),
              }),
            }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── 纯函数:normalisePostId ───────────────────────────────────────────────────
describe('normalisePostId', () => {
  it('带页前缀和裸 id 归一到同一个值 —— 否则同一个帖子会被当成两个', () => {
    expect(normalisePostId('748077268383005_1004101655665734')).toBe('1004101655665734')
    expect(normalisePostId('1004101655665734')).toBe('1004101655665734')
  })
})

// ── 纯函数:decideCreativeLink(「绝不猜」的唯一落点)──────────────────────────
describe('decideCreativeLink', () => {
  it('精确命中一条 → 认出来', () => {
    const link = decideCreativeLink('1004101655665734', [
      candidate('wo-1', '1004101655665734'),
      candidate('wo-2', '999'),
    ])
    expect(link).toMatchObject({
      creativeRef: 'wo-1',
      creativeSource: 'content_work_order',
      linkMethod: 'published_post_id',
      unresolvedReason: null,
    })
  })

  it('带页前缀的入参也能命中裸 post_id 的工单', () => {
    const link = decideCreativeLink('748077268383005_1004101655665734', [
      candidate('wo-1', '1004101655665734'),
    ])
    expect(link.creativeRef).toBe('wo-1')
  })

  /**
   * 变异闸 ②:把「拿不到就留空」改成任何猜测(取最近一条 / 取第一条 / 取唯一一条
   * 候选),这条都会红 —— 候选里有片子,但没有一条是这个帖子发出来的。
   */
  it('一条都没命中 → 留空,绝不拿别的片子顶上', () => {
    const link = decideCreativeLink('1004101655665734', [
      candidate('wo-recent', '888'),
      candidate('wo-older', '777'),
    ])
    expect(link.creativeRef).toBeNull()
    expect(link.creativeSource).toBeNull()
    expect(link.linkMethod).toBe('unresolved')
    expect(link.unresolvedReason).toContain('1004101655665734')
  })

  it('候选一条都没有 → 留空', () => {
    expect(decideCreativeLink('123', []).creativeRef).toBeNull()
  })

  /** 命中多条也算拿不到:从中挑一条就是猜,猜出来的归因会让下游学出反的结论。 */
  it('命中多条 → 也留空(挑一条就是猜)', () => {
    const link = decideCreativeLink('123', [candidate('wo-a', '123'), candidate('wo-b', '123')])
    expect(link.creativeRef).toBeNull()
    expect(link.linkMethod).toBe('unresolved')
    expect(link.unresolvedReason).toContain('wo-a')
    expect(link.unresolvedReason).toContain('wo-b')
  })

  it('帖子 id 是空的 → 留空', () => {
    expect(decideCreativeLink('   ', [candidate('wo-1', '123')]).creativeRef).toBeNull()
  })
})

// ── 落库:linkAdToCreative ────────────────────────────────────────────────────
describe('linkAdToCreative', () => {
  it('认出来 → 落一行带 creative_ref 的对应关系', async () => {
    mockDb({ workOrders: [{ id: 'wo-1', published_ref: { post_id: '1004101655665734' } }] })

    const link = await linkAdToCreative({
      clientId: CLIENT,
      adId: 'ad-777',
      postId: '748077268383005_1004101655665734',
      pageId: '748077268383005',
      createdBy: 'boost_post_api',
    })

    expect(link.creativeRef).toBe('wo-1')
    expect(linkUpserts).toHaveLength(1)
    expect(linkUpserts[0]).toMatchObject({
      client_id: CLIENT,
      platform: 'meta',
      ad_id: 'ad-777',
      post_id: '748077268383005_1004101655665734',
      creative_ref: 'wo-1',
      creative_source: 'content_work_order',
      link_method: 'published_post_id',
      unresolved_reason: null,
      created_by: 'boost_post_api',
    })
    // 同一条广告重复记只更新,不叠行。
    expect(upsertOptions[0]).toMatchObject({ onConflict: 'client_id,platform,ad_id' })
  })

  /**
   * 变异闸 ③:把「认不出来就不写」当成实现,这条会红。缺口必须可数 ——
   * 不落行的缺口等于没发生,整条断链当初就是这么藏了三个月。
   */
  it('认不出来 → 照样落一行(creative_ref 留空 + 写明原因),不静默跳过', async () => {
    mockDb({ workOrders: [{ id: 'wo-other', published_ref: { post_id: '999' } }] })

    const link = await linkAdToCreative({
      clientId: CLIENT,
      adId: 'ad-888',
      postId: '1004101655665734',
      createdBy: 'winner_reel_sync',
    })

    expect(link.creativeRef).toBeNull()
    expect(linkUpserts).toHaveLength(1)
    expect(linkUpserts[0]).toMatchObject({
      ad_id: 'ad-888',
      creative_ref: null,
      creative_source: null,
      link_method: 'unresolved',
      created_by: 'winner_reel_sync',
    })
    expect(linkUpserts[0].unresolved_reason).toBeTruthy()
  })

  it('认不出来要吵 —— 静默跳过正是这条断链的根因', async () => {
    mockDb({ workOrders: [] })
    await linkAdToCreative({
      clientId: CLIENT,
      adId: 'ad-888',
      postId: '123',
      createdBy: 'boost_post_api',
    })
    expect(console.warn).toHaveBeenCalled()
  })

  it('查候选片子报错 → 留空并记原因,不抛(广告已建出,抛出去会触发重建花钱)', async () => {
    mockDb({ workOrderError: 'connection reset' })

    const link = await linkAdToCreative({
      clientId: CLIENT,
      adId: 'ad-999',
      postId: '123',
      createdBy: 'boost_post_api',
    })

    expect(link.creativeRef).toBeNull()
    expect(link.unresolvedReason).toContain('connection reset')
    expect(linkUpserts).toHaveLength(1)
  })

  /**
   * 写库不只会「返回 error」,也会**直接抛**(网络断、client 没初始化)。抛出去会被
   * 上层当成建广告失败 → 重试建广告 → 花钱建出重复广告。所以整段必须包住。
   */
  it('写库直接抛异常 → 也不往上抛,只记 error', async () => {
    mockDb({ workOrders: [{ id: 'wo-1', published_ref: { post_id: '123' } }] })
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === 'ad_creative_links') {
        return {
          upsert: () => {
            throw new TypeError('supabaseAdmin.from(...).upsert is not a function')
          },
        }
      }
      return {
        select: () => ({
          eq: () => ({ not: () => Promise.resolve({ data: [{ id: 'wo-1', published_ref: { post_id: '123' } }], error: null }) }),
        }),
      }
    })

    const link = await linkAdToCreative({
      clientId: CLIENT,
      adId: 'ad-999',
      postId: '123',
      createdBy: 'boost_post_api',
    })

    expect(link.creativeRef).toBe('wo-1')
    expect(console.error).toHaveBeenCalled()
  })

  it('落库失败 → 大声记 error,仍然不抛', async () => {
    mockDb({
      workOrders: [{ id: 'wo-1', published_ref: { post_id: '123' } }],
      upsertError: 'permission denied',
    })

    const link = await linkAdToCreative({
      clientId: CLIENT,
      adId: 'ad-999',
      postId: '123',
      createdBy: 'boost_post_api',
    })

    expect(link.creativeRef).toBe('wo-1')
    expect(console.error).toHaveBeenCalled()
  })

  it('工单的 published_ref 没有 post_id → 不当候选(而不是崩)', async () => {
    mockDb({
      workOrders: [
        { id: 'wo-half', published_ref: { provisional: true, video_id: 'v1' } },
        { id: 'wo-null', published_ref: null },
        { id: 'wo-ok', published_ref: { post_id: '123' } },
      ],
    })

    const link = await linkAdToCreative({
      clientId: CLIENT,
      adId: 'ad-1',
      postId: '123',
      createdBy: 'boost_post_api',
    })
    expect(link.creativeRef).toBe('wo-ok')
  })
})

// ── 归因读侧 ─────────────────────────────────────────────────────────────────
describe('lookupCreativeRefByAdId', () => {
  it('查得到 → 返回素材 id', async () => {
    mockDb({ linkRow: { creative_ref: 'wo-1' } })
    expect(await lookupCreativeRefByAdId(CLIENT, 'ad-777')).toBe('wo-1')
  })

  it('这条广告不是 ME 建的 → null', async () => {
    mockDb({ linkRow: null })
    expect(await lookupCreativeRefByAdId(CLIENT, 'ad-unknown')).toBeNull()
  })

  it('自然贴文的 lead 没有 ad_id → 不查库,直接 null', async () => {
    mockDb()
    expect(await lookupCreativeRefByAdId(CLIENT, null)).toBeNull()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('查库报错 → null,不抛(一条 lead 不该因为归因查不到就被丢掉)', async () => {
    mockDb({ lookupError: 'timeout' })
    expect(await lookupCreativeRefByAdId(CLIENT, 'ad-777')).toBeNull()
    expect(console.error).toHaveBeenCalled()
  })
})

// ── 建广告路径登记表 ─────────────────────────────────────────────────────────
describe('AD_CREATION_PATHS', () => {
  /**
   * 这条不是形式主义:AD_CREATION_PATHS 是 Record<AdCreationPath, string>,
   * 往 union 里加一条新的建广告路径而不登记就编译不过 —— 逼你在那一刻回答
   * 「这条路径记不记素材 id」,而不是三个月后发现表又空了。
   */
  it('仓里每条建广告的路径都登记在案', () => {
    expect(Object.keys(AD_CREATION_PATHS).sort()).toEqual(['boost_post_api', 'winner_reel_sync'])
  })
})
