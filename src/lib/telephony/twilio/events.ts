/**
 * Twilio 回调 → 我们自己说法的通话事件（与 VoIPLine 共用 NormalisedCallEvent，其余各层不用改）。
 *
 * 字段依据 Twilio 官方文档的 Voice 回调参数（CallSid / ParentCallSid / CallStatus / Direction / From / To /
 * AccountSid / DialCallStatus / DialCallDuration / RecordingSid / RecordingUrl / RecordingStatus），
 * **未用真实 Twilio 账号的回调核对过**，拿到试用账号的真实回调后要对一遍。
 *
 * 一通来电的几类回调：
 *   voice      号码的 Voice URL 被调用 = 来电开始（我们回 TwiML 转给员工并录音）
 *   status     号码的状态回调（父通话）；只用它兜底「没人接就挂了」
 *   dial       <Dial action>：员工那一段的结果，DialCallStatus + DialCallDuration 才是真通话时长
 *   recording  录音完成
 * 子通话（带 ParentCallSid）一律不进事件，避免同一通电话算两次。
 */

import type { NormalisedCallEvent, ParseResult } from '../voipline/events'

export const TWILIO_PROVIDER = 'twilio' as const
export type TwilioKind = 'voice' | 'status' | 'dial' | 'recording'

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}
const s = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null)

/** Twilio 的 Timestamp 是 RFC 2822（带 +0000）；不带时区的不信。 */
function ts(v: string | undefined): string | null {
  if (!v || !/(GMT|UTC|[+-]\d{4})$/i.test(v.trim())) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export interface TwilioParseOptions {
  /** 来电转给的员工号码（E.164），也就是员工分机表的键。 */
  forwardTo: string | null
  /**
   * 点击外呼：对方（客户）号码，来自我们自己生成并经 Twilio 验签的回调地址。
   * 有它才处理外呼方向；没有就像以前一样只留档（外呼那条父通话的 To 是员工手机，不是客户）。
   */
  outboundCounterparty?: string | null
}

export function parseTwilioEvent(
  kind: TwilioKind,
  p: Record<string, string>,
  opts: TwilioParseOptions,
): ParseResult | { ok: false; reason: 'child_leg' } {
  const callSid = s(p.CallSid)
  if (!callSid) return { ok: false, reason: 'missing_call_id' }
  if (s(p.ParentCallSid)) return { ok: false, reason: 'child_leg' }

  const dir = (s(p.Direction) ?? '').toLowerCase()
  const direction = dir === 'inbound' ? 'inbound' : dir.startsWith('outbound') ? 'outbound' : null
  const clickToCall = direction === 'outbound' && !!opts.outboundCounterparty
  const counterparty = direction === 'inbound' ? s(p.From) : clickToCall ? (opts.outboundCounterparty as string) : direction === 'outbound' ? s(p.To) : null

  // 外呼方向：只有点击外呼（带验签后的客户号码）才进 CRM；别处用 API 外呼并指到这里的回调只留档。
  const keepOut = direction === 'outbound' && !clickToCall

  const base: NormalisedCallEvent = {
    callId: callSid,
    eventType: 'other',
    rawType: `twilio_${kind}`,
    direction,
    occurredAt: ts(p.Timestamp),
    counterpartyNumber: counterparty,
    counterpartyName: direction === 'inbound' ? s(p.CallerName) : null,
    extension: clickToCall ? s(p.To) : opts.forwardTo,
    extensionName: null,
    answered: null,
    talkSeconds: null,
    recordingId: null,
    recordingUrl: null,
  }

  if (keepOut) return { ok: true, event: { ...base, rawType: `twilio_${kind}_outbound_ignored` } }

  if (kind === 'voice') return { ok: true, event: { ...base, eventType: 'call_started', rawType: 'twilio_voice' } }

  if (kind === 'status') {
    const st = (s(p.CallStatus) ?? '').toLowerCase()
    if (st === 'initiated' || st === 'queued' || st === 'ringing') {
      return { ok: true, event: { ...base, eventType: 'call_started', rawType: `twilio_status_${st}` } }
    }
    if (st === 'completed') {
      // 父通话 completed 只说明「线路结束了」，有没有人接、聊了多久要看 dial 那一段。
      // 所以这里 answered 不下结论（null）；CallDuration 含响铃，只作「有时长却没接通结论」的线索（totalSeconds），不当通话时长。
      return { ok: true, event: { ...base, eventType: 'call_ended', rawType: 'twilio_status_completed', answered: null, totalSeconds: num(p.CallDuration) } }
    }
    if (['busy', 'no-answer', 'failed', 'canceled'].includes(st)) {
      return { ok: true, event: { ...base, eventType: 'call_ended', rawType: `twilio_status_${st}`, answered: false } }
    }
    return { ok: true, event: { ...base, rawType: `twilio_status_${st || 'unknown'}` } }
  }

  if (kind === 'dial') {
    const st = (s(p.DialCallStatus) ?? '').toLowerCase()
    const answered = st === 'completed'
    return {
      ok: true,
      event: {
        ...base,
        eventType: 'call_ended',
        rawType: `twilio_dial_${st || 'unknown'}`,
        answered,
        talkSeconds: answered ? num(p.DialCallDuration) : 0,
      },
    }
  }

  // recording
  if ((s(p.RecordingStatus) ?? '').toLowerCase() !== 'completed') {
    return { ok: true, event: { ...base, rawType: `twilio_recording_${(s(p.RecordingStatus) ?? 'unknown').toLowerCase()}` } }
  }
  return {
    ok: true,
    event: {
      ...base,
      eventType: 'recording_ready',
      rawType: 'twilio_recording_completed',
      extension: null,
      recordingId: s(p.RecordingSid),
      // 录音链接只放原始事件行；normalised 列由存储层替换成标记
      recordingUrl: s(p.RecordingUrl),
    },
  }
}
