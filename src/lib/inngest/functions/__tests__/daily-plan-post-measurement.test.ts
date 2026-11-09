/**
 * Act → Check 闭环的业务行为。
 *
 * 只测能抓真实事故的：假事件结构被接受、预排帖子被提前测、读不到被写成 0、
 * 一个窗口失败拖垮另一个、重放产生重复行、别人的帖子被记进这个客户的账。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DailyPlanPostPublishedEventSchema,
  measurementEventId,
  measurementSchedule,
} from '@/lib/campaign/daily-plan-publish'
import { checkIsolation, summariseRead } from '../daily-plan-post-measurement'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const PAGE = '1616575215312482'
const POST = `${PAGE}_1750182150247306`
const KEY = 'campaign_daily::c0000000::2026-09-03::post'

/** 真实事件 —— 字段与发布路由 sendInngestEvent 的 data 一一对应。 */
function realEvent(over: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT,
    campaign_id: '6612eabf-dd7e-47f0-bcc4-e6a7fd813aea',
    plan_id: 'f166a5c0-b2df-478c-8b04-1168ef2d3641',
    plan_revision: '2026-09-01T15:00:04.513Z',
    review_revision: '40b720ac-dfe4-44b6-8192-6f3f93ad3bdb',
    date: '2026-09-03',
    idempotency_key: KEY,
    post_id: POST,
    page_id: PAGE,
    published_at: '2026-09-03T06:00:00.000Z',
    permalink: 'https://www.facebook.com/CTSTOURS/posts/abc',
    measure_at: [
      { hours: 4, at: '2026-09-03T10:00:00.000Z' },
      { hours: 72, at: '2026-09-06T06:00:00.000Z' },
    ],
    ...over,
  }
}

describe('事件契约', () => {
  it('1. 真实扁平事件被接受', () => {
    const r = DailyPlanPostPublishedEventSchema.safeParse(realEvent())
    expect(r.success).toBe(true)
  })

  it('2. 🔴 published[0] 那种假结构被拒绝', () => {
    const fake = {
      client_id: CLIENT,
      published: [{ post_id: POST, idempotency_key: KEY, page_id: PAGE }],
    }
    expect(DailyPlanPostPublishedEventSchema.safeParse(fake).success).toBe(false)
  })

  it('3. 🔴 预排帖子的测量时刻来自事件，不是 published_at + 偏移', () => {
    // 提交时刻 9/3 06:00，但排到 9/5 20:00 才公开。
    const scheduled = '2026-09-05T20:00:00.000Z'
    const ev = realEvent({
      published_at: '2026-09-03T06:00:00.000Z',
      scheduled_publish_time: scheduled,
      measure_at: measurementSchedule(scheduled),
    })
    const parsed = DailyPlanPostPublishedEventSchema.parse(ev)

    // T+4 必须锚在公开时刻，不是提交时刻。若谁改成从 published_at 重算，这里会红。
    expect(parsed.measure_at[0].at).toBe('2026-09-06T00:00:00.000Z')
    const fromPublished = new Date(Date.parse(parsed.published_at) + 4 * 3600_000).toISOString()
    expect(parsed.measure_at[0].at).not.toBe(fromPublished)
  })

  it('拒绝重复窗口、非法时间、超界数量', () => {
    expect(
      DailyPlanPostPublishedEventSchema.safeParse(
        realEvent({ measure_at: [{ hours: 4, at: '2026-09-03T10:00:00.000Z' }, { hours: 4, at: '2026-09-03T11:00:00.000Z' }] }),
      ).success,
    ).toBe(false)

    expect(
      DailyPlanPostPublishedEventSchema.safeParse(realEvent({ measure_at: [{ hours: 4, at: 'not-a-time' }] })).success,
    ).toBe(false)

    expect(
      DailyPlanPostPublishedEventSchema.safeParse(
        realEvent({ measure_at: [1, 2, 3, 4, 5].map(h => ({ hours: h, at: '2026-09-03T10:00:00.000Z' })) }),
      ).success,
    ).toBe(false)
  })

  it('🔴 拒绝异常遥远的测量时刻 —— 别把 durable run 停放几年', () => {
    expect(
      DailyPlanPostPublishedEventSchema.safeParse(
        realEvent({ measure_at: [{ hours: 4, at: '2029-01-01T00:00:00.000Z' }] }),
      ).success,
    ).toBe(false)
  })

  it('4. fan-out 的内部事件 id 稳定且按窗口区分', () => {
    expect(measurementEventId(KEY, 4)).toBe(`${KEY}:measurement:4`)
    expect(measurementEventId(KEY, 72)).toBe(`${KEY}:measurement:72`)
    // 同输入必须同输出 —— 重放才不会产生第二个 run。
    expect(measurementEventId(KEY, 4)).toBe(measurementEventId(KEY, 4))
  })
})

describe('隔离：客户 / 主页 / 帖子必须自洽', () => {
  it('7. 🔴 客户登记的主页与事件不符 → 拒，不读 Graph、不记动作', () => {
    const r = checkIsolation('999999999', { page_id: PAGE, post_id: POST })
    expect(r).toEqual({ ok: false, reason: 'page_mismatch' })
  })

  it('8. 🔴 post_id 不属于这个主页 → fail-closed', () => {
    const r = checkIsolation(PAGE, { page_id: PAGE, post_id: '999999999_123' })
    expect(r).toEqual({ ok: false, reason: 'post_not_on_page' })
  })

  it('客户没登记主页 → 拒（不是「随便用一个」）', () => {
    expect(checkIsolation(null, { page_id: PAGE, post_id: POST })).toEqual({
      ok: false,
      reason: 'client_page_unknown',
    })
  })

  it('三者自洽才放行', () => {
    expect(checkIsolation(PAGE, { page_id: PAGE, post_id: POST })).toEqual({ ok: true })
  })
})

describe('读取结果 → 回执', () => {
  it('9. 完整成功：三个数字，status = ok，missing 为空', () => {
    const s = summariseRead({
      reactions: { kind: 'value', value: 10 },
      comments: { kind: 'value', value: 2 },
      shares: { kind: 'value', value: 1 },
    })
    expect(s.status).toBe('ok')
    expect(s.values).toEqual({ likes: 10, comments: 2, shares: 1 })
    expect(s.missing).toEqual({})
  })

  it('10. 部分成功：只带明确的数字，缺的进 missing', () => {
    const s = summariseRead({
      reactions: { kind: 'value', value: 10 },
      comments: { kind: 'absent' },
      shares: { kind: 'value', value: 1 },
    })
    expect(s.status).toBe('partial')
    expect(s.values).toEqual({ likes: 10, shares: 1 })
    expect(s.missing).toEqual({ comments: 'field_absent' })
  })

  it('11. 🔴 shares 缺席不写 0 —— values 里根本没有 shares 这一项', () => {
    const s = summariseRead({
      reactions: { kind: 'value', value: 5 },
      comments: { kind: 'value', value: 0 },
      shares: { kind: 'omitted_unverified' },
    })
    expect(s.values).not.toHaveProperty('shares')
    expect(s.missing.shares).toBe('omitted_unverified')
    // comments 的 0 是 Meta 真返回的 0，必须保留 —— 跟 shares 的缺席完全不同。
    expect(s.values.comments).toBe(0)
    expect(s.status).toBe('partial')
  })
})

// ─── P1 回归（Codex #1399）─────────────────────────────────────────────────
import { readRegisteredPageId, readGraphOnce } from '../daily-plan-post-measurement'

/** 只对 clients 表建模；其他一律炸。 */
function clientsDb(opts: { data?: unknown; error?: unknown }) {
  return {
    from(table: string) {
      if (table !== 'clients') throw new Error(`unexpected table ${table}`)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = () => Promise.resolve({ data: opts.data ?? null, error: opts.error ?? null })
      return chain
    },
  } as never
}

describe('P1: readRegisteredPageId —— DB 错误不能塌成 client_page_unknown', () => {
  it('🔴 Supabase 返回 error → 抛出，让 Inngest 有界重试', async () => {
    await expect(
      readRegisteredPageId(clientsDb({ error: { message: 'connection timeout' } }), CLIENT),
    ).rejects.toThrow(/db error.*connection timeout/)
  })

  it('查询成功、客户不存在 → null（可以合法结案）', async () => {
    expect(await readRegisteredPageId(clientsDb({ data: null }), CLIENT)).toBeNull()
  })

  it('查询成功、字段真的空 → null', async () => {
    expect(await readRegisteredPageId(clientsDb({ data: { facebook_page_id: null } }), CLIENT)).toBeNull()
  })

  it('查询成功、字段有值 → 返回该值', async () => {
    expect(await readRegisteredPageId(clientsDb({ data: { facebook_page_id: PAGE } }), CLIENT)).toBe(PAGE)
  })
})

// ─── P3 事故回归：Graph 数字在重试之间变化，快照不能被覆盖 ───────────────────
//
// 消费者层测 readGraphOnce 拆成独立 step（成功后被 Inngest 记忆化，重放同 run 不
// 再问 Graph）；快照 hash 不匹配的拒绝语义在 store 层的 recordSnapshot 里测
// （`hash_mismatch` 分支），并在真 PostgreSQL 里用 RPC 直接实测（migration
// 验证脚本 P3-3：hash_v1 写入后 hash_v2 会话被 RPC 抛 check_violation 拒）。
