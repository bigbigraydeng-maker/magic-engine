/**
 * Shared validation utility functions for API routes.
 *
 * Extracted to avoid duplication across blog, opportunities, and other
 * internal API endpoints.
 *
 * Security contract:
 * - requireBearerToken: constant-time comparison to prevent timing attacks
 * - validateEnvVar: throws descriptive error naming the variable, never its value
 * - clampLimit: prevents unbounded DB queries (DoS mitigation)
 *
 * Reference: Phase 7.3 security fix (CRITICAL-1, CRITICAL-2, HIGH-1)
 */

// ─── Bearer Token Auth ────────────────────────────────────────────────────────

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: string }

/**
 * Validate the Authorization header against INTERNAL_API_KEY.
 *
 * @param authHeader  The raw value of the Authorization header (may be undefined).
 * @returns           { ok: true } on success, or { ok: false, status, error } on failure.
 *
 * Returns 500 (not 401) when INTERNAL_API_KEY is not configured so that
 * a misconfigured environment is clearly distinguishable from an auth failure.
 * This prevents silent "open door" behaviour when the env var is missing.
 */
export function requireBearerToken(authHeader: string | undefined): AuthResult {
  const configuredKey = process.env.INTERNAL_API_KEY

  if (!configuredKey) {
    return {
      ok: false,
      status: 500,
      error: 'Server configuration error: authentication not available',
    }
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const providedToken = authHeader.slice('Bearer '.length)

  if (!providedToken) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  // Constant-time comparison to prevent timing attacks.
  // timingSafeEqual requires equal-length buffers.
  if (!timingSafeEqual(providedToken, configuredKey)) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  return { ok: true }
}

/**
 * Constant-time string comparison that does not short-circuit on length
 * mismatch (prevents timing oracle on token length).
 */
function timingSafeEqual(a: string, b: string): boolean {
  // Pad the shorter string to equal length so we always do the same work.
  const maxLen = Math.max(a.length, b.length)
  let result = a.length === b.length ? 0 : 1

  for (let i = 0; i < maxLen; i++) {
    const ca = a.charCodeAt(i) || 0
    const cb = b.charCodeAt(i) || 0
    result |= ca ^ cb
  }

  return result === 0
}

// ─── Environment Variable Validation ─────────────────────────────────────────

/**
 * Retrieve a required environment variable, throwing a descriptive error if
 * it is absent or empty. The error message names the variable but never
 * exposes its value.
 *
 * @param name  Environment variable name (e.g. 'SEMRUSH_API_KEY')
 * @returns     The non-empty string value.
 * @throws      Error with message containing the variable name.
 */
export function validateEnvVar(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      'Please configure this variable before starting the server.'
    )
  }

  return value
}

// ─── Query Parameter Clamping ─────────────────────────────────────────────────

export interface ClampLimitOptions {
  /** Value to use when input is absent, zero, or negative. Default: 20. */
  defaultValue?: number
  /** Maximum allowed value. Default: 100. */
  max?: number
}

/**
 * Parse and clamp the ?limit= query parameter to a safe range.
 *
 * Rules:
 * - Missing / empty / NaN / negative / zero → defaultValue (20)
 * - Exceeds max → max (100)
 * - Decimal strings are floored (parseInt behaviour)
 *
 * @param raw     The raw string value from URLSearchParams (may be null/undefined).
 * @param options Override default (20) or max (100).
 * @returns       A positive integer in [1, max].
 */
export function clampLimit(
  raw: string | null | undefined,
  options: ClampLimitOptions = {}
): number {
  const defaultValue = options.defaultValue ?? 20
  const max = options.max ?? 100

  if (raw === null || raw === undefined || raw.trim() === '') {
    return defaultValue
  }

  const parsed = parseInt(raw, 10)

  if (isNaN(parsed) || parsed <= 0) {
    return defaultValue
  }

  return Math.min(parsed, max)
}

// ─── UUID ─────────────────────────────────────────────────────────────────────

/**
 * 一个字符串**长得像不像** Postgres 的 `uuid`。
 *
 * 🔴 为什么必须在读库**之前**判：`.eq('id', v)` 打在 uuid 列上时，Postgres 对
 *    畸形值抛的是 `22P02 invalid input syntax for type uuid`。那是一条**数据库
 *    错误**，一路冒到接口就成了 `500 internal_error` —— 于是「链接被截断了 / 有人
 *    手打错了」这种纯粹的客户端问题，会被记成服务端故障，污染 5xx 监控，
 *    而真正的服务端故障就此淹没在噪音里。
 *
 * 🔴 判据只管**语法**，不管这条记录存不存在、更不管调用方有没有权限看它。
 *    语法过了照样要走鉴权 —— 这个函数不是一道权限闸，别当它是。
 *
 * 🔴 这里刻意不校验 version / variant 位（不写成 `[1-8]` / `[89ab]`）：
 *    Postgres 的 `uuid` 类型收任何 128 位值，全零 UUID 也合法。判得比数据库还严，
 *    会把库里真实存在的行判成「非法输入」。判据要跟**数据库的口径**一致。
 *
 * 用法：任何**来自 HTTP**（路径段 / 查询串 / 请求体）并且最终会进 uuid 列或
 * uuid RPC 参数的值，都要先过这一道。库里读出来的值不用（它们本来就是 uuid）。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}
