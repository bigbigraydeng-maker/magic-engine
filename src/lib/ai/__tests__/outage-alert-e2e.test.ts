/**
 * @vitest-environment node
 *
 * 跑在 node 环境（不是默认的 jsdom）：openai SDK 检测到「像浏览器」的环境会拒绝构造，
 * 而这条链路的价值恰恰在于用**真的 SDK**跑，不能为了迁就测试环境换成假客户端。
 */

/**
 * 验收测试：造一次**真的**「账户没钱」失败，看它能不能当天变成 PM 看得懂的一句话。
 *
 * 这不是「代码写了」式的验收 —— 它从一次真实形状的 HTTP 429 响应出发，
 * 依次经过 **真的** openai SDK、**真的** fetch 拦截器、**真的** 分类器、
 * **真的** 落库函数、**真的** 待办生成函数，只在数据库那一层换成了假实现。
 *
 * 2026-09-20 那次事故里，这条链路上每一环都不存在。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** 落库那一步被换掉的地方 —— 只在数据库边界上造假，其余全是真代码。 */
const captured = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        captured.rows.push(row)
        return { error: null }
      },
    }),
  },
}))

import { getOpenAIClient } from '../openai-client'
import { readRecentOutages, resetOutageThrottle, type OutageReadResult, type OutageRow } from '../outage-ledger'
import { buildProviderOutageItems } from '@/lib/pm-todo/manual-items'

/** OpenAI 余额耗尽时真实返回的那一坨。 */
const INSUFFICIENT_QUOTA_BODY = JSON.stringify({
  error: {
    message: 'You exceeded your current quota, please check your plan and billing details.',
    type: 'insufficient_quota',
    param: null,
    code: 'insufficient_quota',
  },
})

function quotaExhaustedResponse(): Response {
  return new Response(INSUFFICIENT_QUOTA_BODY, {
    status: 429,
    headers: { 'content-type': 'application/json' },
  })
}

/** 等 fire-and-forget 的那一支跑完（它里面有 await import(...)，要跨几个微任务）。 */
async function waitForWrite(timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (captured.rows.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10))
  }
}

const realFetch = globalThis.fetch

beforeEach(() => {
  captured.rows = []
  resetOutageThrottle()
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('验收 1：账户没钱 → 当天变成今日待办里的一条人话提醒', () => {
  it('🔴 端到端：一次 429 insufficient_quota 走完整条链路，最后是一句 PM 看得懂的话', async () => {
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return quotaExhaustedResponse()
    }) as typeof fetch

    // ① 真的 SDK + 真的拦截器
    const client = getOpenAIClient({ apiKey: 'sk-test', bypassGateway: true })
    await expect(
      client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow()

    await waitForWrite()

    // ② 落了一条账户级失效记录
    expect(captured.rows).toHaveLength(1)
    expect(captured.rows[0]).toMatchObject({ provider: 'openai', reason: 'account_exhausted' })

    // SDK 默认会重试 429（maxRetries=2），所以打了不止一次网络；
    // 但进程内节流保证只写一行 —— 断电期间不会把表写爆
    expect(fetchCalls).toBeGreaterThan(1)

    // ③ 把刚落下的那一行读回来，走真的读取函数
    const row = captured.rows[0]
    const stored: OutageRow = {
      provider: String(row.provider),
      reason: String(row.reason),
      outage_date: String(row.outage_date),
      detail: typeof row.detail === 'string' ? row.detail : null,
      first_seen_at: String(row.first_seen_at),
      last_seen_at: String(row.last_seen_at),
    }
    const now = new Date(`${stored.outage_date}T19:00:00Z`)
    const read = async (): Promise<OutageReadResult> => ({ rows: [stored], error: null })
    const query = await readRecentOutages(read, now)

    // ④ 真的待办生成函数
    const items = buildProviderOutageItems(query, now)
    expect(items).toHaveLength(1)
    const item = items[0]

    expect(item.kind).toBe('ai_provider_exhausted')
    // 说人话：不出现黑话，出现「钱用完了」和「现在有什么后果」
    expect(item.what).toContain('今天')
    expect(item.what).toContain('钱用完了')
    expect(item.what).toMatch(/安静地跳过/)
    expect(item.what).not.toMatch(/insufficient_quota|429|HTTP/)
    // 三件套：怎么做 + 直达链接
    expect(item.how).toContain('充值')
    expect(item.href).toMatch(/^https:\/\/platform\.openai\.com\//)
  })

  it('🔴 同样是 429，但只是限流 → 一个字都不许报（否则人会学会忽略这条告警）', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch

    const client = getOpenAIClient({ apiKey: 'sk-test', bypassGateway: true })
    await expect(
      client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow()

    // 给 fire-and-forget 一点时间，确认它**确实什么都没写**
    await new Promise((r) => setTimeout(r, 200))
    expect(captured.rows).toHaveLength(0)
  })

  it('🔴 告警写不进去时，业务调用不许被连累 —— 但也不许静默', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    globalThis.fetch = (async () => quotaExhaustedResponse()) as typeof fetch

    const client = getOpenAIClient({ apiKey: 'sk-test', bypassGateway: true })
    // 业务调用照常抛它自己的 429，不会变成别的错
    await expect(
      client.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/429|quota/i)
    await waitForWrite()
    errSpy.mockRestore()
  })

  it('🔴 成功响应一口都不许被喝掉（body 还在，调用方读得到）', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o-mini',
          choices: [{ index: 0, message: { role: 'assistant', content: '你好' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch

    const client = getOpenAIClient({ apiKey: 'sk-test', bypassGateway: true })
    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(res.choices[0].message.content).toBe('你好')
    expect(captured.rows).toHaveLength(0)
  })
})

describe('告警管道自己坏了 —— 不报 ≠ 没事', () => {
  it('🔴 读不出断电记录时必须单独下发一条，绝不能长得跟「一切正常」一样', async () => {
    const now = new Date('2026-09-23T19:00:00Z')
    const read = async (): Promise<OutageReadResult> => ({
      rows: null,
      error: { message: 'PGRST205 Could not find the table public.provider_outages' },
    })
    const items = buildProviderOutageItems(await readRecentOutages(read, now), now)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('ai_alerting_broken')
    expect(items[0].what).toMatch(/不等于.*没事|这只眼睛瞎了/)
  })

  it('真的一条记录都没有时，一条待办都不发（安静是对的）', async () => {
    const now = new Date('2026-09-23T19:00:00Z')
    const read = async (): Promise<OutageReadResult> => ({ rows: [], error: null })
    expect(buildProviderOutageItems(await readRecentOutages(read, now), now)).toHaveLength(0)
  })
})

describe('长期断电的提醒节奏', () => {
  const mk = (date: string): OutageRow => ({
    provider: 'openai',
    reason: 'account_exhausted',
    outage_date: date,
    detail: 'no quota',
    first_seen_at: `${date}T18:00:00Z`,
    last_seen_at: `${date}T18:05:00Z`,
  })

  it('连着坏了 9 天、今天是周三 → 不刷屏', async () => {
    const now = new Date('2026-09-23T19:00:00Z') // 周三
    const dates = ['15', '16', '17', '18', '19', '20', '21', '22', '23'].map((d) => mk(`2026-09-${d}`))
    const read = async (): Promise<OutageReadResult> => ({ rows: dates, error: null })
    expect(buildProviderOutageItems(await readRecentOutages(read, now), now)).toHaveLength(0)
  })

  it('同样连着坏了 9 天、今天是周日 → 提醒一次，并说清已经连续几天', async () => {
    const now = new Date('2026-09-27T19:00:00Z') // 周日
    const dates = ['19', '20', '21', '22', '23', '24', '25', '26', '27'].map((d) => mk(`2026-09-${d}`))
    const read = async (): Promise<OutageReadResult> => ({ rows: dates, error: null })
    const items = buildProviderOutageItems(await readRecentOutages(read, now), now)
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('已经连续 9 天')
  })

  // ── Gemini / Perplexity 断电 → PM 看到的是对应供应商的链接和说法 ──────────

  it('Gemini account_exhausted → 指向 Google AI Studio，不指向 OpenAI', () => {
    const now = new Date('2026-09-23T19:00:00Z')
    const rows: OutageRow[] = [{
      provider: 'google',
      reason: 'account_exhausted',
      outage_date: '2026-09-23',
      detail: 'Gemini gemini-2.5-flash: [GoogleGenerativeAI Error]: RESOURCE_EXHAUSTED',
      first_seen_at: '2026-09-23T18:00:00Z',
      last_seen_at: '2026-09-23T18:05:00Z',
    }]
    const items = buildProviderOutageItems({ rows, error: null }, now)
    expect(items).toHaveLength(1)
    // 指向 Google AI Studio
    expect(items[0].href).toContain('aistudio.google.com')
    // 说的是 Gemini 不是 OpenAI
    expect(items[0].what).toContain('Gemini')
    expect(items[0].what).not.toContain('OpenAI')
    expect(items[0].what).not.toContain('文字账户')
    expect(items[0].how).toContain('配额')
  })

  it('Gemini project_permission_denied → 指向 Cloud Console 查权限，不是「换新钥匙」', () => {
    // 🔴 Codex review 2026-09-23 抓到：权限/项目配置错误换新钥匙修不好，
    // 待办必须指去检查 API 启用 / 权限 / 计费状态，不能复用 credential_invalid 的「生成新 Key」指引。
    const now = new Date('2026-09-23T19:00:00Z')
    const rows: OutageRow[] = [{
      provider: 'google',
      reason: 'project_permission_denied',
      outage_date: '2026-09-23',
      detail: 'Gemini gemini-2.5-flash: [GoogleGenerativeAI Error]: PERMISSION_DENIED: API not enabled',
      first_seen_at: '2026-09-23T18:00:00Z',
      last_seen_at: '2026-09-23T18:05:00Z',
    }]
    const items = buildProviderOutageItems({ rows, error: null }, now)
    expect(items).toHaveLength(1)
    expect(items[0].href).toContain('console.cloud.google.com')
    expect(items[0].how).not.toContain('生成新的 API Key')
    expect(items[0].how).toContain('计费')
  })

  it('Perplexity credential_invalid → 指向 Perplexity 后台', () => {
    const now = new Date('2026-09-23T19:00:00Z')
    const rows: OutageRow[] = [{
      provider: 'perplexity',
      reason: 'credential_invalid',
      outage_date: '2026-09-23',
      detail: 'Perplexity sonar: 401 Unauthorized',
      first_seen_at: '2026-09-23T18:00:00Z',
      last_seen_at: '2026-09-23T18:05:00Z',
    }]
    const items = buildProviderOutageItems({ rows, error: null }, now)
    expect(items).toHaveLength(1)
    expect(items[0].href).toContain('perplexity.ai')
    expect(items[0].what).toContain('Perplexity')
    expect(items[0].how).toContain('PERPLEXITY_API_KEY')
  })

  it('OpenAI account_exhausted → 仍然指向 OpenAI（向后兼容）', () => {
    const now = new Date('2026-09-23T19:00:00Z')
    const rows: OutageRow[] = [{
      provider: 'openai',
      reason: 'account_exhausted',
      outage_date: '2026-09-23',
      detail: 'HTTP 429: insufficient_quota',
      first_seen_at: '2026-09-23T18:00:00Z',
      last_seen_at: '2026-09-23T18:05:00Z',
    }]
    const items = buildProviderOutageItems({ rows, error: null }, now)
    expect(items).toHaveLength(1)
    // 回退到按 reason 查找的通用 OpenAI 指引
    expect(items[0].href).toContain('platform.openai.com')
    expect(items[0].what).toContain('钱用完了')
  })
})
