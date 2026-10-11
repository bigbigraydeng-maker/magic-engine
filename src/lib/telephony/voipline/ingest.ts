/**
 * webhook 接收的全部逻辑（路由只是壳，方便脱网测试）。
 *
 * 顺序固定：认连接 → 验令牌 → 解析 → **先把原始事件耐久落库** → 才发处理事件。
 * 任何一步不确定都拒绝并留回执（fail-closed），不处理、不猜客户。
 *
 * 回 200 = 「原始事件已经安全落库」。落库失败回 503，让 PBX 有机会重发。
 * 发处理事件失败不影响 200：事件行已在库里，补处理任务（sweep）会捞起来。
 */

import { buildDedupeKey, parseVoiplineEvent } from './events'
import { verifyWebhookToken } from './auth'
import type { TelephonyStore } from './types'

export const MAX_BODY_BYTES = 256 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface IngestInput {
  connectionId: string
  tokenHeader: string | null
  bodyText: string
  now?: () => Date
  /** 发「原始事件已收到」业务事件；失败只吞掉（有补处理兜底）。 */
  emit: (rawEventId: string, clientId: string, connectionId: string) => Promise<void>
}

export interface IngestResult {
  status: 200 | 400 | 401 | 413 | 503
  body: { status: string; receipt?: string | null }
}

export async function handleVoiplineWebhook(store: TelephonyStore, input: IngestInput): Promise<IngestResult> {
  const receivedAt = (input.now ?? (() => new Date()))().toISOString()
  const reject = async (
    status: 400 | 401 | 413,
    reason: string,
    ids: { connectionId: string | null; clientId: string | null },
  ): Promise<IngestResult> => {
    // 回执写失败也不能让拒绝变成放行。
    await store.insertRejection({ ...ids, reason, receivedAt }).catch(() => undefined)
    return { status, body: { status: 'rejected' } }
  }

  // 令牌错和连接不存在对外是同一个答案，不给探测者区分的线索。
  if (!UUID.test(input.connectionId)) {
    return reject(401, 'bad_connection_id_format', { connectionId: null, clientId: null })
  }
  let conn
  try {
    conn = await store.getConnection(input.connectionId)
  } catch {
    return { status: 503, body: { status: 'unavailable' } }
  }
  if (!conn || !conn.active || conn.provider !== 'voipline') {
    // 连接不存在时不用请求里自带的编号当回执键（攻击者随便编，节流就失效）；只有真实存在的连接才记编号。
    return reject(401, conn ? 'connection_inactive' : 'unknown_connection', {
      connectionId: conn ? conn.id : null,
      clientId: conn?.clientId ?? null,
    })
  }
  if (!verifyWebhookToken(input.tokenHeader, conn.webhookTokenHash)) {
    return reject(401, 'bad_token', { connectionId: conn.id, clientId: conn.clientId })
  }
  if (Buffer.byteLength(input.bodyText, 'utf8') > MAX_BODY_BYTES) {
    return reject(413, 'body_too_large', { connectionId: conn.id, clientId: conn.clientId })
  }

  let payload: unknown
  try {
    payload = JSON.parse(input.bodyText)
  } catch {
    return reject(400, 'invalid_json', { connectionId: conn.id, clientId: conn.clientId })
  }
  const parsed = parseVoiplineEvent(payload)
  if (!parsed.ok) {
    // 令牌通过、但读不懂：把载荷留下（只有服务端可读），好用真实样本校准字段别名；回 200 避免 PBX 反复重发。
    await store
      .insertRejection({ connectionId: conn.id, clientId: conn.clientId, reason: `unparseable:${parsed.reason}`, receivedAt, payload })
      .catch(() => undefined)
    return { status: 200, body: { status: 'unparsed' } }
  }

  let inserted: { inserted: boolean; id: string | null }
  try {
    inserted = await store.insertRawEvent({
      provider: 'voipline',
      clientId: conn.clientId,
      connectionId: conn.id,
      callId: parsed.event.callId,
      dedupeKey: buildDedupeKey(conn.providerAccountId, parsed.event, input.bodyText, 'voipline'),
      receivedAt,
      rawType: parsed.event.rawType,
      event: parsed.event,
      payload,
    })
  } catch {
    return { status: 503, body: { status: 'storage_failed' } }
  }
  if (!inserted.inserted || !inserted.id) return { status: 200, body: { status: 'duplicate' } }

  await input.emit(inserted.id, conn.clientId, conn.id).catch(() => undefined)
  return { status: 200, body: { status: 'accepted', receipt: inserted.id } }
}

/**
 * 带上限地读请求体：超过上限立刻放弃（不把整个体读进内存）。
 * 返回 null 表示超限。分块传输（没有 content-length）也靠累计字节数拦住。
 */
export async function readCappedBody(req: { headers: { get(k: string): string | null }; body: ReadableStream<Uint8Array> | null }): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
