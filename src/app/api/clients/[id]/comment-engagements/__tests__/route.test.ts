/**
 * `?stuck=1` 分支的测试（Codex round 7 复审 P1：默认 `?limit=` 只是一个按
 * `created_at` 倒序的近期窗口，卡死很久的评论永远翻不到，它唯一的关闭动作
 * ——CommentAuditList.tsx 的「标记已阅」——因此永远点不到）。
 *
 * 假 supabase 真的按每一步 `.eq()/.gte()/.is()/.lt()` 过滤——固定返回数组的
 * 假件会让"漏了某个过滤条件"这类错法全部测绿。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STALE_PROCESSING_MS } from '@/lib/social/comment-autoreply-constants'

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
 * PATCH 专用假数据——跟 GET `?stuck=1` 用的 `rows` 完全分开，互不干扰。
 * `patchUpdateMatches` 模拟"带 `.eq('updated_at', expected)` 的条件更新是否
 * 命中"：真实数据库里这由 Postgres 判断，这里直接由测试指定结果，只验证路由
 * 在命中/不命中两种情况下各自的响应对不对。
 */
let patchLookupRow: { id: string; client_id: string; page_id: string; public_reply_id: string | null; reply_status: string; updated_at: string } | null = null
let patchUpdateMatches = true
let capturedPatchUpdate: Record<string, unknown> | null = null
let patchUpdateEqCalls: Array<[string, unknown]> = []

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
  const updateChain = {
    eq: (col: string, val: unknown) => {
      patchUpdateEqCalls.push([col, val])
      return updateChain
    },
    select: () => updateChain,
    maybeSingle: async () => ({
      data: patchUpdateMatches ? { id: patchLookupRow?.id ?? 'row' } : null,
      error: null,
    }),
  }
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
    // PATCH 的行查找：`.select(...).eq('id',...).eq('client_id',...).maybeSingle()`
    maybeSingle: async () => ({ data: patchLookupRow, error: null }),
    // PATCH 的写入：`.update(...).eq('id',...)[.eq('updated_at',...)].select(...).maybeSingle()`
    update: (payload: Record<string, unknown>) => {
      capturedPatchUpdate = payload
      return updateChain
    },
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

async function PATCH_engagement(
  clientId: string,
  body: { engagement_id: string; action: string; reviewer?: string; expected_updated_at?: string },
) {
  const { PATCH } = await import('../route')
  const req = new NextRequest(`http://localhost/api/clients/${clientId}/comment-engagements`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  const res = await PATCH(req, { params: Promise.resolve({ id: clientId }) })
  return { res, body: (await res.json()) as { success?: boolean; stale?: boolean; error?: string; action?: string } }
}

/**
 * `mark_reviewed` 的乐观并发锁（Codex round 17 复审 P2）：`finalise()`（round
 * 16）已经在这次重试完成时清空 `reviewed_at`，但如果 FDE 基于还没刷新的旧
 * 页面点了"标记已阅"、这次点击的请求在网络上被延迟，等它真正到达服务端时
 * `finalise()` 可能已经先跑完了——前端没法靠自己判断这次点击是不是基于过时
 * 状态，只有服务端能在写入那一刻用 `updated_at` 是否还等于点击时看到的那个
 * 值来判断"这行在点击之后有没有被动过"。
 */
describe('PATCH .../comment-engagements（mark_reviewed）', () => {
  beforeEach(() => {
    patchLookupRow = {
      id: 'e1', client_id: 'cts', page_id: '1616575215312482', public_reply_id: null,
      reply_status: 'failed', updated_at: FAR_PAST,
    }
    patchUpdateMatches = true
    capturedPatchUpdate = null
    patchUpdateEqCalls = []
  })

  it('没传 expected_updated_at → 走原来的无条件更新，不加 updated_at 过滤', async () => {
    const { res, body } = await PATCH_engagement('cts', { engagement_id: 'e1', action: 'mark_reviewed' })
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, action: 'mark_reviewed' })
    expect(patchUpdateEqCalls.some(([col]) => col === 'updated_at')).toBe(false)
    expect(capturedPatchUpdate).toMatchObject({ needs_human: false, reviewed_at: expect.any(String) })
  })

  it('传了 expected_updated_at 且行没被动过 → 正常写入成功', async () => {
    patchUpdateMatches = true
    const { res, body } = await PATCH_engagement('cts', {
      engagement_id: 'e1', action: 'mark_reviewed', expected_updated_at: '2026-09-28T00:00:00Z',
    })
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, action: 'mark_reviewed' })
    expect(patchUpdateEqCalls).toContainEqual(['updated_at', '2026-09-28T00:00:00Z'])
  })

  it('传了 expected_updated_at 但行在点击之后被动过（比如系统重试改了它）→ 拒绝写入、返回 409 + stale', async () => {
    patchUpdateMatches = false
    const { res, body } = await PATCH_engagement('cts', {
      engagement_id: 'e1', action: 'mark_reviewed', expected_updated_at: '2026-09-28T00:00:00Z',
    })
    expect(res.status).toBe(409)
    expect(body).toMatchObject({ success: false, stale: true })
    expect(body.error).toContain('已经变化')
  })

  it('查不到这一行（比如已经被删）→ 404，不碰乐观锁逻辑', async () => {
    patchLookupRow = null
    const { res, body } = await PATCH_engagement('cts', { engagement_id: 'e1', action: 'mark_reviewed' })
    expect(res.status).toBe(404)
    expect(body.error).toBeTruthy()
  })

  // Codex round 18 复审 P2：乐观锁堵的是"点击之后行被动过"，堵不住"这次执行
  // 根本没跑到 finalise() 就崩了"——那样 updated_at 永远不会再变，24 小时后
  // 这行变成真正的 stale_processing，可乐观锁看 updated_at 没变化，照样放行。
  // 这条待处理的行本身还在 processing、还没到宽限期，不该被判定为可以标记
  // 已阅——不管传不传 expected_updated_at，都要拒绝。
  it('行当前就是还在正常处理中的 processing（没到宽限期）→ 直接拒绝，不看 expected_updated_at 匹不匹配', async () => {
    patchLookupRow = {
      id: 'e1', client_id: 'cts', page_id: '1616575215312482', public_reply_id: null,
      reply_status: 'processing', updated_at: new Date().toISOString(), // 刚认领，远没到宽限期
    }
    const { res, body } = await PATCH_engagement('cts', {
      engagement_id: 'e1', action: 'mark_reviewed', expected_updated_at: new Date().toISOString(),
    })
    expect(res.status).toBe(409)
    expect(body).toMatchObject({ success: false, processing: true })
    expect(capturedPatchUpdate).toBeNull() // 从没走到写入那一步
  })

  it('行是 processing 但已经超过宽限期（真正卡死）→ 正常走乐观锁逻辑，不被这条新规则拦下', async () => {
    patchLookupRow = {
      id: 'e1', client_id: 'cts', page_id: '1616575215312482', public_reply_id: null,
      reply_status: 'processing', updated_at: FAR_PAST,
    }
    const { res, body } = await PATCH_engagement('cts', { engagement_id: 'e1', action: 'mark_reviewed' })
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ success: true, action: 'mark_reviewed' })
  })

  it('宽限期的边界：刚好卡在 STALE_PROCESSING_MS 之内 1 秒 → 仍然拒绝', async () => {
    patchLookupRow = {
      id: 'e1', client_id: 'cts', page_id: '1616575215312482', public_reply_id: null,
      reply_status: 'processing', updated_at: new Date(Date.now() - STALE_PROCESSING_MS + 1000).toISOString(),
    }
    const { res, body } = await PATCH_engagement('cts', { engagement_id: 'e1', action: 'mark_reviewed' })
    expect(res.status).toBe(409)
    expect(body).toMatchObject({ processing: true })
  })
})
