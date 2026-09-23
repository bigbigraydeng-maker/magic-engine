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
 * 判定结果。只有 `account_exhausted` / `credential_invalid` / `project_permission_denied` /
 * `gateway_auth_failed` 需要惊动人 —— 它们的共同点是**重试一万次也不会好**。
 */
export type ProviderFailureKind =
  /** 账户没钱 / 撞了账单硬顶 / 账户被停 —— 只有人去充值或恢复账户才行 */
  | 'account_exhausted'
  /** 钥匙本身不认了（被撤销 / 打错 / 过期）—— 要人去换钥匙 */
  | 'credential_invalid'
  /**
   * 钥匙本身没问题，但项目 / 账号层面的权限配置挡住了这次调用 ——
   * 常见于 API 没启用、这把 key 没被授权用这个模型、或项目计费没开。
   *
   * 🔴 必须跟 `credential_invalid` 分开（Codex review 2026-09-23 抓到）：两者都可能报
   *    401/403，但**换一把新钥匙修不好这一类** —— 新钥匙挂在同一个项目下，权限配置
   *    原封不动。混成一条，PM 会被支去重新生成 key，改完还是那个错，
   *    正是 CLAUDE.md 铁律 3 说的「下发了但没法照做」。
   */
  | 'project_permission_denied'
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
  return (
    kind === 'account_exhausted' ||
    kind === 'credential_invalid' ||
    kind === 'project_permission_denied' ||
    kind === 'gateway_auth_failed'
  )
}

// ─── Shared helpers for SDK error objects ────────────────────────────────────

/**
 * SDK 异常对象里取 HTTP 状态码。
 *
 * Google AI SDK 的 `GoogleGenerativeAIFetchError` 和 OpenAI SDK 的 `APIError`
 * 都把 HTTP status 挂在 `.status` 上，但 TypeScript 的 `Error` 类型里没有这个字段。
 * 用 `in` 运算符窄化：运行时判 `.status` 存在且为 number 才取，避免强转。
 */
function extractHttpStatus(err: object): number | null {
  if ('status' in err && typeof err.status === 'number') return err.status
  return null
}

/**
 * OpenAI SDK 的 `APIError` 把解析后的响应体挂在 `.error`。Perplexity 用同一个 SDK。
 */
function extractErrorPayload(err: object): Record<string, unknown> | null {
  if ('error' in err && err.error !== null && typeof err.error === 'object') {
    return err.error as Record<string, unknown>
  }
  return null
}

/**
 * `GoogleGenerativeAIFetchError` 把 Google 返回的 `error.details` 数组原样挂在 `.errorDetails`。
 * 配额耗尽时这里面通常有一个 `google.rpc.QuotaFailure` detail —— 这是比正则猜 message 文本
 * 更可靠的信号（详见 `looksLikeQuotaExhausted` 的注释）。
 */
function extractGeminiErrorDetails(err: object): unknown[] | null {
  if ('errorDetails' in err && Array.isArray((err as { errorDetails?: unknown }).errorDetails)) {
    return (err as { errorDetails: unknown[] }).errorDetails
  }
  return null
}

// ─── Gemini (Google AI) failure classifier ───────────────────────────────────

/**
 * 判 Gemini SDK 抛出的异常属于哪一类。
 *
 * Google AI SDK (`@google/generative-ai`) 的错误体跟 OpenAI 完全不同：
 *   · `GoogleGenerativeAIFetchError` 带 `.status`（HTTP 状态码）和 `.errorDetails`
 *     （Google 响应体里 `error.details` 数组的原样透传）
 *   · 错误信息里嵌 gRPC 状态名（`PERMISSION_DENIED` / `UNAUTHENTICATED` …）——
 *     **除了 `RESOURCE_EXHAUSTED`**。SDK 构造异常时只把 `error.message` 和
 *     `JSON.stringify(error.details)` 拼进 `.message`，`error.status` 这个字段
 *     （gRPC 状态名的来源）**从未被读取**，所以配额耗尽时字面的
 *     "RESOURCE_EXHAUSTED" 几乎不会出现在 `.message` 里（Codex review 2026-09-23 抓到）。
 *   · 没有独立的结构化 `{error:{code,type}}` 字段
 *
 * 所以这里从 message 文本 + HTTP status + `.errorDetails` 三路判断，跟
 * `classifyOpenAIFailure` 遵循同一条原则：**先认明确的错误码，再看状态码**，
 * 但「明确的错误码」对 Gemini 配额场景必须落到真实可用的字段上，不能只赌
 * message 里出现一个 SDK 根本不会写进去的字符串。
 *
 * 🔴 配额耗尽（HTTP 429）同时覆盖「配额用完」和「请求速率过快」，而且哪怕真的带了
 *    `QuotaFailure` 详情也不能直接当账户级断电处理（Codex review 2026-09-23 抓到）：
 *    Gemini 对每分钟请求数 / 每分钟 token 数（RPM / TPM）撞顶也会返回同一个
 *    `RESOURCE_EXHAUSTED` + `QuotaFailure` 形状，那是**瞬时**限流，下一分钟自己就好，
 *    跟真正需要人去升级方案 / 提额度的每日 (RPD) 或账单硬顶配额是两回事。
 *    区分点是 `QuotaFailure.violations[].quotaId`/`quotaMetric` 里的周期字样 ——
 *    带 `PerMinute`/`PerSecond` 且不带 `PerDay`/`Billing` 的，按 `rate_limited` 处理；
 *    其余（含读不出周期的兜底情形）沿用旧逻辑往 `account_exhausted` 偏 ——
 *    理由跟 outage-ledger.ts 一致：宁可多报一次，也不能让真实断电悄悄过去。
 */
export function classifyGeminiFailure(err: unknown): ProviderFailureKind {
  if (!(err instanceof Error)) return 'other'
  const msg = err.message
  // GoogleGenerativeAIFetchError 带 .status —— 用 in 窄化而不是强转
  const status = extractHttpStatus(err)

  // 1. API key 不对 —— 最明确，先判
  if (/API_KEY_INVALID|UNAUTHENTICATED/i.test(msg)) return 'credential_invalid'
  if (status === 401) return 'credential_invalid'

  // 2. 权限拒绝 —— API 没开 / key 没被授权用这个模型 / 项目计费未启用。
  //    🔴 不能归 `credential_invalid`：新钥匙挂在同一个项目下，这类错误原封不动，
  //    操作人换完钥匙还是同一个错（见 ProviderFailureKind 里 project_permission_denied 的注释）。
  if (/PERMISSION_DENIED/i.test(msg)) return 'project_permission_denied'
  if (status === 403) return 'project_permission_denied'

  // 3. 资源耗尽 —— 先看真实字段（errorDetails / message 里的配额文案），
  //    RESOURCE_EXHAUSTED 字面匹配只是兜底（几乎不会命中，见上方注释）
  const quotaKind = classifyGeminiQuotaSignal(err, msg)
  if (quotaKind) return quotaKind
  if (status === 429) return 'rate_limited'

  return 'other'
}

/**
 * 从 SDK 实际暴露的字段判断这次失败是「配额用完」还是「这一分钟打太快了」。
 *
 *   · `.errorDetails`：Google 配额响应通常带一个
 *     `type.googleapis.com/google.rpc.QuotaFailure` detail —— 这是结构化字段，
 *     比正则猜 message 可靠得多。`violations[].quotaId` / `quotaMetric` 的命名
 *     带着周期（`GenerateRequestsPerMinutePerProjectPerModel-FreeTier` 之类），
 *     这是唯一能可靠区分「瞬时限流」和「硬配额」的信号。
 *   · message 文案：SDK 会把 `error.message` 原文拼进异常，Google 配额耗尽的
 *     固定文案是 "You exceeded your current quota, please check your plan
 *     and billing details."，含 "quota" 关键字，但不带周期信息。
 *
 * 返回 `null` 表示没看到配额信号，交给调用方按状态码兜底。
 */
function classifyGeminiQuotaSignal(
  err: object,
  msg: string,
): 'account_exhausted' | 'rate_limited' | null {
  const details = extractGeminiErrorDetails(err)
  const detailsText = details && details.length > 0 ? JSON.stringify(details) : ''
  const hasQuotaSignal =
    /RESOURCE_EXHAUSTED/i.test(msg) ||
    /QuotaFailure|quotaId|quotaMetric/i.test(detailsText) ||
    /exceeded your current quota|quota exceeded|check your plan and billing/i.test(msg)
  if (!hasQuotaSignal) return null

  // 每分钟/每秒额度（RPM/TPM）打满是瞬时限流，下一分钟自己就好；
  // 每天额度（RPD）或账单相关的硬顶只有人能修（升级方案 / 提高上限）。
  // 读不出周期信息（例如只有 message 文案、没有结构化 details）时按硬配额处理，
  // 跟模块顶注一致：宁可多报，不能让真实断电悄悄过去。
  const isPerMinuteOrSecond = /PerMinute|PerSecond|\bRPM\b|\bTPM\b/i.test(detailsText)
  const isDailyOrBilling = /PerDay|Billing/i.test(detailsText)
  if (isPerMinuteOrSecond && !isDailyOrBilling) return 'rate_limited'
  return 'account_exhausted'
}

// ─── Perplexity failure classifier ───────────────────────────────────────────

/**
 * 判 Perplexity SDK 抛出的异常属于哪一类。
 *
 * Perplexity 用 OpenAI 兼容协议，runner 里用的就是 `new OpenAI({ baseURL })` ——
 * 所以 SDK 抛出来的是 `OpenAI.APIError`，带 `.status` 和 `.error`（解析后的 body）。
 *
 * 但 Perplexity 的错误码不保证跟 OpenAI 一一对应：它可能用自己的文案。
 * 保守策略：先读 `.error.code`（万一它真返回了 OpenAI 格式的码），
 * 读不出来再按 HTTP status + message 关键字回退。
 */
export function classifyPerplexityFailure(err: unknown): ProviderFailureKind {
  if (!(err instanceof Error)) return 'other'
  const msg = err.message
  const status = extractHttpStatus(err)

  // 读 .error.code（OpenAI SDK APIError 把 body 解析到这里）
  const errorObj = extractErrorPayload(err)
  if (errorObj && typeof errorObj === 'object') {
    const code = (errorObj as Record<string, unknown>).code
    if (typeof code === 'string') {
      if (ACCOUNT_LEVEL_CODES.has(code)) return 'account_exhausted'
      if (CREDENTIAL_CODES.has(code)) return 'credential_invalid'
    }
  }

  // Status 回退
  if (status === 401 || status === 403) return 'credential_invalid'
  // 🔴 402 = Payment Required，Perplexity 余额耗尽走的是这个状态码，
  //    跟 OpenAI 复用同一个 `insufficient_quota` code 的形状完全不同
  //    （Codex review 2026-09-23 抓到）。之前没有这条分支，402 直接落进
  //    `other`，而 `isRecordable('other')` 为 false —— 断电既不进
  //    `provider_outages`，也不上今日待办，等于本模块要防的
  //    2026-09-20 三天静默在 Perplexity 上重演一次。
  if (status === 402) return 'account_exhausted'
  if (status === 429) {
    if (/quota|billing/i.test(msg)) return 'account_exhausted'
    return 'rate_limited'
  }

  return 'other'
}
