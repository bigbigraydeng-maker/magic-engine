// Resend 回调入库主流程：验签 → 校验 → 清洗 → 落库。
import {
  EVENT_TYPE_MAX,
  PROVIDER_EVENT_ID_MAX,
  PROVIDER_MESSAGE_ID_MAX,
  isResendAccount,
  isStoredResendEventType,
  type ProviderEventInput,
  type ProviderEventStore,
  type ResendWebhookInput,
  type WebhookResult,
} from './types'
import { loadResendWebhookSecret, verifyResendSignature } from './resend-signature'

const SVIX_ID_RE = new RegExp(`^[A-Za-z0-9_-]{1,${PROVIDER_EVENT_ID_MAX}}$`)
const DB_CODE_RE = /^[A-Za-z0-9_]{1,16}$/
const FAILED_CODE_RE = /failed: ([A-Za-z0-9_]{1,16})$/

/** 从错误对象中提取安全的错误码（不含库错误详情）。 */
export function errorCodeOf(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && DB_CODE_RE.test(code)) return code
  }
  if (err instanceof Error) {
    const m = FAILED_CODE_RE.exec(err.message)
    if (m) return m[1]
  }
  return 'unknown'
}

/** 判断是否为普通对象（非 null、非数组）。 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 判断字符是否为高位代理。 */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/** 判断字符是否为低位代理。 */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/** 清洗字符串：删除 \u0000，替换孤立代理字符为 U+FFFD。 */
function sanitizeString(s: string): string {
  const noNull = s.replace(/\u0000/g, '')
  let out = ''
  for (let i = 0; i < noNull.length; i++) {
    const code = noNull.charCodeAt(i)
    if (isHighSurrogate(code)) {
      const next = i + 1 < noNull.length ? noNull.charCodeAt(i + 1) : -1
      if (isLowSurrogate(next)) {
        out += noNull[i] + noNull[i + 1]
        i++
      } else {
        out += '\uFFFD'
      }
    } else if (isLowSurrogate(code)) {
      // 走到这里说明前面不是高位代理（否则已被上面消费）
      out += '\uFFFD'
    } else {
      out += noNull[i]
    }
  }
  return out
}

/** 递归清洗任意值：字符串去 NUL / 修代理；数组逐项；对象重建；其它原样。 */
export function sanitizeValue(v: unknown): unknown {
  if (typeof v === 'string') return sanitizeString(v)
  if (Array.isArray(v)) return v.map((item) => sanitizeValue(item))
  if (isPlainObject(v)) {
    // 无原型对象：载荷里若有名叫 __proto__ 的键，也只是普通自有键，不会改到原型链
    const out: Record<string, unknown> = Object.create(null)
    for (const [k, val] of Object.entries(v)) {
      out[sanitizeString(k)] = sanitizeValue(val)
    }
    return out
  }
  return v
}

/** 处理一次 Resend webhook 请求。 */
export async function handleResendWebhook(
  store: ProviderEventStore,
  input: ResendWebhookInput,
): Promise<WebhookResult> {
  const account = input.account

  const log = (
    level: 'info' | 'warn' | 'error',
    code: string,
    extra?: Record<string, string>,
  ): void => {
    const payload: Record<string, string> = { evt: 'provider_webhook', code, account }
    if (extra) {
      for (const [k, v] of Object.entries(extra)) payload[k] = v
    }
    console[level](JSON.stringify(payload))
  }

  // 1. 账号白名单
  if (!isResendAccount(account)) {
    return { status: 404, body: { ok: false, error: 'not_found' } }
  }

  // 2. 读取密钥
  const secret = loadResendWebhookSecret(account, input.env)
  if (secret === null) {
    // error 级：密钥被删 / 配坏时所有真事件都会被拒，和签名不符一样要醒目
    log('error', 'secret_unavailable')
    return { status: 503, body: { ok: false, error: 'unavailable' } }
  }

  // 3. 验签
  const verify = verifyResendSignature({
    bodyText: input.bodyText,
    svixId: input.svixId,
    svixTimestamp: input.svixTimestamp,
    svixSignature: input.svixSignature,
    secret,
    nowSec: input.nowSec,
  })
  if (!verify.valid) {
    if (verify.reason === 'signature_mismatch') {
      log('error', verify.reason)
    } else {
      log('warn', verify.reason)
    }
    return { status: 401, body: { ok: false, error: 'invalid_signature' } }
  }

  // 4. svix-id 格式
  if (input.svixId === null || !SVIX_ID_RE.test(input.svixId)) {
    log('warn', 'bad_payload')
    return { status: 400, body: { ok: false, error: 'bad_payload' } }
  }
  const svixId = input.svixId

  // 5. 解析 JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(input.bodyText)
  } catch {
    log('warn', 'bad_payload')
    return { status: 400, body: { ok: false, error: 'bad_payload' } }
  }
  if (!isPlainObject(parsed) || typeof parsed.type !== 'string') {
    log('warn', 'bad_payload')
    return { status: 400, body: { ok: false, error: 'bad_payload' } }
  }
  const eventType = parsed.type

  // 6. 事件类型白名单
  if (!isStoredResendEventType(eventType)) {
    log('info', 'ignored_type', { type: eventType.slice(0, EVENT_TYPE_MAX) })
    return { status: 200, body: { ok: true, ignored: true } }
  }

  // 7. 清洗
  let sanitized: unknown
  try {
    sanitized = sanitizeValue(parsed)
  } catch {
    log('warn', 'bad_payload')
    return { status: 400, body: { ok: false, error: 'bad_payload' } }
  }
  if (!isPlainObject(sanitized)) {
    log('warn', 'bad_payload')
    return { status: 400, body: { ok: false, error: 'bad_payload' } }
  }
  const data = sanitized.data
  if (isPlainObject(data)) {
    delete data.subject
  }

  // 8. 组装入库行
  let providerMessageId: string | null = null
  if (isPlainObject(data)) {
    const emailId = data.email_id
    if (typeof emailId === 'string' && emailId.length >= 1 && emailId.length <= PROVIDER_MESSAGE_ID_MAX) {
      providerMessageId = emailId
    }
  }

  let occurredAt: string | null = null
  const createdAt = sanitized.created_at
  if (typeof createdAt === 'string') {
    const d = new Date(createdAt)
    // 只收 2000–2100 年：越界的年份（含负数年）可能让 Postgres 解析失败，变成永远重试的毒事件
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100) {
      occurredAt = d.toISOString()
    }
  }

  const row: ProviderEventInput = {
    provider: 'resend',
    account,
    providerEventId: svixId,
    eventType,
    providerMessageId,
    occurredAt,
    payload: sanitized,
  }

  // 9. 落库
  let outcome: 'inserted' | 'duplicate'
  try {
    outcome = await store.insert(row)
  } catch (err) {
    log('error', 'store_failed', { dbCode: errorCodeOf(err) })
    return { status: 500, body: { ok: false, error: 'store_failed' } }
  }

  if (outcome === 'duplicate') {
    return { status: 200, body: { ok: true, duplicate: true } }
  }
  return { status: 200, body: { ok: true } }
}
