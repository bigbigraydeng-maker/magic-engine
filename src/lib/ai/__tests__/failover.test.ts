import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  askJson,
  buildProviders,
  classifyProviderError,
  listConfiguredProviders,
  AllProvidersFailedError,
  type AskJsonArgs,
  type FailoverClients,
} from '../failover'
import { createFailoverState } from '../failover-core'
import { MODEL_HAIKU } from '../../anthropic/client'

const Schema = z.object({ summary: z.string().min(1), n: z.number() })
const baseArgs: AskJsonArgs<z.infer<typeof Schema>> = {
  system: 'sys',
  user: 'usr',
  schema: Schema,
  jsonSchema: {
    name: 'card',
    schema: { type: 'object', properties: { summary: { type: 'string' }, n: { type: 'number' } }, required: ['summary', 'n'] },
  },
  totalBudgetMs: 2000,
}
const KEYS_ALL = { OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a', DEEPSEEK_API_KEY: 'd' }

describe('哪几家可用（钥匙 + DeepSeek 开关）', () => {
  it('🔴 DeepSeek 默认关：就算钥匙在，没设开关也永远不会被选中（客户内容不外发）', () => {
    expect(listConfiguredProviders(KEYS_ALL)).toEqual(['openai', 'anthropic'])
  })

  it('PM 点头后设 AI_FAILOVER_ALLOW_DEEPSEEK=1 才加入，而且排最后', () => {
    expect(listConfiguredProviders({ ...KEYS_ALL, AI_FAILOVER_ALLOW_DEEPSEEK: '1' })).toEqual(['openai', 'anthropic', 'deepseek'])
  })

  it('开关设了但没有钥匙 → 不加入', () => {
    expect(listConfiguredProviders({ OPENAI_API_KEY: 'o', AI_FAILOVER_ALLOW_DEEPSEEK: '1' })).toEqual(['openai'])
  })

  it('开关只认 "1"（"true" / "yes" 都不算，失败朝严）', () => {
    for (const v of ['true', 'yes', '0', '', ' 1 ']) {
      expect(listConfiguredProviders({ ...KEYS_ALL, AI_FAILOVER_ALLOW_DEEPSEEK: v })).not.toContain('deepseek')
    }
  })

  it('没钥匙的家不进列表（钥匙被撤/没填时不会去试一个必败的）', () => {
    expect(listConfiguredProviders({ ANTHROPIC_API_KEY: 'a' })).toEqual(['anthropic'])
    expect(listConfiguredProviders({})).toEqual([])
  })

  it('空白钥匙不算有', () => {
    expect(listConfiguredProviders({ OPENAI_API_KEY: '   ', ANTHROPIC_API_KEY: 'a' })).toEqual(['anthropic'])
  })
})

describe('失败分类', () => {
  it('🔴 Anthropic 没钱时返回的是 HTTP 400（不是 402/429）：必须判成账户级，不能判成「调用方写错了」', () => {
    // 判成 request_invalid 会让一次断电被当成程序 bug，而且不会换家。
    const err = Object.assign(new Error('Your credit balance is too low to access the Anthropic API.'), { status: 400 })
    expect(classifyProviderError('anthropic', err)).toBe('account_exhausted')
  })

  it('Anthropic 普通 400 才是 request_invalid', () => {
    const err = Object.assign(new Error('messages: text content blocks must be non-empty'), { status: 400 })
    expect(classifyProviderError('anthropic', err)).toBe('request_invalid')
  })

  it('Anthropic 401/403 → 钥匙不认；429 → 限流（不冷却）；529 → other', () => {
    expect(classifyProviderError('anthropic', Object.assign(new Error('x'), { status: 401 }))).toBe('credential_invalid')
    expect(classifyProviderError('anthropic', Object.assign(new Error('x'), { status: 403 }))).toBe('credential_invalid')
    expect(classifyProviderError('anthropic', Object.assign(new Error('x'), { status: 429 }))).toBe('rate_limited')
    expect(classifyProviderError('anthropic', Object.assign(new Error('x'), { status: 529 }))).toBe('other')
  })

  it('DeepSeek：402 = 余额不足，401 = 钥匙，400 = 调用方写错', () => {
    expect(classifyProviderError('deepseek', new Error('deepseek_http_402'))).toBe('account_exhausted')
    expect(classifyProviderError('deepseek', new Error('deepseek_http_401'))).toBe('credential_invalid')
    expect(classifyProviderError('deepseek', new Error('deepseek_http_400'))).toBe('request_invalid')
    expect(classifyProviderError('deepseek', new Error('deepseek_timeout'))).toBe('other')
  })

  it('OpenAI：账户级判据原样复用现有分类器；普通 400 才是 request_invalid', () => {
    const noCredit = Object.assign(new Error('x'), {
      status: 429,
      error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'You have no credits remaining' },
    })
    expect(classifyProviderError('openai', noCredit)).toBe('account_exhausted')
    expect(classifyProviderError('openai', Object.assign(new Error('bad'), { status: 400 }))).toBe('request_invalid')
    expect(classifyProviderError('openai', new Error('network'))).toBe('other')
  })

  it('型号常量跟 anthropic/client.ts 的 MODEL_HAIKU 一致（两处各写一份，由这条钉住）', async () => {
    const seen: string[] = []
    const clients: FailoverClients = {
      anthropic: () => ({
        messages: {
          create: async (body) => {
            seen.push((body as { model: string }).model)
            return { content: [{ type: 'tool_use', input: { summary: 's', n: 1 } }] }
          },
        },
      }),
    }
    const [p] = buildProviders(baseArgs as AskJsonArgs<unknown>, { ANTHROPIC_API_KEY: 'a' }, clients)
    await p.call(new AbortController().signal)
    expect(seen[0]).toBe(MODEL_HAIKU)
  })
})

describe('三家的请求形状', () => {
  it('🔴 OpenAI：maxRetries 必须是 0（SDK 默认对 429 重试两次，单家吃 20 秒，把整个预算烧光）', async () => {
    const create = vi.fn(async () => ({ output_text: '{"summary":"s","n":1}' }))
    const clients: FailoverClients = { openai: () => ({ responses: { create } }) }
    const [p] = buildProviders({ ...baseArgs, openaiModel: 'gpt-x' } as AskJsonArgs<unknown>, { OPENAI_API_KEY: 'o' }, clients)
    const signal = new AbortController().signal
    expect(await p.call(signal)).toEqual({ summary: 's', n: 1 })
    const [body, opts] = create.mock.calls[0] as unknown as [Record<string, unknown>, { signal: AbortSignal; maxRetries: number }]
    expect(opts.maxRetries).toBe(0)
    expect(opts.signal).toBe(signal)
    expect(body.model).toBe('gpt-x')
    // 不开 strict：现在在跑的调用也没开，换了就是行为变更
    expect(JSON.stringify(body)).not.toContain('"strict"')
  })

  it('🔴 Anthropic：强制工具调用 + maxRetries 0，工具名和入参定义来自同一份 jsonSchema', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'text' }, { type: 'tool_use', input: { summary: 's', n: 2 } }] }))
    const clients: FailoverClients = { anthropic: () => ({ messages: { create } }) }
    const [p] = buildProviders(baseArgs as AskJsonArgs<unknown>, { ANTHROPIC_API_KEY: 'a' }, clients)
    expect(await p.call(new AbortController().signal)).toEqual({ summary: 's', n: 2 })
    const [body, opts] = create.mock.calls[0] as unknown as [
      { tools: Array<{ name: string; input_schema: unknown }>; tool_choice: { type: string; name: string } },
      { maxRetries: number },
    ]
    expect(opts.maxRetries).toBe(0)
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'card' })
    expect(body.tools[0].name).toBe('card')
    expect(body.tools[0].input_schema).toBe(baseArgs.jsonSchema.schema)
  })

  it('🔴 备用后缀只给备用模型：OpenAI 的提示词一字不变，Claude / DeepSeek 追加', async () => {
    const SUFFIX = '\n\nFINAL CHECK: answer in Chinese.'
    const sent: Record<string, string> = {}
    const clients: FailoverClients = {
      openai: () => ({
        responses: {
          create: async (body) => {
            sent.openai = JSON.stringify((body as { input: unknown }).input)
            return { output_text: '{}' }
          },
        },
      }),
      anthropic: () => ({
        messages: {
          create: async (body) => {
            sent.anthropic = (body as { system: string }).system
            return { content: [{ type: 'tool_use', input: {} }] }
          },
        },
      }),
      deepseek: () => ({
        completeJson: async (req) => {
          sent.deepseek = req.system
          return { ok: true as const, value: { text: '{}', model: 'deepseek' } }
        },
      }),
    }
    const providers = buildProviders(
      { ...baseArgs, backupSystemSuffix: SUFFIX } as AskJsonArgs<unknown>,
      { ...KEYS_ALL, AI_FAILOVER_ALLOW_DEEPSEEK: '1' },
      clients,
    )
    for (const p of providers) await p.call(new AbortController().signal)
    expect(sent.openai).not.toContain('FINAL CHECK')
    expect(sent.openai).toContain('"sys"')
    expect(sent.anthropic).toBe(`sys${SUFFIX}`)
    // DeepSeek 的提示词 = 原文 + 备用后缀 + JSON 指令（见下面专门的测试），所以只验前缀
    expect(sent.deepseek.startsWith(`sys${SUFFIX}`)).toBe(true)
  })

  // 🔴 下面两条钉的是 2026-10-26 真实对话试跑查出来的 bug：5 条请求 5 条 HTTP 400。
  //    DeepSeek 的 json_object 模式 ① 提示词里必须出现 "json" 这个词，否则一律 400；
  //    ② 只保证返回合法 JSON、不认识我们的格式 —— 不把 schema 写进提示词它会自己编结构。
  //    单测里的假客户端永远不会 400，这个 bug 只有真调用才暴露。
  it('🔴 DeepSeek：提示词里必须有 "json" 这个词（没有的话 DeepSeek 对每条请求都 400）', async () => {
    let sentSystem = ''
    const clients: FailoverClients = {
      deepseek: () => ({
        completeJson: async (req) => {
          sentSystem = req.system
          return { ok: true as const, value: { text: '{}', model: 'deepseek' } }
        },
      }),
    }
    const [p] = buildProviders(baseArgs as AskJsonArgs<unknown>, { DEEPSEEK_API_KEY: 'd', AI_FAILOVER_ALLOW_DEEPSEEK: '1' }, clients)
    await p.call(new AbortController().signal)
    expect(sentSystem).toMatch(/json/i)
  })

  it('🔴 DeepSeek：要把 schema 原文写进提示词（它不靠 API 参数拿格式）', async () => {
    let sentSystem = ''
    const clients: FailoverClients = {
      deepseek: () => ({
        completeJson: async (req) => {
          sentSystem = req.system
          return { ok: true as const, value: { text: '{}', model: 'deepseek' } }
        },
      }),
    }
    const [p] = buildProviders(baseArgs as AskJsonArgs<unknown>, { DEEPSEEK_API_KEY: 'd', AI_FAILOVER_ALLOW_DEEPSEEK: '1' }, clients)
    await p.call(new AbortController().signal)
    expect(sentSystem).toContain(JSON.stringify(baseArgs.jsonSchema.schema))
    expect(sentSystem).toContain('required')
  })

  it('OpenAI 和 Claude 不受影响：它们靠 API 参数拿格式，提示词里不拼 schema', async () => {
    const sent: string[] = []
    const clients: FailoverClients = {
      openai: () => ({ responses: { create: async (body) => { sent.push(JSON.stringify((body as { input: unknown }).input)); return { output_text: '{}' } } } }),
      anthropic: () => ({ messages: { create: async (body) => { sent.push((body as { system: string }).system); return { content: [{ type: 'tool_use', input: {} }] } } } }),
    }
    for (const p of buildProviders(baseArgs as AskJsonArgs<unknown>, KEYS_ALL, clients)) await p.call(new AbortController().signal)
    for (const text of sent) expect(text).not.toContain('"required"')
  })

  it('没传后缀时备用模型的提示词也一字不变', async () => {
    let seen = ''
    const clients: FailoverClients = {
      anthropic: () => ({
        messages: {
          create: async (body) => {
            seen = (body as { system: string }).system
            return { content: [{ type: 'tool_use', input: {} }] }
          },
        },
      }),
    }
    const [p] = buildProviders(baseArgs as AskJsonArgs<unknown>, { ANTHROPIC_API_KEY: 'a' }, clients)
    await p.call(new AbortController().signal)
    expect(seen).toBe('sys')
  })

  it('Anthropic 没回工具块 → 抛错（不能把空当成成功）', async () => {
    const clients: FailoverClients = {
      anthropic: () => ({ messages: { create: async () => ({ content: [{ type: 'text' }] }) } }),
    }
    const [p] = buildProviders(baseArgs as AskJsonArgs<unknown>, { ANTHROPIC_API_KEY: 'a' }, clients)
    await expect(p.call(new AbortController().signal)).rejects.toThrow('anthropic_no_tool_use_block')
  })

  it('DeepSeek 的超时毫秒是整数（总预算除不尽时也不把小数交给定时器）', async () => {
    let timeoutMs = -1
    const clients: FailoverClients = {
      deepseek: () => ({
        completeJson: async (req) => {
          timeoutMs = req.timeoutMs ?? -1
          return { ok: true as const, value: { text: '{}', model: 'deepseek' } }
        },
      }),
    }
    const args = { ...(baseArgs as AskJsonArgs<unknown>), totalBudgetMs: 20_000 / 3 }
    const [p] = buildProviders(args, { DEEPSEEK_API_KEY: 'd', AI_FAILOVER_ALLOW_DEEPSEEK: '1' }, clients)
    await p.call(new AbortController().signal)
    expect(timeoutMs).toBe(6_666)
    expect(Number.isInteger(timeoutMs)).toBe(true)
  })

  it('DeepSeek：客户端报错要原样抛出（状态码才分得出是没钱还是写错）', async () => {
    const clients: FailoverClients = {
      deepseek: () => ({ completeJson: async () => ({ ok: false as const, error: 'deepseek_http_402' }) }),
    }
    const [p] = buildProviders(
      baseArgs as AskJsonArgs<unknown>,
      { DEEPSEEK_API_KEY: 'd', AI_FAILOVER_ALLOW_DEEPSEEK: '1' },
      clients,
    )
    await expect(p.call(new AbortController().signal)).rejects.toThrow('deepseek_http_402')
  })
})

describe('askJson 端到端（注入三家，不碰网络）', () => {
  const ok = { summary: 'hello', n: 1 }
  const mk = (provider: 'openai' | 'anthropic', call: () => Promise<unknown>) => ({ provider, model: `${provider}-m`, call })

  it('健康时由第一家回答，并如实回报是谁答的', async () => {
    const r = await askJson(baseArgs, { providers: [mk('openai', async () => ok), mk('anthropic', async () => ok)], state: createFailoverState(), onProviderFailure: () => {} })
    expect(r.provider).toBe('openai')
    expect(r.model).toBe('openai-m')
    expect(r.data).toEqual(ok)
  })

  it('🔴 第一家没钱 → 第二家救回来，回报的 provider 是第二家（调用方要把它写进库）', async () => {
    const noCredit = Object.assign(new Error('x'), {
      status: 429,
      error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'no credits' },
    })
    const r = await askJson(baseArgs, {
      providers: [mk('openai', async () => Promise.reject(noCredit)), mk('anthropic', async () => ok)],
      state: createFailoverState(),
      onProviderFailure: () => {},
    })
    expect(r.provider).toBe('anthropic')
  })

  it('🔴 模型答的东西过不了校验（空 summary）→ 不能当成功，换下一家', async () => {
    const r = await askJson(baseArgs, {
      providers: [mk('openai', async () => ({ summary: '', n: 1 })), mk('anthropic', async () => ok)],
      state: createFailoverState(),
      onProviderFailure: () => {},
    })
    expect(r.provider).toBe('anthropic')
  })

  it('全部没钱 → 抛 AllProvidersFailedError，且 accountLevel 为真（调用方据此当场停下整轮）', async () => {
    const noCredit = Object.assign(new Error('x'), {
      status: 429,
      error: { code: 'insufficient_quota', type: 'insufficient_quota', message: 'no credits' },
    })
    const billing = Object.assign(new Error('Your credit balance is too low'), { status: 400 })
    let caught: unknown
    try {
      await askJson(baseArgs, {
        providers: [mk('openai', async () => Promise.reject(noCredit)), mk('anthropic', async () => Promise.reject(billing))],
        state: createFailoverState(),
        onProviderFailure: () => {},
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AllProvidersFailedError)
    expect((caught as AllProvidersFailedError).accountLevel).toBe(true)
    expect((caught as AllProvidersFailedError).kinds).toEqual({ openai: 'account_exhausted', anthropic: 'account_exhausted' })
  })

  it('没有任何可用供应商 → 抛 AllProvidersFailedError(attempts 0)，不是别的错', async () => {
    await expect(askJson(baseArgs, { providers: [], state: createFailoverState() })).rejects.toBeInstanceOf(AllProvidersFailedError)
  })
})
