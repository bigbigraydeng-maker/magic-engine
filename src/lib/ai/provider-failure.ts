/**
 * 「这次 AI 调用失败，是账户层面的事，还是这一次的事？」—— 纯函数，可完全单测。
 *
 * WHY
 * ---
 * 2026-09-20 18:01~19:11 (UTC) ME 唯一那把 `OPENAI_API_KEY` 背后的账户余额耗尽，
 * 约 35 个调用点一起死，**三天没人知道**。根因中的根因：几乎每个模块的
 * 「优雅降级」判据写的都是 `if (!process.env.OPENAI_API_KEY)` —— 只挡**钥匙丢了**。
 * 钥匙在、但账户没钱走的是完全不同的分支（HTTP 429 + `insufficient_quota`），
 * 而那条分支上大部分是 `catch {}`。设计者以为的「AI 不可用就降级」，
 * 在真实故障形态下一次都没触发。
 *
 * 所以这里要回答的核心问题只有一个：**这次 429 是「没钱了」还是「太快了」？**
 * 两者 HTTP 状态码相同，处置方式完全相反 ——
 *   · 没钱了 = 账户级失效，只有人能修（去充值），必须当天摆到 PM 眼前
 *   · 太快了 = 单次限流，SDK 自己会重试，报出去只会制造噪音
 * 分不清这两件事，就只能二选一：要么天天误报，要么三天不报。
 */

/**
 * 判定结果。只有 `account_exhausted` / `credential_invalid` / `gateway_auth_failed`
 * 需要惊动人 —— 它们的共同点是**重试一万次也不会好**。
 */
export type ProviderFailureKind =
  /** 账户没钱 / 撞了账单硬顶 / 账户被停 —— 只有人去充值或恢复账户才行 */
  | 'account_exhausted'
  /** 钥匙本身不认了（被撤销 / 打错 / 过期）—— 要人去换钥匙 */
  | 'credential_invalid'
  /**
   * 卡在 Cloudflare AI Gateway 这一层，还没走到 OpenAI。
   *
   * 🔴 必须跟 `credential_invalid` 分开：`openai-client.ts` 的注释是 2026-07-14
   *    的实测结论 —— CF AI Gateway 认证模式下缺 `cf-aig-authorization` 会**直接 401**，
   *    OpenAI 的钥匙一点毛病没有。混成一条，PM 会被支去 OpenAI 后台查一把好钥匙，
   *    正是 CLAUDE.md 铁律 3 说的「下发了但没法照做」。
   */
  | 'gateway_auth_failed'
  /** 这一次太快了 —— SDK 自己会重试，**不报** */
  | 'rate_limited'
  /** 其它（5xx / 参数错 / 读不出来）—— 不猜，不报 */
  | 'other'

export interface ProviderFailureInput {
  status: number
  /** 响应体原文（可能不是 JSON，可能是 Cloudflare 吐的一整页 HTML） */
  body: string
  /** 响应头。用来认出「这是网关回的，不是 OpenAI 回的」 */
  headers?: Record<string, string>
}

/** OpenAI 明确表示「账户这边出问题了」的错误码 —— 白名单，不做模糊匹配。 */
const ACCOUNT_LEVEL_CODES = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'billing_not_active',
  'account_deactivated',
])

const CREDENTIAL_CODES = new Set([
  'invalid_api_key',
  'invalid_organization',
])

/** 响应体最多看这么多字节 —— 网关挂掉时 5xx 可能吐一整页 HTML。 */
const MAX_BODY_SCAN = 4096

interface ParsedError {
  code: string
  type: string
  message: string
}

/**
 * 把响应体里的 `{ error: { code, type, message } }` 抠出来。
 *
 * 解析不出来就返回空串 —— **绝不从 message 里猜**。猜错的代价是把一次限流
 * 报成「账户没钱」，PM 跑去看一个好好的账户，下次就不信这条告警了。
 */
export function parseProviderError(body: string): ParsedError {
  const empty = { code: '', type: '', message: '' }
  const head = body.slice(0, MAX_BODY_SCAN)
  let parsed: unknown
  try {
    parsed = JSON.parse(head)
  } catch {
    return empty
  }
  if (parsed === null || typeof parsed !== 'object') return empty
  const err = (parsed as Record<string, unknown>).error
  if (err === null || typeof err !== 'object') return empty
  const e = err as Record<string, unknown>
  return {
    code: typeof e.code === 'string' ? e.code : '',
    type: typeof e.type === 'string' ? e.type : '',
    message: typeof e.message === 'string' ? e.message : '',
  }
}

/** 这次失败是不是根本没走到 OpenAI，而是卡在 Cloudflare AI Gateway。 */
function looksLikeGateway(input: ProviderFailureInput): boolean {
  const headers = input.headers ?? {}
  for (const key of Object.keys(headers)) {
    const k = key.toLowerCase()
    if (k.startsWith('cf-aig-') || k === 'cf-ray') return true
  }
  // 网关自己的错误体不是 OpenAI 的 `{error:{code,type}}` 形状，常见是纯文本或 HTML
  return /cloudflare|ai gateway|cf-aig/i.test(input.body.slice(0, MAX_BODY_SCAN))
}

/**
 * 判这次失败属于哪一类。
 *
 * 🔴 判定顺序是刻意的：**先认账户级的明确错误码，再看状态码。**
 *    反过来写（先按 429 判限流）就会把 `insufficient_quota` 吃掉 ——
 *    那正是 2026-09-20 三天没人知道的那条路径。
 */
export function classifyOpenAIFailure(input: ProviderFailureInput): ProviderFailureKind {
  const { code, type } = parseProviderError(input.body)

  // 1. 账户级错误码优先 —— 不管 HTTP 状态是 429 还是 403，认码不认码外
  if (ACCOUNT_LEVEL_CODES.has(code) || ACCOUNT_LEVEL_CODES.has(type)) return 'account_exhausted'

  // 2. 401/403：必须区分「网关不让过」和「OpenAI 说钥匙不对」
  if (input.status === 401 || input.status === 403) {
    // 🔴 顺序是刻意的，而且**反过来写会翻车**（子牙 2026-09-23 实施后复审抓到）：
    //    `looksLikeGateway` 的命中条件之一是响应头里有 `cf-ray`，而**经网关代理
    //    回来的任何响应都带这个头** —— 包括 OpenAI 自己回的 invalid_api_key。
    //    仓库里 40+ 个 chat.completions 调用点默认全走网关，所以先判网关的话，
    //    真出现钥匙被撤销时 PM 会拿到「不是 OpenAI 的问题，去换网关令牌」。
    //
    //    读得出 OpenAI 自己的错误码 = 这次请求**确实到达了 OpenAI**，
    //    跟上面第 1 步「认码不认码外」是同一条原则。
    if (CREDENTIAL_CODES.has(code) || CREDENTIAL_CODES.has(type)) return 'credential_invalid'
    if (looksLikeGateway(input)) return 'gateway_auth_failed'
    // 读不出明确的 OpenAI 错误码就不猜 —— 宁可不报，也不制造一条让人白跑的告警
    return 'other'
  }

  // 3. 到这里的 429 才是真的「这一次太快了」—— SDK 自己会重试，不惊动人
  if (input.status === 429) return 'rate_limited'

  return 'other'
}

/** 哪几类值得惊动人：重试一万次也不会好的那几种。 */
export function needsHuman(kind: ProviderFailureKind): boolean {
  return kind === 'account_exhausted' || kind === 'credential_invalid' || kind === 'gateway_auth_failed'
}

/**
 * 同一套判据，喂进来的是 **SDK 抛出来的异常**而不是原始响应。
 *
 * WHY 需要这一层
 * -------------
 * `instrumentedFetch` 拦的是响应，负责「记一笔、让人知道」；但**调用方自己**也常常
 * 需要当场改变行为 —— 最典型的是分批跑的循环：账户没钱时，对剩下每一条重试一遍，
 * 等于把 SDK 的 429 退避（一条烧 20.1 秒，2026-09-23 生产实测）乘以条数，
 * 把「充钱就好」放大成「这一段永远不返回、运行记录卡在 running」。
 * 那一层拿不到这个决定权，因为它按约定**绝不向调用方抛**、也不改变控制流。
 *
 * 🔴 判据**不在这里重写**，原样委托给 `classifyOpenAIFailure` —— 第三份错误码清单
 *    一定会跟前两份漂移，而漂移的方向永远是「把限流误判成没钱」。
 *    这里只做一件事：把 SDK 的 `APIError` 还原成它当初收到的那个响应形状。
 */
export function classifyThrownOpenAIError(err: unknown): ProviderFailureKind {
  if (!err || typeof err !== 'object') return 'other'
  const e = err as {
    status?: unknown
    error?: unknown
    code?: unknown
    type?: unknown
    headers?: unknown
  }
  const status = typeof e.status === 'number' ? e.status : 0
  if (status === 0) return 'other'

  // SDK 把响应体里的 `error` 对象原样挂在 `err.error` 上；拿不到就用平铺的
  // code/type 拼一个等价的回去，让下游那份白名单照常认。
  const body = JSON.stringify({
    error:
      e.error && typeof e.error === 'object'
        ? e.error
        : { code: typeof e.code === 'string' ? e.code : '', type: typeof e.type === 'string' ? e.type : '' },
  })

  const headers: Record<string, string> = {}
  if (e.headers && typeof e.headers === 'object') {
    const h = e.headers as { forEach?: (cb: (v: string, k: string) => void) => void }
    if (typeof h.forEach === 'function') {
      h.forEach((v, k) => {
        headers[k] = v
      })
    } else {
      for (const [k, v] of Object.entries(e.headers as Record<string, unknown>)) {
        if (typeof v === 'string') headers[k] = v
      }
    }
  }

  return classifyOpenAIFailure({ status, body, headers })
}
