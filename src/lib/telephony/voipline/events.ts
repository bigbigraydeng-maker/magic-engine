/**
 * VoIPLine webhook 事件 → 我们自己说法的「通话事件」。
 *
 * 🔴 **字段名未经真实样本核对。** VoIPLine 知识库页面只把「呼入/呼出的开始、接通、
 * 结束、录音完成」的 JSON 样例放成图片，文字里只有 `webhook_component_event` 一种
 * 的字段名（unique_call_id / user_name / user_number / dest_number / call_start_at）。
 * 所以下面每个字段都按「一串可能的名字」去读，读不到就当没有，**绝不猜**。
 * 拿到 CTS 门户里的真实样本后，只改这个文件的别名表和对应测试，其余层不用动。
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
  time: ['call_start_at', 'timestamp', 'started_at', 'date', 'time', 'call_time'],
  caller: ['user_number', 'caller_number', 'caller_id', 'from', 'cli', 'source_number'],
  callee: ['dest_number', 'destination_number', 'destination', 'to', 'called_number'],
  name: ['user_name', 'caller_name', 'cnam'],
  extension: ['user_extension', 'extension', 'ext', 'agent_extension'],
  extensionName: ['extension_name', 'agent_name', 'staff_name'],
  duration: ['duration', 'talk_time', 'talk_duration', 'billsec', 'call_duration'],
  answered: ['answered', 'is_answered'],
  recordingId: ['recording_id', 'recording_uuid'],
  recordingUrl: ['recording_url', 'recording_link', 'recording', 'url'],
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

const iso = (v: unknown): string | null => {
  const s = str(v)
  if (!s) return null
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

/** 事件名 → 阶段。顺序重要：recording 优先于 answered/ended。 */
export function classifyEventType(rawType: string): CallEventType {
  const t = rawType.toLowerCase().replace(/[^a-z0-9]+/g, '_')
  if (/recording/.test(t)) return 'recording_ready'
  if (/(queue|ring_?group|voicemail|summary|webhook_component)/.test(t)) return 'other'
  if (/(completion|complete|ended|end|hangup)/.test(t)) return 'call_ended'
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
      answered: bool(pick(o, ALIASES.answered)),
      talkSeconds: secs(pick(o, ALIASES.duration)),
      recordingId: str(pick(o, ALIASES.recordingId)),
      recordingUrl: str(pick(o, ALIASES.recordingUrl)),
    },
  }
}

/** 稳定序列化（键排序），用来给「同一份载荷重发」算同一个指纹。 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/**
 * 去重键：供应商账号 + 通话编号 + 事件类型 + 载荷指纹。
 *
 * 加载荷指纹是刻意偏离「只用前三样」的：转接时同一个通话编号会有多段
 * answered / completion，只用前三样会把第二段当重复丢掉，那一段的员工和时长就没了。
 * 字节级相同的重发指纹相同，照样被挡掉。
 */
export function buildDedupeKey(account: string, event: NormalisedCallEvent, payload: unknown): string {
  const fp = createHash('sha256').update(canonical(payload)).digest('hex').slice(0, 16)
  return `${VOIPLINE_PROVIDER}:${account}:${event.callId}:${event.rawType}:${fp}`
}
