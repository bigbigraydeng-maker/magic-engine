import type { Result } from '@/lib/agent-learning/contracts'

/** 默认模型名；可用环境变量 DEEPSEEK_MODEL 覆盖 */
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'

/** 默认官方 API 地址；可用环境变量 DEEPSEEK_BASE_URL 覆盖（自动去掉结尾斜杠） */
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

/** 单次请求默认超时（毫秒） */
export const DEFAULT_TIMEOUT_MS = 60_000

/** 价格常量：每百万 token 的美元单价，附带官方价格页与取价日期 */
export interface DeepSeekPrice {
  inputPerMTokUsd: number
  outputPerMTokUsd: number
  source: string
  checkedOn: string
}

/** 官方价格页 2026-10-25 取价；按"高峰时段、缓存未命中"取最坏价（非高峰是一半） */
export const DEEPSEEK_FLASH_PRICE: DeepSeekPrice = {
  inputPerMTokUsd: 0.3,
  outputPerMTokUsd: 1.2,
  source: 'https://api-docs.deepseek.com/quick_start/pricing',
  checkedOn: '2026-10-25',
}

/** 一次 JSON 补全的结果：正文 + 实际记录的 token 用量 + 实际使用的模型名 */
export interface JsonCompletion {
  text: string
  inputTokens: number
  outputTokens: number
  model: string
}

/** 一次 JSON 补全的入参；maxInputTokens 用于响应缺 usage 时按最坏值记账 */
export interface CompleteJsonRequest {
  system: string
  user: string
  maxOutputTokens: number
  maxInputTokens: number
  timeoutMs?: number
  /** 默认 'disabled'：思考模式的推理 token 计入输出上限，长输入时会把 max_tokens 吃光、正文为空（2026-10-25 试跑实测） */
  thinking?: 'enabled' | 'disabled'
}

/** 共用的 DeepSeek 客户端：只做 JSON 模式补全，不自动重试 */
export interface DeepSeekClient {
  model: string
  price: DeepSeekPrice
  completeJson(req: CompleteJsonRequest): Promise<Result<JsonCompletion>>
}

/** 注入用的最小 fetch 形状，便于测试替身替换，避免依赖全局实现 */
export type FetchLike = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/** fetch 返回值的非导出别名（仅内部使用） */
type RawResponse = Awaited<ReturnType<FetchLike>>

/** 判断一个值是否为有限非负数，用于 token 用量校验 */
function finiteNonNegative(value: unknown): number | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  if (value < 0) return null
  return value
}

/** 判断异常是否为超时/中止 */
function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = (error as { name?: unknown }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

/** 从响应信封里取出 choices[0].message.content；不合格返回 null */
function readCompletionContent(envelope: unknown): string | null {
  if (typeof envelope !== 'object' || envelope === null) return null
  const choices = (envelope as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) return null
  const message = (first as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string' || content.trim().length === 0) return null
  return content
}

/** 取 choices[0].finish_reason；'length' 表示输出被 max_tokens 截断 */
function readFinishReason(envelope: unknown): string | null {
  if (typeof envelope !== 'object' || envelope === null) return null
  const choices = (envelope as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) return null
  const reason = (first as { finish_reason?: unknown }).finish_reason
  return typeof reason === 'string' ? reason : null
}

/** 从响应信封里取模型名；不是字符串则回退到配置的模型名 */
function readResponseModel(envelope: unknown, fallback: string): string {
  if (typeof envelope !== 'object' || envelope === null) return fallback
  const model = (envelope as { model?: unknown }).model
  return typeof model === 'string' && model.trim().length > 0 ? model : fallback
}

/** 读取 usage；缺失或不合法时按最坏值记账（宁多记不少记） */
function readUsage(
  envelope: unknown,
  fallback: { inputTokens: number; outputTokens: number },
): { inputTokens: number; outputTokens: number } {
  if (typeof envelope !== 'object' || envelope === null) return fallback
  const usage = (envelope as { usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) return fallback
  const promptTokens = finiteNonNegative((usage as { prompt_tokens?: unknown }).prompt_tokens)
  const completionTokens = finiteNonNegative((usage as { completion_tokens?: unknown }).completion_tokens)
  return {
    inputTokens: promptTokens ?? fallback.inputTokens,
    outputTokens: completionTokens ?? fallback.outputTokens,
  }
}

/**
 * 创建共用 DeepSeek 客户端。
 * 环境变量在调用时读取；缺 key 返回失败而不抛错；无 key 时不发任何请求。
 */
export function createDeepSeekClient(
  env?: Record<string, string | undefined>,
  fetchImpl?: FetchLike,
): Result<DeepSeekClient> {
  const e = env ?? process.env
  const apiKey = (e.DEEPSEEK_API_KEY ?? '').trim()
  if (apiKey.length === 0) {
    return { ok: false, error: 'deepseek_api_key_missing', code: 'validation' }
  }

  const model = (e.DEEPSEEK_MODEL ?? '').trim() || DEFAULT_DEEPSEEK_MODEL
  const configuredBase = (e.DEEPSEEK_BASE_URL ?? '').trim() || DEFAULT_DEEPSEEK_BASE_URL
  const baseUrl = configuredBase.replace(/\/+$/, '')
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init))

  /** 单次 JSON 补全：一次请求、超时中止、失败不重试 */
  async function completeJson(req: CompleteJsonRequest): Promise<Result<JsonCompletion>> {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      response_format: { type: 'json_object' },
      max_tokens: req.maxOutputTokens,
      stream: false,
      thinking: { type: req.thinking ?? 'disabled' },
    })

    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: RawResponse | null = null
    try {
      response = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      return {
        ok: false,
        error: isAbortError(error) ? 'deepseek_timeout' : 'deepseek_network_error',
        code: 'db_error',
      }
    }

    if (response === null) {
      clearTimeout(timer)
      return { ok: false, error: 'deepseek_network_error', code: 'db_error' }
    }
    if (!response.ok) {
      clearTimeout(timer)
      return { ok: false, error: `deepseek_http_${response.status}`, code: 'db_error' }
    }

    let rawText: string
    try {
      rawText = await response.text()
    } catch (error) {
      return {
        ok: false,
        error: isAbortError(error) ? 'deepseek_timeout' : 'deepseek_network_error',
        code: 'db_error',
      }
    } finally {
      // 超时覆盖到读完响应正文为止，不只到响应头
      clearTimeout(timer)
    }

    let envelope: unknown
    try {
      envelope = JSON.parse(rawText) as unknown
    } catch {
      return { ok: false, error: 'deepseek_bad_response', code: 'validation' }
    }

    const content = readCompletionContent(envelope)
    if (content === null) {
      const truncated = readFinishReason(envelope) === 'length'
      return { ok: false, error: truncated ? 'deepseek_output_truncated' : 'deepseek_bad_response', code: 'validation' }
    }

    try {
      JSON.parse(content) as unknown
    } catch {
      return { ok: false, error: 'deepseek_non_json_content', code: 'validation' }
    }

    const usage = readUsage(envelope, {
      inputTokens: req.maxInputTokens,
      outputTokens: req.maxOutputTokens,
    })

    return {
      ok: true,
      value: {
        text: content,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        model: readResponseModel(envelope, model),
      },
    }
  }

  return {
    ok: true,
    value: {
      model,
      price: DEEPSEEK_FLASH_PRICE,
      completeJson,
    },
  }
}

/** 按实际 token 用量算美元花费（每百万 token 单价） */
export function costUsd(
  price: DeepSeekPrice,
  usage: { inputTokens: number; outputTokens: number },
): number {
  return (usage.inputTokens / 1_000_000) * price.inputPerMTokUsd
    + (usage.outputTokens / 1_000_000) * price.outputPerMTokUsd
}

/** 按最坏 token 用量算美元花费，用于请求前的额度预留 */
export function worstCaseUsd(
  price: DeepSeekPrice,
  maxInputTokens: number,
  maxOutputTokens: number,
): number {
  return costUsd(price, { inputTokens: maxInputTokens, outputTokens: maxOutputTokens })
}
