/**
 * Twilio 回调的接收逻辑（路由只是壳）。顺序固定：认连接 → 验签名 → 核账号 → 解析 → **先落库** → 发处理事件 → 回 TwiML/空。
 * 任何一步不确定都拒绝（来电则回「挂断」TwiML，不转接不录音），并留回执。
 */

import { buildDedupeKey } from '../voipline/events'
import { MAX_BODY_BYTES } from '../voipline/ingest'
import type { TelephonyConnection, TelephonyStore } from '../voipline/types'
import { parseTwilioEvent, TWILIO_PROVIDER, type TwilioKind } from './events'
import { verifyTwilioSignature } from './signature'
import { E164, noticeTwiml, OUTBOUND_CP_PARAM } from './outbound'
import { EMPTY_TWIML, HANGUP_TWIML, inboundForwardTwiml } from './twiml'

/** 令牌环境变量名只许这个前缀：库里一行写错也不能让服务把别的密钥当签名令牌。 */
export const SECRET_REF_PATTERN = /^TWILIO_AUTH_TOKEN_[A-Z0-9_]{1,40}$/

/** 最近一次成功读到的连接（进程内）。数据库短暂不可用时，来电仍能验签并转接，不让客人的电话被挂断。 */
const connCache = new Map<string, { conn: TelephonyConnection; at: number }>()
const CONN_CACHE_MS = 6 * 3600_000
export function _clearConnCache() { connCache.clear() }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const TWILIO_KINDS: readonly TwilioKind[] = ['voice', 'status', 'dial', 'recording']
/** 接收口认的地址类别：四类回调 + 外呼时客户接起放的告知（不落库、只回 TwiML）。 */
const ROUTE_KINDS: readonly string[] = [...TWILIO_KINDS, 'notice']

export interface TwilioIngestInput {
  connectionId: string
  kind: string
  /** Twilio 签名用的完整公网地址（含 https 与查询串）。 */
  url: string
  /** 本服务公网根地址，用来拼 TwiML 里的回调地址。 */
  baseUrl: string
  signature: string | null
  bodyText: string
  /** 读环境变量（注入以便测试）。 */
  env: (name: string) => string | undefined
  now?: () => Date
  emit: (rawEventId: string, clientId: string, connectionId: string) => Promise<void>
}

export interface TwilioIngestResult {
  status: 200 | 400 | 401 | 413 | 503
  /** 'twiml' 回 XML，'empty' 回 200 空 TwiML。 */
  twiml: string
}

/** 解析表单体；出现同名参数返回 null（Twilio 对重复键的签名算法与「取最后一个」不同，宁可拒绝也不放行歧义）。 */
export function parseForm(bodyText: string): Record<string, string> | null {
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(bodyText)) {
    if (Object.prototype.hasOwnProperty.call(out, k)) return null
    out[k] = v
  }
  return out
}

/** 规范化指纹输入：键排序后的「键=值」。重放时换顺序/换编码得到同一个指纹。 */
export function canonicalForm(params: Record<string, string>): string {
  return Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
}

export async function handleTwilioWebhook(store: TelephonyStore, input: TwilioIngestInput): Promise<TwilioIngestResult> {
  const receivedAt = (input.now ?? (() => new Date()))().toISOString()
  const deny = async (status: 400 | 401 | 413, reason: string, ids: { connectionId: string | null; clientId: string | null }) => {
    await store.insertRejection({ ...ids, reason, receivedAt }).catch(() => undefined)
    return { status, twiml: HANGUP_TWIML }
  }

  if (!UUID.test(input.connectionId) || !ROUTE_KINDS.includes(input.kind)) {
    return deny(401, 'bad_connection_id_format', { connectionId: null, clientId: null })
  }
  const kind = input.kind as TwilioKind | 'notice'
  let conn: TelephonyConnection | null
  let fromCache = false
  try {
    conn = await store.getConnection(input.connectionId)
    if (conn) connCache.set(input.connectionId, { conn, at: Date.now() })
  } catch {
    const hit = connCache.get(input.connectionId)
    // 只有来电（voice）才用缓存兜底：其余回调丢了有补处理，来电丢了客人就打不进来。
    if (kind !== 'voice' || !hit || Date.now() - hit.at > CONN_CACHE_MS) return { status: 503, twiml: HANGUP_TWIML }
    conn = hit.conn
    fromCache = true
  }
  if (!conn || !conn.active || conn.provider !== TWILIO_PROVIDER) {
    return deny(401, conn ? 'connection_inactive_or_wrong_provider' : 'unknown_connection', {
      connectionId: conn ? conn.id : null,
      clientId: conn?.clientId ?? null,
    })
  }
  if (Buffer.byteLength(input.bodyText, 'utf8') > MAX_BODY_BYTES) {
    return deny(413, 'body_too_large', { connectionId: conn.id, clientId: conn.clientId })
  }
  const params = parseForm(input.bodyText)
  if (!params) return deny(400, 'duplicate_param', { connectionId: conn.id, clientId: conn.clientId })
  const token = conn.secretRef && SECRET_REF_PATTERN.test(conn.secretRef) ? input.env(conn.secretRef) : undefined
  if (!verifyTwilioSignature(token, input.url, params, input.signature)) {
    return deny(401, token ? 'bad_signature' : 'secret_not_configured', { connectionId: conn.id, clientId: conn.clientId })
  }
  // 账号核对：签名对了、但账号不是这条连接登记的那个 → 拒绝（防把别人的回调指进来）。
  if (params.AccountSid !== conn.providerAccountId) {
    return deny(401, 'account_mismatch', { connectionId: conn.id, clientId: conn.clientId })
  }

  // 外呼时客户接起的告知：验过签名和账号后只回一段 TwiML，不落库。
  if (kind === 'notice') return { status: 200, twiml: noticeTwiml() }

  const cp = (() => {
    try {
      const v = new URL(input.url).searchParams.get(OUTBOUND_CP_PARAM)
      return v && E164.test(v) ? v : null
    } catch {
      return null
    }
  })()
  const parsed = parseTwilioEvent(kind, params, { forwardTo: conn.forwardTo, outboundCounterparty: cp })
  if (!parsed.ok) {
    if (parsed.reason === 'child_leg') return { status: 200, twiml: EMPTY_TWIML }
    await store
      .insertRejection({ connectionId: conn.id, clientId: conn.clientId, reason: `unparseable:${parsed.reason}`, receivedAt, payload: params })
      .catch(() => undefined)
    return { status: 200, twiml: kind === 'voice' ? HANGUP_TWIML : EMPTY_TWIML }
  }

  let inserted: { inserted: boolean; id: string | null }
  try {
    inserted = await store.insertRawEvent({
      provider: TWILIO_PROVIDER,
      clientId: conn.clientId,
      connectionId: conn.id,
      callId: parsed.event.callId,
      dedupeKey: buildDedupeKey(conn.providerAccountId, parsed.event, canonicalForm(params), TWILIO_PROVIDER),
      receivedAt,
      rawType: parsed.event.rawType,
      event: parsed.event,
      payload: params,
    })
  } catch {
    // 来电：落库失败也要先把电话接通转接（签名已验过）；这一条「来电开始」事件丢了，后面的状态/员工结果回调还会进来。
    if (kind === 'voice' && conn.forwardTo) return { status: 200, twiml: forwardFor(input.baseUrl, conn, params.To) }
    return { status: 503, twiml: HANGUP_TWIML }
  }
  void fromCache
  if (inserted.inserted && inserted.id) await input.emit(inserted.id, conn.clientId, conn.id).catch(() => undefined)

  if (kind !== 'voice') return { status: 200, twiml: EMPTY_TWIML }
  // 来电：没配好转接号码就不转接、不录音。
  if (!conn.forwardTo) return { status: 200, twiml: HANGUP_TWIML }
  return { status: 200, twiml: forwardFor(input.baseUrl, conn, params.To) }
}

function forwardFor(baseUrl: string, conn: TelephonyConnection, calledNumber?: string | null): string {
  const root = `${baseUrl}/api/webhooks/twilio/${conn.id}`
  return inboundForwardTwiml({ forwardTo: conn.forwardTo as string, dialActionUrl: `${root}/dial`, recordingCallbackUrl: `${root}/recording`, callerId: calledNumber })
}
