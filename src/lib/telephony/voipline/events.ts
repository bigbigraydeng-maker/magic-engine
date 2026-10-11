/**
 * VoIPLine webhook 事件 → 我们自己说法的「通话事件」。
 *
 * 字段名依据：VoIPLine 客户后台 Integrations → Webhooks 页面里官方给的事件样例（2026-10-12 读取，
 * 已核对：user_inbound / _answered / _completed、user_outbound_completed、recording_inbound）。
 * 关键事实：`caller_id` 是**来电号码**，`user_number` 是**员工分机号**（不是客人号码），`user_name` 是员工名；
 * `call_duration` 是**含响铃的总时长**，真正的通话时长是 `conversation_duration`；`connected_at` 为空 = 没接通。
 * 仍未读到官方样例的：`user_outbound`、`user_outbound_answered`、`outbound_call_recording`（按同族字段推断，
 * 外呼客人号码取 `dest_number`——**待真实外呼事件核对**）。读不到的字段当没有，绝不猜。
 *
 * 这个文件不碰数据库、不碰网络。
 */

import { createHash } from 'crypto'

export const VOIPLINE_PROVIDER = 'voipline' as const

/** 我们只关心的事件阶段；其余（队列摘要、语音信箱…）归 `other`，原样留档不处理。 */
export type CallEventType =
  | 'call_started'
  | 'call_answered'
  | 'call_ended'
  | 'recording_ready'
  | 'other'

export type CallDirection = 'inbound' | 'outbound'

export interface NormalisedCallEvent {
  /** 供应商那边的通话编号（unique_call_id）。 */
  callId: string
  eventType: CallEventType
  /** 供应商原始事件名（已小写化），留档用。 */
  rawType: string
  direction: CallDirection | null
  /** 事件发生时间（ISO）；读不到时是 null，由调用方用收到时间兜底。 */
  occurredAt: string | null
  /** 客人那一头的号码（原始格式，归一化在 call-plan 里做）。 */
  counterpartyNumber: string | null
  counterpartyName: string | null
  /** 我们这头的分机 / 员工名。 */
  extension: string | null
  extensionName: string | null
  /** 事件自己声明的接通状态；没说就是 null（不等于没接通）。 */
  answered: boolean | null
  talkSeconds: number | null
  /** 整通电话总时长（含响铃），只用来发现「有时长却没有接通结论」，**不是**通话时长。 */
  totalSeconds?: number | null
  /** 录音编号（不是链接）；供应商没给编号时为 null。 */
  recordingId: string | null
  /** 录音链接——只存在于原始事件行（仅服务端可读），不进通话表、不进日志。 */
  recordingUrl: string | null
}

export type ParseResult =
  | { ok: true; event: NormalisedCallEvent }
  | { ok: false; reason: 'not_an_object' | 'missing_call_id' | 'missing_event_type' }

const ALIASES = {
  callId: ['unique_call_id', 'call_id', 'uniqueid', 'unique_id'],
  type: ['type', 'event', 'event_type', 'event_name'],
  direction: ['direction', 'call_type', 'call_direction'],
  time: ['call_start_at', 'recorded_at', 'timestamp', 'started_at'],
  caller: ['caller_id', 'caller_number', 'from', 'cli', 'source_number'],
  callee: ['dest_number', 'destination_number', 'destination', 'to', 'called_number'],
  name: ['caller_name', 'cnam'],
  extension: ['user_number', 'user_extension', 'extension', 'ext'],
  extensionName: ['user_name', 'extension_name', 'agent_name'],
  // 只认「通话时长」；call_duration（含响铃）刻意不在这里。
  duration: ['conversation_duration', 'talk_time', 'talk_duration', 'billsec'],
  answered: ['answered', 'is_answered'],
  recordingId: ['recording_id', 'recording_uuid'],
  recordingUrl: ['call_recording_link', 'recording_url', 'recording_link'],
} as const

function pick(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

const secs = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

const bool = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['true', 'yes', '1', 'answered'].includes(s)) return true
    if (['false', 'no', '0', 'unanswered', 'noanswer', 'no_answer', 'missed'].includes(s)) return false
  }
  return null
}

/**
 * 事件时间 → ISO。只认带时区的字符串和 epoch 数字；**没带时区的时间不猜**（服务器时区一变就差十几个小时），
 * 返回 null，由调用方用收到时间兜底。
 */
const iso = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  const s = str(v)
  if (!s || !/(z|[+-]\d{2}:?\d{2})$/i.test(s)) return null
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

/** 事件名 → 阶段。顺序重要：recording 优先于 answered/ended。 */
export function classifyEventType(rawType: string): CallEventType {
  const t = rawType.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  if (/recording/.test(t)) return 'recording_ready'
  if (/(queue|ring_?group|voicemail|summary|webhook_component)/.test(t)) return 'other'
  // 「没人接 / 忙线 / 失败」是结束类事件，不是接通事件（必须排在 answer 判断之前）。
  if (/(no_?answer|unanswered|busy|missed|failed|cancel)/.test(t)) return 'call_ended'
  if (/(^|_)(completion|complete|completed|ended|end|hangup)(_|$)/.test(t)) return 'call_ended'
  if (/answer/.test(t)) return 'call_answered'
  if (/(inbound|outbound|call)/.test(t)) return 'call_started'
  return 'other'
}

function directionFrom(rawType: string, fieldValue: unknown): CallDirection | null {
  const hay = `${rawType} ${str(fieldValue) ?? ''}`.toLowerCase()
  if (/outbound|outgoing/.test(hay)) return 'outbound'
  if (/inbound|incoming/.test(hay)) return 'inbound'
  return null
}

export function parseVoiplineEvent(payload: unknown): ParseResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'not_an_object' }
  }
  const o = payload as Record<string, unknown>
  const callId = str(pick(o, ALIASES.callId))
  if (!callId) return { ok: false, reason: 'missing_call_id' }
  const rawType = str(pick(o, ALIASES.type))?.toLowerCase() ?? null
  if (!rawType) return { ok: false, reason: 'missing_event_type' }

  const direction = directionFrom(rawType, pick(o, ALIASES.direction))
  const noAnswerType = /(no_?answer|unanswered|busy|missed|failed|cancel)/.test(rawType.replace(/[^a-z0-9]+/g, '_'))
  // 号码方向：呼入时对方是主叫；呼出时对方是被叫。方向不明就不猜号码。
  const counterpartyNumber =
    direction === 'inbound'
      ? str(pick(o, ALIASES.caller))
      : direction === 'outbound'
        ? str(pick(o, ALIASES.callee))
        : null

  return {
    ok: true,
    event: {
      callId,
      eventType: classifyEventType(rawType),
      rawType,
      direction,
      occurredAt: iso(pick(o, ALIASES.time)),
      counterpartyNumber,
      counterpartyName: direction === 'inbound' ? str(pick(o, ALIASES.name)) : null,
      extension: str(pick(o, ALIASES.extension)),
      extensionName: str(pick(o, ALIASES.extensionName)),
      // 接通判断：事件名说没接 → false；有明确 answered 标志用标志；
      // 带 connected_at 字段的事件（answered / completed）：有值 = 接通，空 = 没接通。
      answered: noAnswerType
        ? false
        : (bool(pick(o, ALIASES.answered)) ?? ('connected_at' in o ? Boolean(o.connected_at) : null)),
      talkSeconds: secs(pick(o, ALIASES.duration)),
      recordingId: str(pick(o, ALIASES.recordingId)),
      recordingUrl: str(pick(o, ALIASES.recordingUrl)),
    },
  }
}

/**
 * 去重键：供应商账号 + 通话编号 + 事件类型 + 请求体指纹。
 *
 * 加请求体指纹是刻意偏离「只用前三样」的：转接时同一个通话编号会有多段
 * answered / completion，只用前三样会把第二段当重复丢掉，那一段的员工和时长就没了。
 * 字节级相同的重发指纹相同，照样被挡掉。指纹直接对原始请求体取哈希（不做递归序列化，
 * 深层嵌套的载荷也不会炸栈）。各段用 JSON 数组拼接，避免通话编号里带冒号造成碰撞。
 */
export function buildDedupeKey(account: string, event: NormalisedCallEvent, bodyText: string, provider: string): string {
  const fp = createHash('sha256').update(bodyText, 'utf8').digest('hex').slice(0, 16)
  return JSON.stringify([provider, account, event.callId, event.rawType, fp])
}
