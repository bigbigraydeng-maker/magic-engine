/**
 * 「客人自己回来找我们」= 自动解除「别再联系」。
 *
 * `dnc.ts` 里那条闸原来只有**人**能解（`dnc_cleared` 触点）。PM 2026-11-08 定：客人说过
 * 别联系之后，又**自己**填表、打进来、回邮件、发私信，就该解除。
 *
 * 但「自动放出来」是这条闸上最贵的错，所以第一版分两档（2026-11-08 子牙 / 魏征复审后）：
 *
 *   · **自动解除**：只认 **Facebook 表单**和**接通的来电**（`AUTO_KINDS`）—— 明确的动作，不用读字面意思。
 *     官网表单**不算**自动（2026-11-08 安全复审）：`POST /api/clients/[id]/leads` 不要登录，
 *     任何人填上一位拒联客人的电话/邮箱就能造一条「他回来了」。它只进 `needs_review`。
 *     Facebook 表单是客人用自己的账号在 Meta 那边提交、由 Meta 推过来的，冒充成本高得多。
 *   · **交给人看一眼**（`needs_review`）：私信、真人回信。它们字面上可能是回头，也可能是
 *     「Why are you still messaging me」这种词表认不出的骂人话；邮件同步进来的还只是正文前一段。
 *     判错的代价是把一个明确拒绝的人放出来，所以只列出来，不写。
 *
 * 什么**都不算**：
 *
 *   · Mailchimp 的打开/点击、自动回复、机器发的那一笔
 *   · 判决后 30 分钟内的同一段对话（客人说完「别联系」紧接着的「好的」）
 *   · 本身就是拒联的话（`isStop`）
 *   · 漏接 / 不到 15 秒的来电（骚扰拨号、按错）
 *
 * 永不自动解除：
 *
 *   · 原因是「不是真实客人」（钓鱼、假冒、测试号……）—— 那种「回来」本身就是攻击的一部分
 *   · 最后一次判决是**表单里勾的退订**（合同 5426843158，见 `meta-lead.ts`）：同一个人再填表
 *     也照样要拦，那条合同写在前面，这里不推翻它
 *
 * 只有私信里那句拒联原话、没有拒联触点时（`stop_message`），判决时间来自那句原话。
 *
 * ⚠️ 正则都只有 `i` 标志：带 `g` 的 `.test()` 会记住 `lastIndex`，第二次调用时对时错。
 */

import { isDoNotContact, type DncTouch } from './dnc'
import { classifyNote } from './note-parser'
import { isAutoReply } from '@/lib/microsoft/auto-reply'

/** 判决前后 30 分钟内的消息算同一段对话。 */
export const SAME_CONVERSATION_MS = 30 * 60_000

/** 来电至少通话这么久才算客人真的打回来了。 */
export const MIN_INBOUND_CALL_SECONDS = 15

/** 原因是「不是真实客人」时永不自动解除。 */
export const NOT_A_CUSTOMER = /钓鱼|假冒|不是真实客户|非真实客户|spam|scam|phishing|测试号|test account|同行/i

/**
 * `classifyNote` 认不出「STOP」「unsubscribe」「please stop contacting me」这类英文说法
 * （它是给销售备注用的词表，故意保守）。在这里放宽：误判的方向只是「这一条不算回来」，
 * 客人照旧被挡着 —— 跟 `classifyNote` 要避免的风险方向正好相反。
 */
export const REENGAGE_EXTRA_STOP =
  /\b(stop|unsubscribe|opt[- ]?out|remove me|take me off|leave me alone|not interested|no thanks?)\b|(do not|don'?t|never) (contact|email|e-mail|call|message|text|ring) (me|us)|stop (contacting|emailing|calling|messaging|texting)|退订|不要再|别再|不需要|不感兴趣/i

export type ReengageKind = 'form' | 'web_form' | 'inbound_call' | 'email' | 'message'

/** 时间在「现在」之后超过这么多的记录不信（客户端可填的时间会被填成未来，好永远压过后来的拒联）。 */
export const FUTURE_TOLERANCE_MS = 5 * 60_000

/** 这两种才自动解除；其余只列出来请人看。 */
export const AUTO_KINDS: ReadonlySet<ReengageKind> = new Set(['form', 'inbound_call'])

export interface ReengageTouch {
  id: string
  source: string | null
  channel: string
  direction: 'inbound' | 'outbound'
  occurredAt: string
  outcome?: string | null
  flagged?: boolean
  subject?: string | null
  body?: string | null
  automated?: boolean
  /** 来电专用：`metadata.talk_seconds` */
  talkSeconds?: number | null
}

/** inbound only */
export interface ReengageMessage {
  id: string
  channel: 'messenger' | 'whatsapp'
  sentAt: string
  body: string | null
}

export interface ReengageInput {
  /** 判定时刻（ISO）。比它晚 `FUTURE_TOLERANCE_MS` 以上的记录一律不算。 */
  asOf: string
  contactFlag: boolean
  reason: string | null
  touches: ReengageTouch[]
  inboundMessages: ReengageMessage[]
}

export interface ReengageTrigger { kind: ReengageKind; ref: string; at: string; channel: string }

export type ReengageKeepWhy = 'not_dnc' | 'not_a_customer' | 'form_opt_out' | 'no_verdict_time' | 'no_reengage'

export type ReengageDecision =
  | { clear: false; why: ReengageKeepWhy }
  | { clear: false; why: 'needs_review'; dncAt: string; trigger: ReengageTrigger }
  | { clear: true; dncAt: string; dncAtSource: 'touch' | 'stop_message'; trigger: ReengageTrigger }

const FORM_KINDS = new Set(['meta_lead_form', 'web_form'])
const META_FORM = 'meta_lead_form'

function ts(v: string): number {
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

function toDncTouch(t: ReengageTouch): DncTouch {
  return { outcome: t.outcome ?? null, flagged: t.flagged === true, occurredAt: t.occurredAt }
}

function isStop(body: string | null | undefined): boolean {
  if (!body) return false
  return REENGAGE_EXTRA_STOP.test(body) || classifyNote(body).do_not_contact
}

function isVerdictTouch(t: ReengageTouch): boolean {
  return t.outcome === 'do_not_contact' || t.flagged === true
}

function latestBy<T>(items: T[], at: (item: T) => string): T | null {
  if (items.length === 0) return null
  return items.reduce((a, b) => (ts(at(b)) > ts(at(a)) ? b : a))
}

/** 最后一次拒联判决是不是表单里勾的退订。 */
function latestVerdictIsFormOptOut(touches: ReengageTouch[]): boolean {
  const latest = latestBy(touches.filter(isVerdictTouch), (t) => t.occurredAt)
  return latest !== null && latest.direction === 'inbound' && FORM_KINDS.has(latest.channel)
}

/**
 * 最后一次「别再联系」是什么时候 —— 拒联触点和客人自己说的拒联原话，**取更晚的那个**。
 *
 * 只看触点会漏：2026-11-08 实测有人被员工标了「别打电话」之后，几小时内先说
 * 「我回国再打给你」、又发了一句「Unsubscribe」。只按触点算，前一句会被当成回来了。
 */
function findDncAt(input: ReengageInput): { at: string; source: 'touch' | 'stop_message' } | null {
  const verdict = latestBy(input.touches.filter(isVerdictTouch), (t) => t.occurredAt)
  const stopTimes = [
    ...input.inboundMessages.filter((m) => isStop(m.body)).map((m) => m.sentAt),
    ...input.touches
      .filter((t) => t.direction === 'inbound' && t.channel === 'email' && isStop(t.body))
      .map((t) => t.occurredAt),
  ]
  const stopAt = latestBy(stopTimes, (v) => v)
  const times = [verdict?.occurredAt ?? null, stopAt].filter((v): v is string => v !== null)
  const at = latestBy(times, (v) => v)
  if (at === null) return null
  return { at, source: verdict !== null ? 'touch' : 'stop_message' }
}

function isAnsweredCall(t: ReengageTouch): boolean {
  if (t.outcome === 'missed_inbound') return false
  return (t.talkSeconds ?? 0) >= MIN_INBOUND_CALL_SECONDS
}

function touchKind(t: ReengageTouch): ReengageKind | null {
  if (t.direction !== 'inbound') return null
  if (t.channel === 'messenger' || t.channel === 'whatsapp') return null
  const src = t.source ?? ''
  if (t.channel === META_FORM || src === META_FORM) return 'form'
  if (FORM_KINDS.has(t.channel) || FORM_KINDS.has(src)) return 'web_form'
  if (t.channel === 'phone' && src === 'twilio') return isAnsweredCall(t) ? 'inbound_call' : null
  const realEmail =
    t.channel === 'email' && src !== 'mailchimp' && t.automated !== true && !isAutoReply(t.subject ?? '')
  return realEmail && !isStop(t.body) ? 'email' : null
}

function messageCounts(m: ReengageMessage): boolean {
  return !!m.body && m.body.trim().length > 0 && !isStop(m.body)
}

function collectCandidates(input: ReengageInput, cutoffMs: number): ReengageTrigger[] {
  const latestOk = ts(input.asOf) + FUTURE_TOLERANCE_MS
  const inWindow = (at: string): boolean => ts(at) > cutoffMs && ts(at) <= latestOk
  const out: ReengageTrigger[] = []
  for (const t of input.touches) {
    const kind = touchKind(t)
    if (kind !== null && inWindow(t.occurredAt)) out.push({ kind, ref: t.id, at: t.occurredAt, channel: t.channel })
  }
  for (const m of input.inboundMessages) {
    if (messageCounts(m) && inWindow(m.sentAt)) out.push({ kind: 'message', ref: m.id, at: m.sentAt, channel: m.channel })
  }
  return out
}

function earliest(triggers: ReengageTrigger[]): ReengageTrigger | null {
  if (triggers.length === 0) return null
  return triggers.reduce((a, b) => (ts(b.at) < ts(a.at) ? b : a))
}

export function decideReengageClear(input: ReengageInput): ReengageDecision {
  if (!isDoNotContact(input.contactFlag, input.touches.map(toDncTouch))) return { clear: false, why: 'not_dnc' }
  if (input.reason && NOT_A_CUSTOMER.test(input.reason)) return { clear: false, why: 'not_a_customer' }
  if (latestVerdictIsFormOptOut(input.touches)) return { clear: false, why: 'form_opt_out' }

  const dnc = findDncAt(input)
  if (!dnc) return { clear: false, why: 'no_verdict_time' }

  const candidates = collectCandidates(input, ts(dnc.at) + SAME_CONVERSATION_MS)
  const auto = earliest(candidates.filter((c) => AUTO_KINDS.has(c.kind)))
  if (auto) return { clear: true, dncAt: dnc.at, dncAtSource: dnc.source, trigger: auto }

  // 没有表单/来电时，私信和回信只交给人看。只有原话没有触点（`stop_message`）的，私信也不报：
  // 拿私信里的一句话当判决时间，再拿同一渠道的下一句话当回头，太容易是同一段对话。
  const review = earliest(candidates.filter((c) => !AUTO_KINDS.has(c.kind)))
  if (review && dnc.source === 'touch') return { clear: false, why: 'needs_review', dncAt: dnc.at, trigger: review }
  return { clear: false, why: 'no_reengage' }
}
