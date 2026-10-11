/**
 * Twilio 回调的接收逻辑（路由只是壳）。顺序固定：认连接 → 验签名 → 核账号 → 解析 → **先落库** → 发处理事件 → 回 TwiML/空。
 * 任何一步不确定都拒绝（来电则回「挂断」TwiML，不转接不录音），并留回执。
 */

import { buildDedupeKey } from '../voipline/events'
import { MAX_BODY_BYTES } from '../voipline/ingest'
import type { TelephonyStore } from '../voipline/types'
import { parseTwilioEvent, TWILIO_PROVIDER, type TwilioKind } from './events'
import { verifyTwilioSignature } from './signature'
import { EMPTY_TWIML, HANGUP_TWIML, inboundForwardTwiml } from './twiml'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const TWILIO_KINDS: readonly TwilioKind[] = ['voice', 'status', 'dial', 'recording']

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

export function parseForm(bodyText: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(bodyText)) out[k] = v
  return out
}

export async function handleTwilioWebhook(store: TelephonyStore, input: TwilioIngestInput): Promise<TwilioIngestResult> {
  const receivedAt = (input.now ?? (() => new Date()))().toISOString()
  const deny = async (status: 400 | 401 | 413, reason: string, ids: { connectionId: string | null; clientId: string | null }) => {
    await store.insertRejection({ ...ids, reason, receivedAt }).catch(() => undefined)
    return { status, twiml: HANGUP_TWIML }
  }

  if (!UUID.test(input.connectionId) || !(TWILIO_KINDS as readonly string[]).includes(input.kind)) {
    return deny(401, 'bad_connection_id_format', { connectionId: null, clientId: null })
  }
  const kind = input.kind as TwilioKind
  let conn
  try {
    conn = await store.getConnection(input.connectionId)
  } catch {
    return { status: 503, twiml: HANGUP_TWIML }
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
  const token = conn.secretRef ? input.env(conn.secretRef) : undefined
  if (!verifyTwilioSignature(token, input.url, params, input.signature)) {
    return deny(401, token ? 'bad_signature' : 'secret_not_configured', { connectionId: conn.id, clientId: conn.clientId })
  }
  // 账号核对：签名对了、但账号不是这条连接登记的那个 → 拒绝（防把别人的回调指进来）。
  if (params.AccountSid !== conn.providerAccountId) {
    return deny(401, 'account_mismatch', { connectionId: conn.id, clientId: conn.clientId })
  }

  const parsed = parseTwilioEvent(kind, params, { forwardTo: conn.forwardTo })
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
      dedupeKey: buildDedupeKey(conn.providerAccountId, parsed.event, input.bodyText, TWILIO_PROVIDER),
      receivedAt,
      rawType: parsed.event.rawType,
      event: parsed.event,
      payload: params,
    })
  } catch {
    return { status: 503, twiml: HANGUP_TWIML }
  }
  if (inserted.inserted && inserted.id) await input.emit(inserted.id, conn.clientId, conn.id).catch(() => undefined)

  if (kind !== 'voice') return { status: 200, twiml: EMPTY_TWIML }
  // 来电：没配好转接号码就不转接、不录音。
  if (!conn.forwardTo) return { status: 200, twiml: HANGUP_TWIML }
  const root = `${input.baseUrl}/api/webhooks/twilio/${conn.id}`
  return {
    status: 200,
    twiml: inboundForwardTwiml({ forwardTo: conn.forwardTo, dialActionUrl: `${root}/dial`, recordingCallbackUrl: `${root}/recording` }),
  }
}
