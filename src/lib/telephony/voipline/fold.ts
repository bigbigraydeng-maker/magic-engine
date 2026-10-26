/**
 * 把同一通电话收到的所有事件「折」成一条通话状态。
 *
 * 为什么每次都从全部原始事件重折，而不是在上一次结果上累加：
 * 事件会重复、乱序、迟到（录音常常在挂断之后几分钟才到）。重折 = 结果只取决于
 * 「收到过哪些事件」，不取决于它们到达的顺序，所以幂等，而且状态只会前进不会倒退
 * （事件集合只增不减，stage 由集合里有什么决定）。
 */

import type { CallRecord } from '../call-plan'
import type { CallDirection, NormalisedCallEvent } from './events'

export interface FoldInput {
  rawEventId: string
  receivedAt: string
  event: NormalisedCallEvent
}

export type CallStage = 'unknown' | 'started' | 'answered' | 'ended'

export interface CallLeg {
  extension: string | null
  extensionName: string | null
  answered: boolean
  talkSeconds: number
}

export interface FoldedCall {
  callId: string
  stage: CallStage
  direction: CallDirection | null
  startedAt: string
  counterpartyNumber: string | null
  counterpartyName: string | null
  answered: boolean
  /** 没有接通事件、也没有明确的 answered 标志，但有 ≥10 秒的时长：不能断言「没接」，要人确认。 */
  answeredUnknown: boolean
  talkSeconds: number
  /** 主处理员工的分机：接通且说得最久的那一段，没人接通就取第一个出现的。 */
  extension: string | null
  extensionName: string | null
  legs: CallLeg[]
  recording: { ref: string; rawEventId: string } | null
}

/** 事件自报的时间只在「收到时间前 30 天到后 5 分钟」内才采信，否则用收到时间（防乱填的未来/远古时间毒化记录）。 */
const PAST_WINDOW_MS = 30 * 24 * 3600 * 1000
const FUTURE_WINDOW_MS = 5 * 60 * 1000
function trustedTime(claimed: string | null, receivedAt: string): string {
  if (!claimed) return receivedAt
  const c = Date.parse(claimed)
  const r = Date.parse(receivedAt)
  if (Number.isNaN(c) || Number.isNaN(r)) return receivedAt
  return c < r - PAST_WINDOW_MS || c > r + FUTURE_WINDOW_MS ? receivedAt : claimed
}

const STAGE_RANK: Record<CallStage, number> = { unknown: 0, started: 1, answered: 2, ended: 3 }

export function foldCall(inputs: FoldInput[]): FoldedCall | null {
  if (inputs.length === 0) return null
  const evs = [...inputs].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.rawEventId.localeCompare(b.rawEventId))

  const st = { stage: 'unknown' as CallStage }
  const bump = (s: CallStage) => {
    if (STAGE_RANK[s] > STAGE_RANK[st.stage]) st.stage = s
  }
  let direction: CallDirection | null = null
  let counterpartyNumber: string | null = null
  let counterpartyName: string | null = null
  let sawAnswerEvent = false
  let explicitAnswered: boolean | null = null
  let sawNoAnswerFlag = false
  let totalSeconds = 0
  let talkSeconds = 0
  let earliest: string | null = null
  const legMap = new Map<string, CallLeg>()
  let recording: FoldedCall['recording'] = null

  for (const { rawEventId, receivedAt, event: e } of evs) {
    const at = trustedTime(e.occurredAt, receivedAt)
    if (earliest === null || at < earliest) earliest = at
    direction ??= e.direction
    counterpartyNumber ??= e.counterpartyNumber
    counterpartyName ??= e.counterpartyName

    if (e.eventType === 'call_started') bump('started')
    if (e.eventType === 'call_answered') {
      bump('answered')
      sawAnswerEvent = true
    }
    if (e.eventType === 'call_ended') {
      bump('ended')
      if (e.answered !== null) {
        explicitAnswered = (explicitAnswered ?? false) || e.answered
        if (!e.answered) sawNoAnswerFlag = true
      }
    }
    if (e.talkSeconds !== null) talkSeconds = Math.max(talkSeconds, e.talkSeconds)
    if (e.totalSeconds != null) totalSeconds = Math.max(totalSeconds, e.totalSeconds)

    if (e.eventType !== 'recording_ready' && (e.extension || e.extensionName)) {
      const key = e.extension ?? e.extensionName ?? ''
      const leg = legMap.get(key) ?? { extension: e.extension, extensionName: e.extensionName, answered: false, talkSeconds: 0 }
      if (e.eventType === 'call_answered' || e.answered === true) leg.answered = true
      if (e.talkSeconds !== null) leg.talkSeconds = Math.max(leg.talkSeconds, e.talkSeconds)
      legMap.set(key, leg)
    }

    if (e.eventType === 'recording_ready' && (e.recordingId || e.recordingUrl)) {
      // 迟到 / 重发的录音：后到的覆盖前面的（同一通通常只有一条录音）。
      recording = { // 官方录音事件没有录音编号：用通话编号当稳定引用（一通电话一条录音），不依赖事件到达顺序。
      ref: e.recordingId ?? `call:${e.callId}`, rawEventId }
    }
  }

  // 只认明确的接通事件 / 明确的 answered=true。不用「时长>0」推断：供应商的 duration 可能含响铃时间，
  // 推断会把没接的电话记成有效联系。
  const answered = sawAnswerEvent || explicitAnswered === true
  if (answered) bump('answered')

  const legs = [...legMap.values()]
  const primary =
    [...legs].filter((l) => l.answered).sort((a, b) => b.talkSeconds - a.talkSeconds)[0] ?? legs[0] ?? null

  return {
    callId: evs[0].event.callId,
    stage: st.stage,
    direction,
    startedAt: earliest ?? evs[0].receivedAt,
    counterpartyNumber,
    counterpartyName,
    answered,
    answeredUnknown: !answered && explicitAnswered === null && !sawNoAnswerFlag && Math.max(talkSeconds, totalSeconds) >= 10,
    talkSeconds,
    extension: primary?.extension ?? null,
    extensionName: primary?.extensionName ?? null,
    legs,
    recording,
  }
}

/** 折好的通话 → call-plan 认的记录。方向不明的不给（不猜）。 */
export function toCallRecord(f: FoldedCall): CallRecord | null {
  if (!f.direction) return null
  return {
    id: f.callId,
    startedAt: f.startedAt,
    direction: f.direction,
    counterpartyNumber: f.counterpartyNumber,
    counterpartyName: f.counterpartyName,
    extension: f.extension,
    extensionName: f.extensionName,
    answered: f.answered,
    talkSeconds: f.talkSeconds,
    recordingRef: f.recording?.ref ?? null,
  }
}
