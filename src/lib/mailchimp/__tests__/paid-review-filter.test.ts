/**
 * 「已经处理过的不再重复下发」这道过滤。
 *
 * 钉的是 PR #1484 声称实现、但实际没实现的那个闭环：写入侧过滤只挡住**当天**
 * 的运行记录，而今日待办读的是**最近 7 天所有**运行 —— PM 处理完，昨天的摘要
 * 里还有他，待办照样天天冒。这里在生成待办那一刻按真实标签再判一次。
 *
 * 失败方向刻意不对称：查不出来一律**保留**。多提醒一次只是烦；漏掉一条真的
 * 付款确认，客人会继续收到营销邮件（2026-09-01 那次 192 人群发就是这么出的事）。
 */

import { describe, it, expect, vi } from 'vitest'
import { dropAlreadyPaidTagged, type PaidReviewCandidate } from '../paid-review-filter'
import { DEFAULT_PAID_TAG } from '../paid-tagging'
import { subscriberHash } from '../tags'

const CLIENT_A = 'c0000000-0000-0000-0000-000000000000'
const CLIENT_B = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

/** 假 clients 表：按 clientId → { audienceId, leads_config } 建模。 */
function fakeSupabase(
  rows: Record<string, { audienceId?: string; paidTag?: string }>,
  opts: { columnMissing?: boolean; totalFailure?: boolean } = {},
) {
  return {
    from() {
      const chain: Record<string, unknown> = {}
      chain.select = (cols: string) => {
        chain._wantsColumn = cols.includes('mailchimp_audience_id')
        return chain
      }
      chain.in = () => {
        if (opts.totalFailure) return Promise.resolve({ data: null, error: { message: 'boom' } })
        // 专列不存在时第一次查询报 42703，调用方应退回只读 leads_config
        if (opts.columnMissing && chain._wantsColumn) {
          return Promise.resolve({ data: null, error: { code: '42703', message: 'no column' } })
        }
        const data = Object.entries(rows).map(([id, r]) => {
          const leads_config = {
            ...(r.paidTag ? { paid_tagging: { paid_tag: r.paidTag } } : {}),
            ...(opts.columnMissing && r.audienceId ? { mailchimp_audience_id: r.audienceId } : {}),
          }
          return chain._wantsColumn
            ? { id, mailchimp_audience_id: r.audienceId ?? '', leads_config }
            : { id, leads_config }
        })
        return Promise.resolve({ data, error: null })
      }
      return chain
    },
  } as never
}

/** 假 Mailchimp：邮箱 → 它当前的标签。名单里没有的返 404。 */
function fakeMailchimp(audience: Record<string, string[]>) {
  let calls = 0
  const fetchImpl = async (url: string): Promise<Response> => {
    calls += 1
    const hashToEmail = new Map(Object.keys(audience).map((e) => [subscriberHash(e), e]))
    const hash = url.split('/members/')[1]?.split(/[/?]/)[0] ?? ''
    const email = hashToEmail.get(hash)
    if (!email) return new Response(JSON.stringify({ title: 'Not Found' }), { status: 404 })
    return new Response(
      JSON.stringify({
        email_address: email,
        status: 'subscribed',
        tags: audience[email].map((name) => ({ name })),
      }),
      { status: 200 },
    )
  }
  return { fetchImpl, calls: () => calls }
}

const cand = (email: string, clientId = CLIENT_A): PaidReviewCandidate => ({ email, clientId })

describe('dropAlreadyPaidTagged', () => {
  it('bounds concurrent lookups and keeps every candidate on request timeout', async () => {
    let active = 0
    let peak = 0
    const fetchImpl = async (_url: string, init?: RequestInit): Promise<Response> => {
      active += 1
      peak = Math.max(peak, active)
      try {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')), { once: true })
        })
      } finally { active -= 1 }
    }
    const candidates = Array.from({ length: 6 }, (_, i) => cand(`person${i}@example.com`))
    const kept = await dropAlreadyPaidTagged(fakeSupabase({ [CLIENT_A]: { audienceId: 'aud1' } }), candidates,
      { apiKey: 'key-us19', fetchImpl, concurrency: 2, timeoutMs: 5 })
    expect(kept).toHaveLength(6)
    expect(peak).toBe(2)
    expect(active).toBe(0)
  })

  it('keeps unqueried candidates after the total lookup budget expires', async () => {
    let clock = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const fetchImpl = vi.fn(async () => {
      clock = 20
      return new Response(JSON.stringify({ tags: [{ name: DEFAULT_PAID_TAG }] }))
    })
    try {
      const kept = await dropAlreadyPaidTagged(fakeSupabase({ [CLIENT_A]: { audienceId: 'aud1' } }),
        [cand('paid@example.com'), cand('unqueried@example.com')],
        { apiKey: 'key-us19', fetchImpl, concurrency: 1, budgetMs: 10 })
      expect(kept.map(c => c.email)).toEqual(['unqueried@example.com'])
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally { now.mockRestore() }
  })

  it('🔴 PM 已经打过 paid_customer → 剔除，不再重复下发', async () => {
    const mc = fakeMailchimp({ 'nikki@example.com': ['fb_lead', DEFAULT_PAID_TAG] })
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({ [CLIENT_A]: { audienceId: 'aud1' } }),
      [cand('nikki@example.com')],
      { apiKey: 'key-us19', fetchImpl: mc.fetchImpl },
    )
    expect(kept).toHaveLength(0)
  })

  it('还没打标签 → 保留（回归：别把正常路径也过滤掉）', async () => {
    const mc = fakeMailchimp({ 'nikki@example.com': ['fb_lead'] })
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({ [CLIENT_A]: { audienceId: 'aud1' } }),
      [cand('nikki@example.com')],
      { apiKey: 'key-us19', fetchImpl: mc.fetchImpl },
    )
    expect(kept).toHaveLength(1)
  })

  it('认客户自己配的标签名，不是写死 paid_customer', async () => {
    // 这个客户把付费标签叫 vip：查 paid_customer 会永远不命中，过滤形同虚设
    const mc = fakeMailchimp({ 'v@example.com': ['vip'] })
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({ [CLIENT_A]: { audienceId: 'aud1', paidTag: 'vip' } }),
      [cand('v@example.com')],
      { apiKey: 'key-us19', fetchImpl: mc.fetchImpl },
    )
    expect(kept).toHaveLength(0)
  })

  it('不同客户各查各的 audience，不会串台', async () => {
    const mc = fakeMailchimp({
      'a@example.com': [DEFAULT_PAID_TAG],
      'b@example.com': ['fb_lead'],
    })
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({
        [CLIENT_A]: { audienceId: 'audA' },
        [CLIENT_B]: { audienceId: 'audB' },
      }),
      [cand('a@example.com', CLIENT_A), cand('b@example.com', CLIENT_B)],
      { apiKey: 'key-us19', fetchImpl: mc.fetchImpl },
    )
    expect(kept.map((k) => k.email)).toEqual(['b@example.com'])
  })

  it('同一批里重复的邮箱只查一次 Mailchimp', async () => {
    const mc = fakeMailchimp({ 'dup@example.com': ['fb_lead'] })
    await dropAlreadyPaidTagged(
      fakeSupabase({ [CLIENT_A]: { audienceId: 'aud1' } }),
      [cand('dup@example.com'), cand('DUP@example.com')],
      { apiKey: 'key-us19', fetchImpl: mc.fetchImpl },
    )
    expect(mc.calls()).toBe(1)
  })
})

describe('dropAlreadyPaidTagged · 🔴 查不出来一律保留（fail-open）', () => {
  it('does not use an old audience after a non-column configuration error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tags: [{ name: DEFAULT_PAID_TAG }] })))
    let queries = 0
    const db = { from: () => ({ select: () => ({ in: async () => {
      queries += 1
      return queries === 1
        ? { data: null, error: { code: '42501', message: 'permission denied' } }
        : { data: [{ id: CLIENT_A, leads_config: { mailchimp_audience_id: 'old-audience' } }], error: null }
    } }) }) } as never
    expect(await dropAlreadyPaidTagged(db, [cand('x@example.com')], { apiKey: 'key-us19', fetchImpl })).toHaveLength(1)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(queries).toBe(1)
  })

  it('没配 MAILCHIMP_API_KEY → 全部保留，不当成「都处理过了」', async () => {
    const fetchImpl = vi.fn()
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({ [CLIENT_A]: { audienceId: 'aud1', paidTag: 'vip' } }),
      [cand('x@example.com')],
      { apiKey: '', fetchImpl },
    )
    expect(kept).toHaveLength(1)
    expect(kept[0].paidTag).toBe('vip')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('Mailchimp 限流 / 5xx → 保留', async () => {
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({ [CLIENT_A]: { audienceId: 'aud1' } }),
      [cand('x@example.com')],
      { apiKey: 'key-us19', fetchImpl: async () => new Response(null, { status: 429 }) },
    )
    expect(kept).toHaveLength(1)
  })

  it('网络直接抛异常 → 保留，不让整条待办链路崩掉', async () => {
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({ [CLIENT_A]: { audienceId: 'aud1' } }),
      [cand('x@example.com')],
      {
        apiKey: 'key-us19',
        fetchImpl: async () => {
          throw new Error('ECONNRESET')
        },
      },
    )
    expect(kept).toHaveLength(1)
  })

  it('这个客户没配 audience → 判不了，保留', async () => {
    const mc = fakeMailchimp({ 'x@example.com': [DEFAULT_PAID_TAG] })
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({ [CLIENT_A]: {} }), // 没有 audienceId
      [cand('x@example.com')],
      { apiKey: 'key-us19', fetchImpl: mc.fetchImpl },
    )
    expect(kept).toHaveLength(1)
    expect(mc.calls(), '配置都读不到就不该白跑一次 Mailchimp').toBe(0)
  })

  it('clients 表整个读不出来 → 全部保留', async () => {
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({}, { totalFailure: true }),
      [cand('x@example.com')],
      { apiKey: 'key-us19', fetchImpl: async () => new Response(null, { status: 200 }) },
    )
    expect(kept).toHaveLength(1)
  })

  it('专列还没 apply（42703）→ 退回读 leads_config，过滤照常生效', async () => {
    const mc = fakeMailchimp({ 'x@example.com': [DEFAULT_PAID_TAG] })
    const kept = await dropAlreadyPaidTagged(
      fakeSupabase({ [CLIENT_A]: { audienceId: 'audFromJsonb' } }, { columnMissing: true }),
      [cand('x@example.com')],
      { apiKey: 'key-us19', fetchImpl: mc.fetchImpl },
    )
    expect(kept).toHaveLength(0)
  })
})
