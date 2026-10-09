/**
 * send-frequency-cap.ts 的行为测试。
 *
 * 钉住的是：策略解析的严格性（没有默认值）、判定的边界（`>=` 不是 `>`）、
 * 窗口的闭开区间、去重、fail closed，以及「只读」这条线 —— 所有请求都是 GET。
 */

import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseFrequencyCapPolicy,
  judgeRecipient,
  fetchSendHistory,
  checkRecipientsFrequencyCap,
  FREQUENCY_CAP_COUNTED_SOURCES,
  FREQUENCY_CAP_COVERAGE_GAPS,
  type SentRecord,
  type SendHistoryResult,
  type FrequencyCapPolicy,
} from '../send-frequency-cap'
import type { MailchimpTagsConfig } from '../tags'

const NOW = new Date('2026-10-08T00:00:00Z')
const POLICY: FrequencyCapPolicy = { maxSends: 2, windowDays: 7 }
const CFG: MailchimpTagsConfig = { apiKey: 'key-us19', audienceId: 'aud123' }

function sent(id: string, title: string, iso: string): SentRecord {
  return { campaignId: id, campaignTitle: title, sentAt: iso }
}

function md5(email: string): string {
  return createHash('md5').update(email.toLowerCase()).digest('hex')
}

function ok(sends: SentRecord[]): SendHistoryResult {
  return { status: 'ok', sends }
}

afterEach(() => {
  vi.useRealTimers()
})

// ── parseFrequencyCapPolicy ─────────────────────────────────────────────────

describe('parseFrequencyCapPolicy · 没有默认值', () => {
  it('合法的 {max_sends:2, window_days:7} → {maxSends:2, windowDays:7}', () => {
    expect(parseFrequencyCapPolicy({ max_sends: 2, window_days: 7 })).toEqual({
      maxSends: 2,
      windowDays: 7,
    })
  })

  it('undefined → null', () => {
    expect(parseFrequencyCapPolicy(undefined)).toBeNull()
  })

  it('null → null', () => {
    expect(parseFrequencyCapPolicy(null)).toBeNull()
  })

  it('字符串 → null', () => {
    expect(parseFrequencyCapPolicy('nope')).toBeNull()
  })

  it('缺 max_sends → null', () => {
    expect(parseFrequencyCapPolicy({ window_days: 7 })).toBeNull()
  })

  it('缺 window_days → null', () => {
    expect(parseFrequencyCapPolicy({ max_sends: 2 })).toBeNull()
  })

  it('max_sends 为 0 → null', () => {
    expect(parseFrequencyCapPolicy({ max_sends: 0, window_days: 7 })).toBeNull()
  })

  it('max_sends 为 1.5 → null', () => {
    expect(parseFrequencyCapPolicy({ max_sends: 1.5, window_days: 7 })).toBeNull()
  })

  it("max_sends 为字符串 '2' → null", () => {
    expect(parseFrequencyCapPolicy({ max_sends: '2', window_days: 7 })).toBeNull()
  })

  it('window_days 为 91 → null（超过保守边界）', () => {
    expect(parseFrequencyCapPolicy({ max_sends: 2, window_days: 91 })).toBeNull()
  })

  it('window_days 为 90 → 接受', () => {
    expect(parseFrequencyCapPolicy({ max_sends: 2, window_days: 90 })).toEqual({
      maxSends: 2,
      windowDays: 90,
    })
  })

  it('max_sends 为 1 → 接受', () => {
    expect(parseFrequencyCapPolicy({ max_sends: 1, window_days: 7 })).toEqual({
      maxSends: 1,
      windowDays: 7,
    })
  })
})

// ── judgeRecipient ──────────────────────────────────────────────────────────

describe('judgeRecipient · 纯函数判定', () => {
  it('窗口内 0 封 → 允许，reason ok', () => {
    const v = judgeRecipient('jane@example.com', ok([]), POLICY, NOW)
    expect(v.allowed).toBe(true)
    expect(v.reason).toBe('ok')
    expect(v.countInWindow).toBe(0)
  })

  it('窗口内 1 封 → 允许', () => {
    const v = judgeRecipient(
      'jane@example.com',
      ok([sent('c1', 't', '2026-10-07T00:00:00Z')]),
      POLICY,
      NOW,
    )
    expect(v.allowed).toBe(true)
    expect(v.reason).toBe('ok')
    expect(v.countInWindow).toBe(1)
  })

  it('窗口内 2 封（正好到顶）→ 不允许，reason at_cap，countInWindow 2', () => {
    const v = judgeRecipient(
      'jane@example.com',
      ok([sent('c1', 't', '2026-10-07T00:00:00Z'), sent('c2', 't', '2026-10-06T00:00:00Z')]),
      POLICY,
      NOW,
    )
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('at_cap')
    expect(v.countInWindow).toBe(2)
  })

  it('窗口内 3 封 → at_cap', () => {
    const v = judgeRecipient(
      'jane@example.com',
      ok([
        sent('c1', 't', '2026-10-07T00:00:00Z'),
        sent('c2', 't', '2026-10-06T00:00:00Z'),
        sent('c3', 't', '2026-10-05T00:00:00Z'),
      ]),
      POLICY,
      NOW,
    )
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('at_cap')
    expect(v.countInWindow).toBe(3)
  })

  it('正好落在 NOW-7d 的信算数，NOW-7d-1ms 的不算', () => {
    const exactly = judgeRecipient(
      'jane@example.com',
      ok([sent('c1', 't', '2026-10-01T00:00:00.000Z')]),
      POLICY,
      NOW,
    )
    expect(exactly.countInWindow).toBe(1)

    const justOutside = judgeRecipient(
      'jane@example.com',
      ok([sent('c1', 't', '2026-09-30T23:59:59.999Z')]),
      POLICY,
      NOW,
    )
    expect(justOutside.countInWindow).toBe(0)
  })

  it('2 封里有一封在窗口外 1ms → 允许', () => {
    const v = judgeRecipient(
      'jane@example.com',
      ok([
        sent('c1', 't', '2026-10-07T00:00:00Z'),
        sent('c2', 't', '2026-09-30T23:59:59.999Z'),
      ]),
      POLICY,
      NOW,
    )
    expect(v.allowed).toBe(true)
    expect(v.countInWindow).toBe(1)
  })

  it('未来时间戳被忽略', () => {
    const v = judgeRecipient(
      'jane@example.com',
      ok([sent('c1', 't', '2026-10-09T00:00:00Z')]),
      POLICY,
      NOW,
    )
    expect(v.countInWindow).toBe(0)
    expect(v.allowed).toBe(true)
  })

  it('无法解析的时间戳被忽略', () => {
    const v = judgeRecipient(
      'jane@example.com',
      ok([sent('c1', 't', 'not-a-date')]),
      POLICY,
      NOW,
    )
    expect(v.countInWindow).toBe(0)
    expect(v.allowed).toBe(true)
  })

  it('重复的 (campaignId+sentAt) 只算一次', () => {
    const v = judgeRecipient(
      'jane@example.com',
      ok([
        sent('c1', 't', '2026-10-07T00:00:00Z'),
        sent('c1', 't', '2026-10-07T00:00:00Z'),
      ]),
      POLICY,
      NOW,
    )
    expect(v.countInWindow).toBe(1)
    expect(v.allowed).toBe(true)
  })

  it('策略真的被参数化：同样 2 封，maxSends 3 → 允许', () => {
    const sends = [sent('c1', 't', '2026-10-07T00:00:00Z'), sent('c2', 't', '2026-10-06T00:00:00Z')]
    const v = judgeRecipient('jane@example.com', ok(sends), { maxSends: 3, windowDays: 7 }, NOW)
    expect(v.allowed).toBe(true)
    expect(v.reason).toBe('ok')
  })

  it('策略真的被参数化：同样 2 封，maxSends 1 → at_cap', () => {
    const sends = [sent('c1', 't', '2026-10-07T00:00:00Z'), sent('c2', 't', '2026-10-06T00:00:00Z')]
    const v = judgeRecipient('jane@example.com', ok(sends), { maxSends: 1, windowDays: 7 }, NOW)
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('at_cap')
  })

  it('sendsInWindow 按时间倒序（最新在前）', () => {
    const v = judgeRecipient(
      'jane@example.com',
      ok([
        sent('c1', 'old', '2026-10-03T00:00:00Z'),
        sent('c2', 'new', '2026-10-07T00:00:00Z'),
        sent('c3', 'mid', '2026-10-05T00:00:00Z'),
      ]),
      POLICY,
      NOW,
    )
    expect(v.sendsInWindow.map((s) => s.campaignTitle)).toEqual(['new', 'mid', 'old'])
  })

  it('not_in_audience → 允许，reason not_in_audience', () => {
    const v = judgeRecipient('jane@example.com', { status: 'not_in_audience' }, POLICY, NOW)
    expect(v.allowed).toBe(true)
    expect(v.reason).toBe('not_in_audience')
  })

  it('查询失败 http_500 → 不允许，reason lookup_failed（fail closed）', () => {
    const v = judgeRecipient(
      'jane@example.com',
      { status: 'error', reason: 'http_500', retryable: true },
      POLICY,
      NOW,
    )
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('lookup_failed')
    expect(v.errorReason).toBe('http_500')
  })

  it('查询失败 invalid_email → reason invalid_email', () => {
    const v = judgeRecipient(
      'jane@example.com',
      { status: 'error', reason: 'invalid_email', retryable: false },
      POLICY,
      NOW,
    )
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('invalid_email')
    expect(v.errorReason).toBe('invalid_email')
  })

  it('输出的 email 被 trim + 小写', () => {
    const v = judgeRecipient('  Jane@Example.COM  ', ok([]), POLICY, NOW)
    expect(v.email).toBe('jane@example.com')
  })
})

// ── fetchSendHistory ────────────────────────────────────────────────────────

interface RecordedCall {
  url: string
  method: string | undefined
}

function recordingFetch(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, method: init?.method })
    return responder(url, init)
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('fetchSendHistory · 只读查询', () => {
  it('请求正确的 URL、host、activity_filters=sent，且是 GET', async () => {
    const { fetchImpl, calls } = recordingFetch(
      () =>
        new Response(JSON.stringify({ activity: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
    expect(r.status).toBe('ok')
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call.url).toContain(`/lists/aud123/members/${md5('jane@example.com')}/activity-feed`)
    expect(call.url).toContain('activity_filters=sent')
    expect(call.url).toContain('us19.api.mailchimp.com')
    expect(call.method === undefined || call.method === 'GET').toBe(true)
  })

  it('带 Authorization 头（不校验具体值）', async () => {
    let sawAuth = false
    const { fetchImpl } = recordingFetch((_url, init) => {
      const headers = init?.headers as Record<string, string> | undefined
      sawAuth = Boolean(headers && headers.Authorization)
      return new Response(JSON.stringify({ activity: [] }), { status: 200 })
    })
    await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
    expect(sawAuth).toBe(true)
  })

  it('404 → not_in_audience', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(null, { status: 404 }))
    const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
    expect(r).toEqual({ status: 'not_in_audience' })
  })

  it('401 → error unauthorized，不可重试', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(null, { status: 401 }))
    const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
    expect(r).toEqual({ status: 'error', reason: 'unauthorized', retryable: false })
  })

  it('500 → error http_500，可重试', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(null, { status: 500 }))
    const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
    expect(r).toEqual({ status: 'error', reason: 'http_500', retryable: true })
  })

  it('429 → error http_429，可重试', async () => {
    const { fetchImpl } = recordingFetch(() => new Response(null, { status: 429 }))
    const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
    expect(r).toEqual({ status: 'error', reason: 'http_429', retryable: true })
  })

  it('fetch 抛错 → error network，可重试', async () => {
    const { fetchImpl } = recordingFetch(() => {
      throw new Error('boom')
    })
    const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
    expect(r).toEqual({ status: 'error', reason: 'network', retryable: true })
  })

  it('混合 activity_type：非 sent 的忽略，合法 sent 保留', async () => {
    const activity = [
      { activity_type: 'sent', campaign_id: 'c1', campaign_title: 'good', created_at_timestamp: '2026-10-07T00:00:00Z' },
      { activity_type: 'open', campaign_id: 'c2', campaign_title: 'open', created_at_timestamp: '2026-10-07T00:00:00Z' },
    ]
    const { fetchImpl } = recordingFetch(
      () => new Response(JSON.stringify({ activity }), { status: 200 }),
    )
    const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
    expect(r).toEqual({
      status: 'ok',
      sends: [sent('c1', 'good', '2026-10-07T00:00:00Z')],
    })
  })

  it('「发出」记录缺 campaign_id 或缺时间 → fail closed（bad_shape），不能静默丢掉', async () => {
    for (const bad of [
      { activity_type: 'sent', campaign_title: 'no id', created_at_timestamp: '2026-10-07T00:00:00Z' },
      { activity_type: 'sent', campaign_id: 'c4', campaign_title: 'no ts' },
    ]) {
      const { fetchImpl } = recordingFetch(
        () => new Response(JSON.stringify({ activity: [bad] }), { status: 200 }),
      )
      const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
      expect(r).toEqual({ status: 'error', reason: 'bad_shape', retryable: false })
    }
  })

  it('响应里没有 activity 数组 → bad_shape，不能当成 0 封放行', async () => {
    for (const body of [{}, { activity: null }, { items: [] }]) {
      const { fetchImpl } = recordingFetch(() => new Response(JSON.stringify(body), { status: 200 }))
      const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'jane@example.com')
      expect(r).toEqual({ status: 'error', reason: 'bad_shape', retryable: false })
    }
  })

  it('一页装不下（满 100 条，或 total_items 比返回的多）→ truncated，不能放行', async () => {
    const row = (i: number) => ({ activity_type: 'sent', campaign_id: `c${i}`, campaign_title: 't', created_at_timestamp: '2020-01-01T00:00:00Z' })
    const full = Array.from({ length: 100 }, (_, i) => row(i))
    const a = recordingFetch(() => new Response(JSON.stringify({ activity: full }), { status: 200 }))
    expect(await fetchSendHistory({ ...CFG, fetchImpl: a.fetchImpl }, 'jane@example.com')).toEqual({ status: 'error', reason: 'truncated', retryable: false })
    const b = recordingFetch(() => new Response(JSON.stringify({ activity: [row(1)], total_items: 5 }), { status: 200 }))
    expect(await fetchSendHistory({ ...CFG, fetchImpl: b.fetchImpl }, 'jane@example.com')).toEqual({ status: 'error', reason: 'truncated', retryable: false })
  })

  it('非法邮箱 → error invalid_email，且不发起请求', async () => {
    const { fetchImpl, calls } = recordingFetch(() => new Response(null, { status: 200 }))
    const r = await fetchSendHistory({ ...CFG, fetchImpl }, 'not-an-email')
    expect(r).toEqual({ status: 'error', reason: 'invalid_email', retryable: false })
    expect(calls).toHaveLength(0)
  })

  it('apiKey 没有 dc 后缀 → error bad_api_key_format', async () => {
    const { fetchImpl, calls } = recordingFetch(() => new Response(null, { status: 200 }))
    const r = await fetchSendHistory({ ...CFG, apiKey: 'nokeyformat', fetchImpl }, 'jane@example.com')
    expect(r).toEqual({ status: 'error', reason: 'bad_api_key_format', retryable: false })
    expect(calls).toHaveLength(0)
  })
})

// ── checkRecipientsFrequencyCap ─────────────────────────────────────────────

interface FakeActivity {
  activity_type: string
  campaign_id?: string
  campaign_title?: string
  created_at_timestamp?: string
}

function fakeMailchimp(audience: Record<string, FakeActivity[]>) {
  const calls: RecordedCall[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, method: init?.method })

    // 名单本身存在检查（GET /lists/{id}?fields=id）
    if (!url.includes('/members/')) return new Response(JSON.stringify({ id: 'aud123' }), { status: 200 })
    const hash = url.split('/members/')[1]?.split(/[/?]/)[0] ?? ''
    const email = Object.keys(audience).find((e) => md5(e) === hash)

    if (email === undefined) return new Response(null, { status: 404 })
    if (email === 'e500@example.com') return new Response(null, { status: 500 })
    return new Response(JSON.stringify({ activity: audience[email] }), { status: 200 })
  }) as typeof fetch
  return { cfg: { ...CFG, fetchImpl }, calls }
}

describe('checkRecipientsFrequencyCap · 批量收据', () => {
  it('5 人批次：at_cap / ok / 窗口外 / 不在名单 / 查询失败', async () => {
    const { cfg, calls } = fakeMailchimp({
      'a@example.com': [
        { activity_type: 'sent', campaign_id: 'w1', campaign_title: 'Welcome new contacts', created_at_timestamp: '2026-10-05T00:00:00Z' },
        { activity_type: 'sent', campaign_id: 'b1', campaign_title: 'auto_e1_batch_20261007', created_at_timestamp: '2026-10-07T00:00:00Z' },
      ],
      'b@example.com': [
        { activity_type: 'sent', campaign_id: 'b2', campaign_title: 'one', created_at_timestamp: '2026-10-07T00:00:00Z' },
      ],
      'c@example.com': [
        { activity_type: 'sent', campaign_id: 'c1', campaign_title: 'old1', created_at_timestamp: '2026-09-30T00:00:00Z' },
        { activity_type: 'sent', campaign_id: 'c2', campaign_title: 'old2', created_at_timestamp: '2026-09-29T00:00:00Z' },
      ],
      'e500@example.com': [],
    })

    const receipt = await checkRecipientsFrequencyCap({
      clientId: 'client-1',
      requestId: 'req-1',
      cfg,
      policy: POLICY,
      emails: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e500@example.com'],
      now: NOW,
    })

    expect(receipt.receipt_version).toBe(1)
    expect(receipt.request_id).toBe('req-1')
    expect(receipt.client_id).toBe('client-1')
    expect(receipt.audience_id).toBe('aud123')
    expect(receipt.checked_at).toBe(NOW.toISOString())
    expect(receipt.window_start).toBe('2026-10-01T00:00:00.000Z')
    expect(receipt.policy).toEqual(POLICY)
    expect(receipt.scanned).toBe(5)
    expect(receipt.allowed).toEqual(['b@example.com', 'c@example.com', 'd@example.com'])
    expect(receipt.allowed_count).toBe(3)
    expect(receipt.excluded_count).toBe(2)
    expect(receipt.allowed_count + receipt.excluded_count).toBe(receipt.scanned)
    expect(receipt.no_publish).toBe(true)
    expect(receipt.mailchimp_writes).toBe(0)
    expect(receipt.coverage_gaps).toHaveLength(3)
    expect(receipt.counted_sources).toHaveLength(2)
    expect(receipt.coverage_gaps).toEqual(FREQUENCY_CAP_COVERAGE_GAPS)
    expect(receipt.counted_sources).toEqual(FREQUENCY_CAP_COUNTED_SOURCES)

    const a = receipt.excluded.find((v) => v.email === 'a@example.com')
    expect(a?.reason).toBe('at_cap')
    expect(a?.sendsInWindow.map((s) => s.campaignTitle).sort()).toEqual([
      'Welcome new contacts',
      'auto_e1_batch_20261007',
    ])

    const d = receipt.excluded.find((v) => v.email === 'd@example.com')
    expect(d).toBeUndefined()
    const dAllowed = receipt.allowed.includes('d@example.com')
    expect(dAllowed).toBe(true)

    const e = receipt.excluded.find((v) => v.email === 'e500@example.com')
    expect(e?.reason).toBe('lookup_failed')
    expect(receipt.lookup_failed_count).toBe(1)

    // INVARIANT: 所有请求都是 GET
    for (const call of calls) {
      expect(call.method === undefined || call.method === 'GET').toBe(true)
    }
  })

  it('输入里的重复 / 大写 / 空白邮箱被去重（scanned 数唯一）', async () => {
    const { cfg } = fakeMailchimp({
      'jane@example.com': [
        { activity_type: 'sent', campaign_id: 'c1', campaign_title: 't', created_at_timestamp: '2026-10-07T00:00:00Z' },
      ],
    })
    const receipt = await checkRecipientsFrequencyCap({
      clientId: 'client-1',
      requestId: 'req-2',
      cfg,
      policy: POLICY,
      emails: ['Jane@Example.com', '  jane@example.com  ', 'jane@example.com', '   '],
      now: NOW,
    })
    expect(receipt.scanned).toBe(1)
    expect(receipt.allowed).toEqual(['jane@example.com'])
  })

  it('429 后重试成功：收件人最终允许，fake 看到 2 次调用', async () => {
    vi.useFakeTimers()
    let n = 0
    const calls: RecordedCall[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push({ url, method: init?.method })
      if (!url.includes('/members/')) return new Response(JSON.stringify({ id: 'aud123' }), { status: 200 })
      n += 1
      if (n === 1) return new Response(null, { status: 429 })
      return new Response(
        JSON.stringify({
          activity: [
            { activity_type: 'sent', campaign_id: 'c1', campaign_title: 't', created_at_timestamp: '2026-10-07T00:00:00Z' },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const promise = checkRecipientsFrequencyCap({
      clientId: 'client-1',
      requestId: 'req-3',
      cfg: { ...CFG, fetchImpl },
      policy: POLICY,
      emails: ['jane@example.com'],
      now: NOW,
    })
    await vi.advanceTimersByTimeAsync(5000)
    const receipt = await promise

    expect(receipt.allowed).toEqual(['jane@example.com'])
    expect(calls.filter((c) => c.url.includes('/members/'))).toHaveLength(2)
  })

  it('并发上限：concurrency 50 时同时在飞的请求不超过 8', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      inFlight += 1
      if (inFlight > maxInFlight) maxInFlight = inFlight
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight -= 1
      const hash = url.split('/members/')[1]?.split(/[/?]/)[0] ?? ''
      const email = `u${hash}@example.com`
      return new Response(
        JSON.stringify({
          activity: [
            { activity_type: 'sent', campaign_id: 'c1', campaign_title: 't', created_at_timestamp: '2026-10-07T00:00:00Z' },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch

    const emails = Array.from({ length: 40 }, (_, i) => `u${i}@example.com`)
    await checkRecipientsFrequencyCap({
      clientId: 'client-1',
      requestId: 'req-4',
      cfg: { ...CFG, fetchImpl },
      policy: POLICY,
      emails,
      now: NOW,
      concurrency: 50,
    })

    expect(maxInFlight).toBeLessThanOrEqual(8)
  })

  it('名单不存在（audience id 填错）→ 整批 fail closed，没有人被放行，也不逐人查询', async () => {
    const calls: RecordedCall[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push({ url, method: init?.method })
      return new Response(null, { status: 404 })
    }) as typeof fetch
    const receipt = await checkRecipientsFrequencyCap({
      clientId: 'client-1',
      requestId: 'req-404',
      cfg: { ...CFG, fetchImpl },
      policy: POLICY,
      emails: ['a@example.com', 'b@example.com'],
      now: NOW,
    })
    expect(receipt.allowed).toEqual([])
    expect(receipt.excluded_count).toBe(2)
    expect(receipt.lookup_failed_count).toBe(2)
    expect(receipt.excluded.every((v) => v.errorReason === 'audience_unreachable')).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('回执带有效期 valid_until = checked_at + 6 小时', async () => {
    const { cfg } = fakeMailchimp({ 'a@example.com': [] })
    const receipt = await checkRecipientsFrequencyCap({
      clientId: 'client-1',
      requestId: 'req-ttl',
      cfg,
      policy: POLICY,
      emails: ['a@example.com'],
      now: NOW,
    })
    expect(receipt.valid_until).toBe('2026-10-08T06:00:00.000Z')
  })
})
