// Creatomate 认证 fetch 封装。Spec §3.1/§4.3：
//   · 400/401/402/404 → JSON {hint, documentation}；429 → 纯文本（两种响应体形状必须分支解析，
//     不能假设都是 JSON——魏征警告的 any 高发区，这里从 unknown 起手 + 运行时校验）
//   · 限流约 30 req/10s/key，429/5xx 内部退避重试，不依赖调用方（也不依赖 Inngest 的 step 重试，
//     那个默认重试是给"整个 step 重放"用的，会把已经花钱的提交也重放，见 spec §4.4）
import { validateEnvVar } from '@/lib/validation-utils'
import { CreatomateApiError } from './types'

const API_BASE = 'https://api.creatomate.com/v2'
const RETRY_DELAYS_MS = [2000, 8000, 20000]

function apiKey(): string {
  return validateEnvVar('CREATOMATE_API_KEY')
}

function isCreatomateErrorBody(json: unknown): json is { hint: string; documentation?: string } {
  return typeof json === 'object' && json !== null && typeof (json as { hint?: unknown }).hint === 'string'
}

async function parseErrorBody(res: Response): Promise<{ message: string; hint?: string }> {
  const text = await res.text().catch(() => '')
  if (res.status === 429) {
    // 官方文档确认：429 返回纯文本，不是 JSON——先分支，不要对它调 JSON.parse。
    return { message: text || 'rate limited' }
  }
  try {
    const json: unknown = JSON.parse(text)
    if (isCreatomateErrorBody(json)) {
      return { message: json.hint, hint: json.hint }
    }
  } catch {
    // 响应体不是预期的 JSON 形状，落到下面用原文兜底。
  }
  return { message: text || `HTTP ${res.status}` }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 429/5xx 内部退避重试；4xx（除 429）不重试，直接抛（重试同样的请求还是会 4xx）。 */
export async function creatomateFetch(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<unknown> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
  }

  let lastError: CreatomateApiError | null = null
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, {
      method: init.method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })

    if (res.ok) return res.json()

    const { message, hint } = await parseErrorBody(res)
    lastError = new CreatomateApiError(message, res.status, hint)

    const retryable = res.status === 429 || res.status >= 500
    if (!retryable || attempt === RETRY_DELAYS_MS.length) throw lastError
    await sleep(RETRY_DELAYS_MS[attempt])
  }

  // 理论上不会到这里（循环要么 return 要么 throw），TypeScript 需要一个穷尽出口。
  throw lastError ?? new CreatomateApiError('unknown error', 0)
}
