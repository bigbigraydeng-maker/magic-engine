/**
 * AI 供应商自动切换：「按这个格式回答我」，OpenAI 没钱时换 Claude，（经 PM 同意后）再换 DeepSeek。
 *
 * 设计稿：docs/specs/2026-10-26-ai-provider-failover-design-v1.md（已吸收子牙 + 魏征两审）。
 * 编排逻辑（冷却、预算切片、重试）在 `failover-core.ts`，这里只管三家的接线和失败分类。
 *
 * 🔴 第一版（刀 1）**不接任何调用方**：这个文件合进主干后，线上行为零变化。
 */

import type { z } from 'zod'
import {
  AllProvidersFailedError,
  createFailoverState,
  integerTimeoutMs,
  runFailover,
  type FailoverFailureKind,
  type FailoverProvider,
  type FailoverState,
  type Provider,
} from './failover-core'
import { classifyThrownOpenAIError } from './provider-failure'
import { getOpenAIClient } from './openai-client'
import { getAnthropicClientDirect } from '../anthropic/client'
import { createDeepSeekClient } from '../agent-learning/llm/deepseek-client'

export { AllProvidersFailedError }
export type { Provider }

/** 进程内的冷却记忆。多进程各管各的 —— 冷却只是省时间，不是账本（账本是 provider_outages）。 */
const processState: FailoverState = createFailoverState()

export interface AskJsonArgs<T> {
  system: string
  user: string
  /**
   * 校验用的尺子。🔴 必须**不带 `.default()`**：带默认值的 schema 比 json_schema 宽，
   * 备用模型只答三个字段也能过关，其余被默认值悄悄填空 —— 一张「摘要有、需求承诺全空」
   * 的卡会被当成成功（子牙审查 2026-10-26）。
   */
  schema: z.ZodType<T>
  /** 给 OpenAI / Claude 看的 JSON schema（带 description）。Claude 把它当工具的入参定义。 */
  jsonSchema: { name: string; description?: string; schema: Record<string, unknown> }
  /** 整次调用的**总**预算，不是单家的。核心会按剩余家数切给每一家。 */
  totalBudgetMs: number
  signal?: AbortSignal
  /** brief.ts 现在传 true：responses.create 从没走过 CF 网关，不拿零证据的路由换在跑的链路。 */
  bypassGateway?: boolean
  openaiModel?: string
  maxOutputTokens?: number
  /**
   * 只追加给**备用模型**（Claude / DeepSeek）的提示词后缀，主力 OpenAI 不受影响。
   *
   * 为什么要有这个口子：同一份提示词，备用模型守不守规矩不一样。2026-10-26 在真实 CTS
   * 邮件对话上并排试跑：要求「一句话/下一步写中文」，Claude 8 张里只有 5 张照做；
   * 末尾加一句语言提醒后 8/8，速度不变。这个后缀的内容是**调用方的事**（切换层不知道
   * 简报要求中文，换个场景就是别的要求），所以做成参数，不写死在这一层。
   */
  backupSystemSuffix?: string
}

export interface AskJsonResult<T> {
  data: T
  provider: Provider
  model: string
}

/** 三家的接口，只取我们用到的那一小块 —— 测试注入假的，整条链路不碰网络。 */
export interface FailoverClients {
  openai?: () => {
    responses: { create(body: unknown, opts: { signal: AbortSignal; maxRetries: number }): Promise<{ output_text?: string }> }
  }
  anthropic?: () => {
    messages: {
      create(
        body: unknown,
        opts: { signal: AbortSignal; maxRetries: number },
      ): Promise<{ content: Array<{ type: string; input?: unknown }> }>
    }
  }
  deepseek?: () => {
    completeJson(req: {
      system: string
      user: string
      maxOutputTokens: number
      maxInputTokens: number
      timeoutMs?: number
    }): Promise<{ ok: true; value: { text: string; model: string } } | { ok: false; error: string }>
  } | null
}

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
const DEFAULT_MAX_OUTPUT = 4096
/** Claude Haiku 4.5，跟 `anthropic/client.ts` 的 MODEL_HAIKU 同值（那边是 const，这里不跨文件耦合型号变更的时机，由测试钉住两者一致）。 */
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'
const DEEPSEEK_MODEL_LABEL = 'deepseek'

type Env = Record<string, string | undefined>

function hasKey(env: Env, name: string): boolean {
  return (env[name] ?? '').trim().length > 0
}

/**
 * 哪几家现在可用。**DeepSeek 默认关**：它是中国公司，而简报要喂的是全部客户的私信和邮件原文，
 * 范围比「CTS 一个客户的通话转写」那个先例大一个数量级 —— 开不开是 PM 的决定，
 * 不设 `AI_FAILOVER_ALLOW_DEEPSEEK=1` 就永远不会把客户内容发给它。
 */
export function listConfiguredProviders(env: Env = process.env): Provider[] {
  const out: Provider[] = []
  if (hasKey(env, 'OPENAI_API_KEY')) out.push('openai')
  if (hasKey(env, 'ANTHROPIC_API_KEY')) out.push('anthropic')
  if (env.AI_FAILOVER_ALLOW_DEEPSEEK === '1' && hasKey(env, 'DEEPSEEK_API_KEY')) out.push('deepseek')
  return out
}

function statusOf(err: unknown): number {
  const s = (err as { status?: unknown } | null)?.status
  return typeof s === 'number' ? s : 0
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err ?? '')
}

/**
 * Anthropic：没钱时返回的是 **HTTP 400**（`invalid_request_error`，"credit balance is too low"），
 * 不是 402/429。🔴 如果先套「400 = 调用方写错了」，一次断电会被判成程序 bug，**而且不会换家**。
 * 所以余额/账单判断必须排在 400 规则前面。
 */
function classifyAnthropic(err: unknown): FailoverFailureKind {
  const status = statusOf(err)
  const text = messageOf(err).toLowerCase()
  if (status === 402 || /credit balance|billing|insufficient (funds|credit)/.test(text)) return 'account_exhausted'
  if (status === 401 || status === 403) return 'credential_invalid'
  if (status === 429) return 'rate_limited'
  if (status === 400 || status === 422) return 'request_invalid'
  return 'other'
}

/** DeepSeek 客户端把 HTTP 状态拼进错误串（`deepseek_http_402`）。402 = 余额不足。 */
function classifyDeepSeek(err: unknown): FailoverFailureKind {
  const m = /deepseek_http_(\d+)/.exec(messageOf(err))
  const status = m ? Number(m[1]) : 0
  if (status === 402) return 'account_exhausted'
  if (status === 401) return 'credential_invalid'
  if (status === 429) return 'rate_limited'
  if (status === 400 || status === 422) return 'request_invalid'
  return 'other'
}

/** OpenAI：账户级判据**原样复用**现有的分类器，不在这里重写第三份错误码清单（会漂移）。 */
function classifyOpenAI(err: unknown): FailoverFailureKind {
  const status = statusOf(err)
  const kind = classifyThrownOpenAIError(err)
  if (kind === 'other' && (status === 400 || status === 422)) return 'request_invalid'
  return kind
}

export function classifyProviderError(provider: Provider, err: unknown): FailoverFailureKind {
  if (provider === 'anthropic') return classifyAnthropic(err)
  if (provider === 'deepseek') return classifyDeepSeek(err)
  return classifyOpenAI(err)
}

function parseJsonObject(text: string | undefined): unknown {
  return JSON.parse(text && text.trim().length > 0 ? text : '{}')
}

function openaiProvider(
  a: AskJsonArgs<unknown>,
  client: NonNullable<FailoverClients['openai']>,
): FailoverProvider {
  const model = a.openaiModel ?? DEFAULT_OPENAI_MODEL
  return {
    provider: 'openai',
    model,
    async call(signal) {
      const res = await client().responses.create(
        {
          model,
          input: [
            { role: 'system', content: a.system },
            { role: 'user', content: a.user },
          ],
          // 不开 strict：现在在跑的调用也没开，换了就是行为变更。
          text: { format: { type: 'json_schema', name: a.jsonSchema.name, schema: a.jsonSchema.schema } },
        },
        // maxRetries: 0 —— SDK 对 429 默认重试两次，一次断电单家就吃 20 秒，把整个预算烧光，
        // 切换根本来不及发请求。切换语境下「同一家再试」是纯损耗，下一步是换家。
        { signal, maxRetries: 0 },
      )
      return parseJsonObject(res.output_text)
    },
  }
}

function anthropicProvider(
  a: AskJsonArgs<unknown>,
  client: NonNullable<FailoverClients['anthropic']>,
): FailoverProvider {
  return {
    provider: 'anthropic',
    model: ANTHROPIC_MODEL,
    async call(signal) {
      const system = a.backupSystemSuffix ? `${a.system}${a.backupSystemSuffix}` : a.system
      // 强制工具调用是 Anthropic 官方推荐的拿结构化输出的办法：把 schema 当工具的入参定义，
      // tool_choice 指定它，模型就只能按这个形状回。
      const res = await client().messages.create(
        {
          model: ANTHROPIC_MODEL,
          max_tokens: a.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
          system,
          messages: [{ role: 'user', content: a.user }],
          tools: [
            {
              name: a.jsonSchema.name,
              description: a.jsonSchema.description ?? 'Return the answer in this exact shape.',
              input_schema: a.jsonSchema.schema,
            },
          ],
          tool_choice: { type: 'tool', name: a.jsonSchema.name },
        },
        { signal, maxRetries: 0 },
      )
      const block = res.content.find((b) => b.type === 'tool_use')
      if (!block || block.input === undefined) throw new Error('anthropic_no_tool_use_block')
      return block.input
    },
  }
}

function deepseekProvider(
  a: AskJsonArgs<unknown>,
  client: NonNullable<FailoverClients['deepseek']>,
): FailoverProvider | null {
  const c = client()
  if (c === null) return null
  return {
    provider: 'deepseek',
    model: DEEPSEEK_MODEL_LABEL,
    async call(signal) {
      // 🔴 DeepSeek 的 `json_object` 模式有两个坑，2026-10-26 用真实对话试跑时 5/5 全部撞上（HTTP 400）：
      //    ① 提示词里**必须出现 "json" 这个词**，否则一律 400（"Prompt must contain the word 'json'"）；
      //    ② 它只保证返回合法 JSON，**不认识我们的格式** —— 不把 schema 写进提示词，它会自己编一个结构。
      //    OpenAI / Claude 靠 API 参数拿格式，DeepSeek 只能靠提示词，所以这里把 schema 原文拼进去。
      const system = [
        a.backupSystemSuffix ? `${a.system}${a.backupSystemSuffix}` : a.system,
        '',
        'Respond with exactly ONE JSON object and nothing else (no markdown fences, no commentary).',
        'The JSON object must match this JSON schema exactly — include every required field:',
        JSON.stringify(a.jsonSchema.schema),
      ].join('\n')
      // DeepSeek 客户端只收超时、不收 signal：这里把 signal 赛一下，到点就放弃等它。
      const aborted = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('deepseek_aborted')), { once: true })
      })
      const res = await Promise.race([
        c.completeJson({
          system,
          user: a.user,
          maxOutputTokens: a.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
          maxInputTokens: 100_000,
          timeoutMs: integerTimeoutMs(Math.min(a.totalBudgetMs, 60_000)),
        }),
        aborted,
      ])
      if (!res.ok) throw new Error(res.error)
      return parseJsonObject(res.value.text)
    },
  }
}

/** 按配置的钥匙和默认客户端，造出这一次要试的供应商列表（顺序：OpenAI → Claude → DeepSeek）。 */
export function buildProviders(
  a: AskJsonArgs<unknown>,
  env: Env = process.env,
  clients: FailoverClients = defaultClients(a, env),
): FailoverProvider[] {
  const out: FailoverProvider[] = []
  for (const p of listConfiguredProviders(env)) {
    if (p === 'openai' && clients.openai) out.push(openaiProvider(a, clients.openai))
    if (p === 'anthropic' && clients.anthropic) out.push(anthropicProvider(a, clients.anthropic))
    if (p === 'deepseek' && clients.deepseek) {
      const d = deepseekProvider(a, clients.deepseek)
      if (d) out.push(d)
    }
  }
  return out
}

/**
 * 生产用的三家客户端。只在 `call()` 真被调用时才实例化（CLAUDE.md §7：SDK 客户端
 * 不在模块顶层初始化）—— 这里 import 的只是函数，不是客户端。
 */
function defaultClients(a: AskJsonArgs<unknown>, env: Env): FailoverClients {
  return {
    openai: () =>
      getOpenAIClient({ apiKey: env.OPENAI_API_KEY, bypassGateway: a.bypassGateway }) as unknown as ReturnType<
        NonNullable<FailoverClients['openai']>
      >,
    // 直连，不走 CF 网关：brief.ts 的 OpenAI 调用就是刻意不走网关的（`bypassGateway: true`），
    // 第二家若默认走网关，等于用一条没为这个负载验过的路由（还带网关自己的 524 超时）换在跑的链路。
    anthropic: () => getAnthropicClientDirect() as unknown as ReturnType<NonNullable<FailoverClients['anthropic']>>,
    deepseek: () => {
      const made = createDeepSeekClient(env)
      return made.ok ? (made.value as unknown as NonNullable<ReturnType<NonNullable<FailoverClients['deepseek']>>>) : null
    },
  }
}

/**
 * Claude / DeepSeek 没有 OpenAI 那样的拦截点，账户级失败得由这里补记 —— 否则切到 Claude 之后
 * Claude 也没钱，会静默滑到下一家，台账上永远只有 openai 一家（子牙审查 P0）。
 * OpenAI 自己的失败已经由 `openai-client.ts` 的拦截点记过，这里不重复。
 */
async function recordNonOpenAIOutage(provider: Provider, kind: FailoverFailureKind, err: unknown): Promise<void> {
  if (provider === 'openai') return
  if (kind !== 'account_exhausted' && kind !== 'credential_invalid') return
  try {
    const ledger = await import('./outage-ledger')
    const now = new Date()
    if (!ledger.shouldWriteNow(provider, kind, now)) return
    const { supabaseAdmin } = await import('@/lib/supabase')
    await ledger.recordProviderOutage(ledger.makeSupabaseOutageWriter(supabaseAdmin), {
      provider,
      reason: kind,
      detail: messageOf(err).slice(0, 300),
      now,
    })
  } catch (e) {
    console.error('[ai-failover] 补记断电台账失败:', e instanceof Error ? e.message : String(e))
  }
}

export interface AskJsonDeps {
  providers?: FailoverProvider[]
  state?: FailoverState
  now?: () => number
  onProviderFailure?: (provider: Provider, kind: FailoverFailureKind, err: unknown) => void
}

export async function askJson<T>(args: AskJsonArgs<T>, deps: AskJsonDeps = {}): Promise<AskJsonResult<T>> {
  const providers = deps.providers ?? buildProviders(args as AskJsonArgs<unknown>)
  const result = await runFailover<T>({
    providers,
    validate: (raw) => args.schema.parse(raw),
    classifyError: classifyProviderError,
    totalBudgetMs: args.totalBudgetMs,
    signal: args.signal,
    now: deps.now ?? (() => Date.now()),
    state: deps.state ?? processState,
    onProviderFailure:
      deps.onProviderFailure ??
      ((provider, kind, err) => {
        void recordNonOpenAIOutage(provider, kind, err)
      }),
  })
  return { data: result.data, provider: result.provider, model: result.model }
}
