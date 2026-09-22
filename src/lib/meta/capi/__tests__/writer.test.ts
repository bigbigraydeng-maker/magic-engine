/**
 * Meta 转化 API 回写引擎的测试（Issue #1397 PR2）。
 *
 * 全部离线：`fetcher` 是注入的假函数，一个真实请求都不发。
 * 重点验的不是"正常情况能跑"，而是**每一种失败被分到了正确的档** ——
 * 因为分错档的后果差别极大：判成 retry 会重发（可能双记一笔成交），
 * 判成 permanent 会丢掉一条本可以成功的，判成 in_doubt 才是"不确定"的正确处置。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 把"读客户配置"换掉：这一层测的是发送与判定，不是配置解析（那个有自己的测试）。
// 不 mock 的话会去连真的 Supabase，测试就成了"在配置读取失败那一步返回"的空跑。
vi.mock('../config', () => ({
  resolveCapiConfig: vi.fn(),
  CapiConfigError: class extends Error {},
}))

import { MetaCapiWriter, parseRetryAfterMs } from '../writer'
import { resolveCapiConfig } from '../config'
import type { ClientSendConfig, OutcomeForSend, RawSendResult } from '@/lib/conversions/destination-writer'

const writer = new MetaCapiWriter()

const CONFIG: ClientSendConfig = {
  clientId: 'c0000000-0000-0000-0000-000000000000',
  defaultPhoneCountry: '64',
  facebookPageId: null,
}

function outcome(over: Partial<OutcomeForSend> = {}): OutcomeForSend {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    clientId: CONFIG.clientId,
    contactId: null,
    outcomeKind: 'purchase',
    customerEmail: 'rosalind@example.com',
    customerPhone: null,
    customerFirst: null,
    customerLast: null,
    orderRef: '84191',
    amountMinor: 388000,
    currency: 'NZD',
    occurredAt: '2026-09-03T10:00:00Z',
    pageScopedUserId: null,
    actionSource: 'email',
    ...over,
  }
}

/** 造一个「Meta 这样回」的原始结果，跳过 HTTP。 */
function raw(over: Partial<Extract<RawSendResult, { ok: true }>> = {}): RawSendResult {
  return { ok: true, status: 200, headers: {}, bodyText: '{}', latencyMs: 12, ...over }
}

function jsonBody(obj: unknown): string {
  return JSON.stringify(obj)
}

// ─────────────────────────────────────────────────────────────────────────
describe('build · 事件名映射', () => {
  it('定金 → Purchase', () => {
    expect(writer.build(outcome(), CONFIG).data[0].event_name).toBe('Purchase')
  })

  it('尾款 → BalancePaid，不是 Purchase', () => {
    // PM 2026-09-05 明令："定金算成交，坚决不能记成 2 笔。"
    // Meta 不按 order_id 合并，发两次 Purchase 会让成交数翻倍、每单成本看起来减半。
    const p = writer.build(outcome({ outcomeKind: 'balance' }), CONFIG)
    expect(p.data[0].event_name).toBe('BalancePaid')
    expect(p.data[0].event_name).not.toBe('Purchase')
  })

  it('咨询 → Lead，且不带金额', () => {
    const p = writer.build(
      outcome({ outcomeKind: 'lead', amountMinor: null, currency: null, orderRef: null }),
      CONFIG,
    )
    expect(p.data[0].event_name).toBe('Lead')
    expect(p.data[0].custom_data).toBeUndefined()
  })
})

describe('build · 身份哈希', () => {
  it('邮箱哈希成 64 位十六进制，且不含明文', () => {
    const p = writer.build(outcome(), CONFIG)
    const em = (p.data[0].user_data.em as string[])[0]
    expect(em).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(p)).not.toContain('rosalind')
    expect(JSON.stringify(p)).not.toContain('@example.com')
  })

  it('大小写/空白不同的同一个邮箱哈希成同一个值', () => {
    // 不先规范化就哈希的话，同一个人在 Meta 那边会算成两个人。
    const a = writer.build(outcome({ customerEmail: 'Rosalind@Example.COM ' }), CONFIG)
    const b = writer.build(outcome({ customerEmail: 'rosalind@example.com' }), CONFIG)
    expect(a.data[0].user_data.em).toEqual(b.data[0].user_data.em)
  })

  it('没有的字段不出现，不塞空串的哈希', () => {
    // 空串的哈希是个"人人相同"的假身份，塞进去反而拉低匹配质量。
    const p = writer.build(outcome({ customerPhone: null, customerFirst: null }), CONFIG)
    expect(p.data[0].user_data.ph).toBeUndefined()
    expect(p.data[0].user_data.fn).toBeUndefined()
  })

  it('电话按客户所在国转国际格式后再哈希', () => {
    const nz = writer.build(outcome({ customerPhone: '021 555 1234' }), CONFIG)
    const intl = writer.build(outcome({ customerPhone: '+64 21 555 1234' }), CONFIG)
    expect(nz.data[0].user_data.ph).toEqual(intl.data[0].user_data.ph)
  })

  it('换个国家的客户，同样的本地号码哈希不同', () => {
    // 这条钉住"国别不能写死"：换客户换国家，行为必须跟着变。
    const nz = writer.build(outcome({ customerPhone: '021 555 1234' }), CONFIG)
    const au = writer.build(outcome({ customerPhone: '021 555 1234' }), {
      ...CONFIG,
      defaultPhoneCountry: '61',
    })
    expect(nz.data[0].user_data.ph).not.toEqual(au.data[0].user_data.ph)
  })
})

describe('build · Facebook 私信身份（PSID）匹配键', () => {
  it('原样落进 payload，不哈希 —— Meta 文档明确这两个字段"不哈希"', () => {
    const p = writer.build(
      outcome({ customerEmail: null, pageScopedUserId: '28681838868174032', actionSource: 'business_messaging' }),
      { ...CONFIG, facebookPageId: '1177479655430100' },
    )
    expect(p.data[0].user_data.page_scoped_user_id).toBe('28681838868174032')
    expect(p.data[0].user_data.page_id).toBe('1177479655430100')
  })

  it('没有 pageScopedUserId 时，两个字段都不出现（CTS 现状不受影响）', () => {
    const p = writer.build(outcome(), { ...CONFIG, facebookPageId: '1177479655430100' })
    expect(p.data[0].user_data.page_scoped_user_id).toBeUndefined()
    expect(p.data[0].user_data.page_id).toBeUndefined()
  })

  it('有 PSID 但客户没配 facebookPageId 时，只带 PSID，不硬塞一个不存在的主页 id', () => {
    const p = writer.build(
      outcome({ pageScopedUserId: '28681838868174032', actionSource: 'business_messaging' }),
      { ...CONFIG, facebookPageId: null },
    )
    expect(p.data[0].user_data.page_scoped_user_id).toBe('28681838868174032')
    expect(p.data[0].user_data.page_id).toBeUndefined()
  })

  it('action_source 原样透传 outcome.actionSource，writer 自己不做推断', () => {
    const email = writer.build(outcome({ actionSource: 'email' }), CONFIG)
    expect(email.data[0].action_source).toBe('email')

    const messenger = writer.build(
      outcome({ pageScopedUserId: '28681838868174032', actionSource: 'business_messaging' }),
      CONFIG,
    )
    expect(messenger.data[0].action_source).toBe('business_messaging')
  })
})

describe('build · 金额与时间', () => {
  it('最小单位换回主单位', () => {
    const p = writer.build(outcome({ amountMinor: 388000, currency: 'NZD' }), CONFIG)
    expect(p.data[0].custom_data).toMatchObject({ currency: 'NZD', value: 3880, order_id: '84191' })
  })

  it('带小数的金额不丢精度', () => {
    const p = writer.build(outcome({ amountMinor: 388050, currency: 'NZD' }), CONFIG)
    expect((p.data[0].custom_data as { value: number }).value).toBe(3880.5)
  })

  it('时间是秒级时间戳', () => {
    const p = writer.build(outcome({ occurredAt: '2026-09-03T10:00:00Z' }), CONFIG)
    expect(p.data[0].event_time).toBe(Math.floor(Date.parse('2026-09-03T10:00:00Z') / 1000))
  })

  it('🔴 不认识的币种直接抛错，绝不按 2 位小数猜', () => {
    // 2026-09-05 实测：这张表原本被抄了 3 份，录入层拒收未知币种，
    // 而发送引擎静默按 2 位算 —— 绕过录入的路径（补数据脚本、手工改库）
    // 会让一笔日元差 100 倍发给 Meta，而那撤不回。现在全仓只有一份。
    expect(() => writer.build(outcome({ currency: 'JPY' }), CONFIG)).toThrow('不支持的币种')
  })

  it('幂等键就是事实行的 id', () => {
    const p = writer.build(outcome(), CONFIG)
    expect(p.data[0].event_id).toBe('11111111-2222-3333-4444-555555555555')
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('accept · 成功', () => {
  it('200 + events_received=1 → 接受', () => {
    const v = writer.accept(
      raw({ bodyText: jsonBody({ events_received: 1, fbtrace_id: 'AbC', messages: [] }) }),
    )
    expect(v.kind).toBe('accepted')
    if (v.kind !== 'accepted') return
    expect(v.receipt).toMatchObject({ events_received: 1, fbtrace_id: 'AbC' })
  })

  it('回执只留白名单字段，不含 Meta 回显的用户数据', () => {
    const v = writer.accept(
      raw({
        bodyText: jsonBody({
          events_received: 1,
          fbtrace_id: 'AbC',
          // Meta 有时会把请求里的东西回显出来 —— 不能原样存进库，那是二次沉淀 PII。
          user_data_echo: { em: ['deadbeef'] },
        }),
      }),
    )
    expect(v.kind).toBe('accepted')
    if (v.kind !== 'accepted') return
    expect(JSON.stringify(v.receipt)).not.toContain('deadbeef')
    expect(JSON.stringify(v.receipt)).not.toContain('user_data_echo')
  })
})

describe('accept · 静默失败（最常见的坑）', () => {
  it('200 但 events_received=0 → 不算成功', () => {
    // 这是 Meta 最常见的静默失败：HTTP 200，看着像成了，其实一条没进。
    const v = writer.accept(raw({ bodyText: jsonBody({ events_received: 0 }) }))
    expect(v.kind).toBe('permanent')
    if (v.kind !== 'permanent') return
    expect(v.detail).toContain('events_received=0')
  })

  it('200 但响应体里夹着 error 对象 → 不算成功', () => {
    // Graph API 会在 200 里带 error。只看状态码会把失败当成功。
    const v = writer.accept(
      raw({ bodyText: jsonBody({ error: { message: '字段缺失', code: 100 } }) }),
    )
    expect(v.kind).not.toBe('accepted')
  })

  it('🔴 200 + events_received=1 + 同时带 error → 仍然不算成功', () => {
    // 这一条是上面那条的**要害版**：变异测试实测过，
    // 只断言「不是 accepted」的话，去掉 `&& !err` 这个守卫测试照样全绿 ——
    // 因为那些用例里 events_received 本来就不是 1，早在别的分支被拦下了。
    // 真正会被误判成功的，正是"计数对得上但同时报了错"这种。
    const v = writer.accept(
      raw({
        bodyText: jsonBody({
          events_received: 1,
          error: { message: '部分字段被忽略', code: 100 },
        }),
      }),
    )
    expect(v.kind).not.toBe('accepted')
  })

  it('200 但响应不是 JSON → 归为不确定，不猜', () => {
    const v = writer.accept(raw({ bodyText: '<html>502 Bad Gateway</html>' }))
    expect(v.kind).toBe('in_doubt')
  })
})

describe('accept · 不确定（绝不能自动重发的那一档）', () => {
  it('网络异常 → in_doubt，不是 retry', () => {
    // 🔴 这是全套设计里最要紧的一条：请求可能已经到了 Meta。
    //    Meta 服务端事件之间没有去重、也没有删除端点 ——
    //    盲目重发就是永久多记一笔成交，撤不回。
    const v = writer.accept({
      ok: false,
      errorName: 'TimeoutError',
      errorMessage: 'fetch timed out',
      latencyMs: 30000,
    })
    expect(v.kind).toBe('in_doubt')
  })

  it.each([502, 504])('HTTP %i（网关层）→ in_doubt', (status) => {
    const v = writer.accept(raw({ status, bodyText: '' }))
    expect(v.kind).toBe('in_doubt')
  })

  it('配置缺失 → permanent，不是 in_doubt（根本没发出去）', () => {
    const v = writer.accept({
      ok: false,
      errorName: 'ConfigError',
      errorMessage: '缺少该客户的 Meta 令牌',
      latencyMs: 1,
    })
    expect(v.kind).toBe('permanent')
  })
})

describe('accept · 事件太旧', () => {
  it.each([
    'The event_time is too old',
    'event_time cannot be more than 7 days in the past',
  ])('“%s” → expired，不是 permanent', (message) => {
    // 分开是为了让待办说人话：「早了 X 天，Meta 不收」比「HTTP 400」有用得多。
    const v = writer.accept(raw({ status: 400, bodyText: jsonBody({ error: { message, code: 100 } }) }))
    expect(v.kind).toBe('expired')
  })
})

describe('accept · 授权', () => {
  it.each([190, 102, 200])('错误码 %i → auth', (code) => {
    const v = writer.accept(
      raw({ status: 400, bodyText: jsonBody({ error: { message: '会话已失效', code } }) }),
    )
    expect(v.kind).toBe('auth')
  })

  it('HTTP 401 / 403 → auth', () => {
    for (const status of [401, 403]) {
      const v = writer.accept(raw({ status, bodyText: jsonBody({ error: { message: '无权限' } }) }))
      expect(v.kind).toBe('auth')
    }
  })
})

describe('accept · 限流与重试', () => {
  it('8000x 一族 → retry', () => {
    // 官方没写死转化 API 归哪个配额桶，所以按前缀认，不只认 80004。
    for (const code of [80000, 80004, 80014]) {
      const v = writer.accept(
        raw({ status: 400, bodyText: jsonBody({ error: { message: '请求过于频繁', code } }) }),
      )
      expect(v.kind, `code ${code}`).toBe('retry')
    }
  })

  it('限流时带上 Meta 说的等待时间', () => {
    const v = writer.accept(
      raw({
        status: 400,
        headers: {
          'x-business-use-case-usage': JSON.stringify({
            '123': [{ estimated_time_to_regain_access: 45 }],
          }),
        },
        bodyText: jsonBody({ error: { message: 'rate limited', code: 80004 } }),
      }),
    )
    expect(v.kind).toBe('retry')
    if (v.kind !== 'retry') return
    expect(v.retryAfterMs).toBe(45 * 60_000)
  })

  it('Meta 5xx → retry', () => {
    const v = writer.accept(raw({ status: 500, bodyText: jsonBody({ error: { message: '内部错误' } }) }))
    expect(v.kind).toBe('retry')
  })

  it('其它 4xx → permanent（重试多少次都一样）', () => {
    const v = writer.accept(
      raw({ status: 400, bodyText: jsonBody({ error: { message: 'user_data 缺失', code: 100 } }) }),
    )
    expect(v.kind).toBe('permanent')
  })
})

describe('parseRetryAfterMs', () => {
  it('取多个配额桶里最长的那个', () => {
    const ms = parseRetryAfterMs({
      'x-business-use-case-usage': JSON.stringify({
        a: [{ estimated_time_to_regain_access: 5 }],
        b: [{ estimated_time_to_regain_access: 30 }],
      }),
    })
    expect(ms).toBe(30 * 60_000)
  })

  it('头格式坏了不抛异常，返回 undefined 让调用方用默认退避', () => {
    // Meta 改了头的格式不该把整条流程弄崩。
    expect(parseRetryAfterMs({ 'x-business-use-case-usage': '不是 JSON' })).toBeUndefined()
    expect(parseRetryAfterMs({})).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────
describe('send · 真正走到 HTTP 那一步', () => {
  const CREDS = {
    clientId: CONFIG.clientId,
    pixelId: '1824094338280968',
    accessToken: 'fake-token',
    source: { tokenEnv: 'META_SYSTEM_USER_TOKEN_X', pixelEnv: 'META_PIXEL_ID_X' },
  }

  beforeEach(() => {
    vi.mocked(resolveCapiConfig).mockReset()
    vi.mocked(resolveCapiConfig).mockResolvedValue(CREDS)
  })

  it('打到正确的 pixel 端点，令牌在请求体里而不是 URL 上', async () => {
    // 令牌放 URL 会进各种访问日志。放请求体里。
    const fetcher = vi.fn().mockResolvedValue(
      new Response(jsonBody({ events_received: 1 }), { status: 200 }),
    )
    await writer.send(writer.build(outcome(), CONFIG), CONFIG, {
      fetcher: fetcher as unknown as typeof fetch,
    })

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toContain(`/${CREDS.pixelId}/events`)
    expect(url).not.toContain('fake-token')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string).access_token).toBe('fake-token')
  })

  it('一次只发一条 —— 一条超期会拖死整批（官方：整批拒，一条不处理）', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(jsonBody({ events_received: 1 }), { status: 200 }),
    )
    await writer.send(writer.build(outcome(), CONFIG), CONFIG, {
      fetcher: fetcher as unknown as typeof fetch,
    })
    const body = JSON.parse(fetcher.mock.calls[0][1].body as string)
    expect(body.data).toHaveLength(1)
  })

  it('成功时带回状态码、诊断头与耗时', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(jsonBody({ events_received: 1 }), {
        status: 200,
        headers: { 'x-fb-trace-id': 'trace-1', 'x-business-use-case-usage': '{}' },
      }),
    )
    const res = await writer.send({ data: [] }, CONFIG, { fetcher: fetcher as unknown as typeof fetch })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.status).toBe(200)
    expect(res.headers['x-fb-trace-id']).toBe('trace-1')
    expect(typeof res.latencyMs).toBe('number')
  })

  it('只留白名单请求头，不把整包头存下来', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'set-cookie': 'session=secret', 'x-fb-trace-id': 'trace-1' },
      }),
    )
    const res = await writer.send({ data: [] }, CONFIG, { fetcher: fetcher as unknown as typeof fetch })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('网络异常被接住，不抛出', async () => {
    // 🔴 抛出的话，调用方分不清"根本没发出去"和"发出去了但没接住回应"，
    //    而这两者的正确处置完全相反 —— 后者绝不能重发。
    const fetcher = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const res = await writer.send({ data: [] }, CONFIG, { fetcher: fetcher as unknown as typeof fetch })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errorMessage).toBe('ECONNRESET')
    expect(writer.accept(res).kind).toBe('in_doubt')
  })

  it('返回值可以被 JSON 序列化（要存进数据库）', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'))
    const res = await writer.send({ data: [] }, CONFIG, { fetcher: fetcher as unknown as typeof fetch })
    expect(() => JSON.stringify(res)).not.toThrow()
  })

  it('配置缺失时直接返回 ConfigError，一个请求都不发', async () => {
    vi.mocked(resolveCapiConfig).mockRejectedValue(new Error('缺少该客户的 Meta 令牌'))
    const fetcher = vi.fn()
    const res = await writer.send({ data: [] }, CONFIG, { fetcher: fetcher as unknown as typeof fetch })
    expect(fetcher).not.toHaveBeenCalled()
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errorName).toBe('ConfigError')
    expect(writer.accept(res).kind).toBe('permanent')
  })
})

describe('preflight · 只读探活', () => {
  beforeEach(() => {
    vi.mocked(resolveCapiConfig).mockReset()
    vi.mocked(resolveCapiConfig).mockResolvedValue({
      clientId: CONFIG.clientId,
      pixelId: '1824094338280968',
      accessToken: 'fake-token',
      source: { tokenEnv: 'T', pixelEnv: 'P' },
    })
  })

  it('令牌有效 + pixel 可见 → ok', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(jsonBody({ data: { is_valid: true, scopes: ['ads_management'] } })),
      )
      .mockResolvedValueOnce(new Response(jsonBody({ id: '1824094338280968', name: 'cts Newsletter' })))
    const r = await writer.preflight(CONFIG, { fetcher: fetcher as unknown as typeof fetch })
    expect(r.ok).toBe(true)
    expect(r.detail.has_ads_management).toBe(true)
    expect(r.detail.pixel_name).toBe('cts Newsletter')
  })

  it('令牌失效 → 不 ok，且不再去问 pixel', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(jsonBody({ data: { is_valid: false } })))
    const r = await writer.preflight(CONFIG, { fetcher: fetcher as unknown as typeof fetch })
    expect(r.ok).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('pixel 不属于这把令牌 → 不 ok', async () => {
    // 拿 A 客户的令牌配 B 客户的 pixel，成交会写进错的广告账户，撤不回。
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(jsonBody({ data: { is_valid: true, scopes: [] } })))
      .mockResolvedValueOnce(new Response(jsonBody({ error: { message: '无权访问该对象' } })))
    const r = await writer.preflight(CONFIG, { fetcher: fetcher as unknown as typeof fetch })
    expect(r.ok).toBe(false)
    expect(r.detail.pixel_visible).toBe(false)
  })

  it('探活是只读的：没有任何 POST', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(jsonBody({ data: { is_valid: true, scopes: [] } })))
      .mockResolvedValueOnce(new Response(jsonBody({ id: '1824094338280968' })))
    await writer.preflight(CONFIG, { fetcher: fetcher as unknown as typeof fetch })
    for (const call of fetcher.mock.calls) {
      expect(call[1]?.method ?? 'GET').toBe('GET')
    }
  })
})

describe('契约常量', () => {
  it('最大事件年龄是 7 天（官方硬限制）', () => {
    expect(writer.maxEventAgeDays).toBe(7)
  })

  it('kind 是 meta_capi', () => {
    expect(writer.kind).toBe('meta_capi')
  })
})
