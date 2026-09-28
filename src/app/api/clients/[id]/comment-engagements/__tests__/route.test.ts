/**
 * `?stuck=1` 分支的测试（Codex round 7 复审 P1：默认 `?limit=` 只是一个按
 * `created_at` 倒序的近期窗口，卡死很久的评论永远翻不到，它唯一的关闭动作
 * ——CommentAuditList.tsx 的「标记已阅」——因此永远点不到）。
 *
 * 假 supabase 真的按每一步 `.eq()/.gte()/.is()/.lt()` 过滤——固定返回数组的
 * 假件会让"漏了某个过滤条件"这类错法全部测绿。
 */

import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({
  requireDashboardClientAccess: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({ getPageAccessToken: vi.fn() }))
vi.mock('@/lib/meta/comments', () => ({ deleteComment: vi.fn() }))

interface Row {
  id: string
  client_id: string
  reply_status: string
  attempts: number
  public_reply_id: string | null
  updated_at: string
  reviewed_at: string | null
  created_at: string
  /** 只有"重试没耗尽"这条分支需要——判断是否已越过回看窗口。 */
  comment_created_at: string
}

let rows: Row[] = []
/** `social_comment_config.lookback_days`——缺省时路由退回 DEFAULT_LOOKBACK_DAYS=7。 */
let configLookbackDays: number | null = null
/** `social_comment_config` 查询本身失败时用——Codex round 14 复审 P2 新增分支。 */
let configError: { message: string } | null = null

// 2099 远到不可能被任何真实回看窗口越过——用来标"肯定还在窗口内"，跟文件
// 里既有的 2020-01-01（"肯定已经过期/卡死"）配对，不依赖测试跑的时候真实
// 系统时间具体是哪天（Codex round 13 复审 P1 新增分支同样按 Date.now() 走，
// 沿用这个文件原有的写法，不引入新的可注入 now 参数）。
const FAR_FUTURE = '2099-01-01T00:00:00Z'
const FAR_PAST = '2020-01-01T00:00:00Z'

function row(over: Partial<Row>): Row {
  return {
    id: 'e0',
    client_id: 'cts',
    reply_status: 'replied',
    attempts: 1,
    public_reply_id: 'fb_1',
    updated_at: '2026-09-01T00:00:00Z',
    reviewed_at: null,
    created_at: '2026-09-01T00:00:00Z',
    comment_created_at: FAR_FUTURE,
    ...over,
  }
}

/**
 * 每次 `.from()` 都开一条独立的假查询链，按已挂的过滤器真的筛一遍 `rows`。
 * `.range()` 直接忽略 from/to、一次性把筛完的结果全部返回——假数据集永远
 * 远小于 `fetchAll` 的单页上限（1000 行），第一页就会不满页提前返回，等价
 * 于真实分页跑到底（Codex round 14 复审 P2：路由改用 `fetchAll` 而不是
 * `.limit(200)` 后，没有 `.range()` 这个方法会直接抛错，所有 stuck 测试都
 * 会失败——这本身就是"确实换成了 fetchAll，不是嘴上说说"的回归覆盖）。
 */
function makeEngagementsChain() {
  const filters: Array<(r: Row) => boolean> = []
  const chain = {
    select: () => chain,
    eq: (col: keyof Row, val: unknown) => {
      filters.push((r) => r[col] === val)
      return chain
    },
    gte: (col: keyof Row, val: number) => {
      filters.push((r) => (r[col] as number) >= val)
      return chain
    },
    lt: (col: keyof Row, val: string) => {
      filters.push((r) => (r[col] as string) < val)
      return chain
    },
    is: (col: keyof Row, val: null) => {
      filters.push((r) => r[col] === val)
      return chain
    },
    order: () => chain,
    range: () => chain,
    then: (resolve: (v: { data: Row[] | null; error: { message: string } | null }) => void) => {
      resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null })
    },
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'social_comment_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: configError ? null : configLookbackDays === null ? null : { lookback_days: configLookbackDays },
                error: configError,
              }),
            }),
          }),
        }
      }
      return makeEngagementsChain()
    },
  },
}))

async function GET_stuck(clientId: string) {
  const { GET } = await import('../route')
  const req = new NextRequest(`http://localhost/api/clients/${clientId}/comment-engagements?stuck=1`)
  const res = await GET(req, { params: Promise.resolve({ id: clientId }) })
  return (await res.json()) as { engagements: Row[] }
}

describe('GET .../comment-engagements?stuck=1', () => {
  it('failed 且重试耗尽 → 返回', async () => {
    rows = [row({ id: 'e1', reply_status: 'failed', attempts: 3 })]
    const { engagements } = await GET_stuck('cts')
    expect(engagements.map((r) => r.id)).toEqual(['e1'])
  })

  it('failed 但还没耗尽重试、评论还在回看窗口内 → 不返回（下一轮正常会重试）', async () => {
    rows = [row({ id: 'e1', reply_status: 'failed', attempts: 2, comment_created_at: FAR_FUTURE })]
    const { engagements } = await GET_stuck('cts')
    expect(engagements).toEqual([])
  })

  it('dm_sent 且没有公开回复 id → 返回', async () => {
    rows = [row({ id: 'e2', reply_status: 'dm_sent', public_reply_id: null })]
    const { engagements } = await GET_stuck('cts')
    expect(engagements.map((r) => r.id)).toEqual(['e2'])
  })

  it('processing 且超过宽限期 → 返回', async () => {
    rows = [row({ id: 'e3', reply_status: 'processing', updated_at: FAR_PAST })]
    const { engagements } = await GET_stuck('cts')
    expect(engagements.map((r) => r.id)).toEqual(['e3'])
  })

  it('已经标记已阅（reviewed_at 有值）→ 不返回，不管多卡', async () => {
    rows = [row({ id: 'e4', reply_status: 'failed', attempts: 3, reviewed_at: '2026-09-20T00:00:00Z' })]
    const { engagements } = await GET_stuck('cts')
    expect(engagements).toEqual([])
  })

  it('replied → 不返回', async () => {
    rows = [row({ id: 'e5', reply_status: 'replied' })]
    const { engagements } = await GET_stuck('cts')
    expect(engagements).toEqual([])
  })

  it('不管多旧都返回——这是这条分支存在的意义（不受 created_at 近期窗口限制）', async () => {
    rows = [row({ id: 'e6', reply_status: 'failed', attempts: 3, created_at: FAR_PAST })]
    const { engagements } = await GET_stuck('cts')
    expect(engagements.map((r) => r.id)).toEqual(['e6'])
  })

  it('别的客户的卡死行不会混进来', async () => {
    rows = [row({ id: 'e7', client_id: 'other', reply_status: 'failed', attempts: 3 })]
    const { engagements } = await GET_stuck('cts')
    expect(engagements).toEqual([])
  })

  it('三类各一条 → 三条都返回、去重后不重复', async () => {
    rows = [
      row({ id: 'e1', reply_status: 'failed', attempts: 3 }),
      row({ id: 'e2', reply_status: 'dm_sent', public_reply_id: null }),
      row({ id: 'e3', reply_status: 'processing', updated_at: FAR_PAST }),
    ]
    const { engagements } = await GET_stuck('cts')
    expect(engagements.map((r) => r.id).sort()).toEqual(['e1', 'e2', 'e3'])
  })

  // Codex round 13 复审 P1：round 12 给 pm-todo 检测通道加了第 4 类（重试没耗尽但
  // 越过回看窗口），但这条审计路由还停在旧的 3 类定义——这类行在检测通道里算
  // 卡死、待办也会下发，可这里却查不到它，"标记已阅"点不到，待办永久重复。
  describe('越过回看窗口、还没耗尽重试次数的 failed 行（第 4 类）', () => {
    it('评论发出时间早于回看窗口 → 返回', async () => {
      configLookbackDays = null // 用默认 7 天
      rows = [row({ id: 'e8', reply_status: 'failed', attempts: 1, comment_created_at: FAR_PAST })]
      const { engagements } = await GET_stuck('cts')
      expect(engagements.map((r) => r.id)).toEqual(['e8'])
    })

    it('评论发出时间还在回看窗口内 → 不返回', async () => {
      configLookbackDays = null
      rows = [row({ id: 'e9', reply_status: 'failed', attempts: 1, comment_created_at: FAR_FUTURE })]
      const { engagements } = await GET_stuck('cts')
      expect(engagements).toEqual([])
    })

    it('按这个客户配置的回看天数判断，不是写死的默认值', async () => {
      // 配了很短的回看窗口（1 天）——2020 年那条评论无论如何都早已越窗，
      // 用来确认真的读了 social_comment_config，而不是忽略配置只走默认值。
      configLookbackDays = 1
      rows = [row({ id: 'e10', reply_status: 'failed', attempts: 1, comment_created_at: FAR_PAST })]
      const { engagements } = await GET_stuck('cts')
      expect(engagements.map((r) => r.id)).toEqual(['e10'])
    })

    it('已经标记已阅 → 不返回，即使已经越窗', async () => {
      configLookbackDays = null
      rows = [
        row({
          id: 'e11', reply_status: 'failed', attempts: 1,
          comment_created_at: FAR_PAST, reviewed_at: '2026-09-20T00:00:00Z',
        }),
      ]
      const { engagements } = await GET_stuck('cts')
      expect(engagements).toEqual([])
    })

    it('四类各一条 → 四条都返回', async () => {
      configLookbackDays = null
      rows = [
        row({ id: 'e1', reply_status: 'failed', attempts: 3 }),
        row({ id: 'e2', reply_status: 'dm_sent', public_reply_id: null }),
        row({ id: 'e3', reply_status: 'processing', updated_at: FAR_PAST }),
        row({ id: 'e4', reply_status: 'failed', attempts: 1, comment_created_at: FAR_PAST }),
      ]
      const { engagements } = await GET_stuck('cts')
      expect(engagements.map((r) => r.id).sort()).toEqual(['e1', 'e2', 'e3', 'e4'])
    })
  })

  // Codex round 14 复审 P2：配置查询本身失败（不是"没配置这一行"）时，之前的
  // 实现会忽略 config.error、照样按默认 7 天分类——客户实际配了更长的窗口时，
  // 一条还在窗口内、本该下一轮正常重试的行会被误判成越窗、显示"标记已阅"，
  // 点了就写死 reviewed_at，之后这行真耗尽重试或真越窗时会被检测器永久滤掉。
  describe('social_comment_config 查询失败（不是没配置）', () => {
    it('config 查询报错 → 整个请求失败，不能静默退回默认 7 天', async () => {
      configLookbackDays = null
      configError = { message: 'social_comment_config read failed' }
      rows = [row({ id: 'e13', reply_status: 'failed', attempts: 1, comment_created_at: FAR_PAST })]
      await expect(GET_stuck('cts')).rejects.toThrow('social_comment_config read failed')
      configError = null
    })
  })
})
