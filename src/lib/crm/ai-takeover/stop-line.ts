/**
 * Catalogue follow-up "stop line": should the AI stop following this guest up? Pure.
 *
 * Design: docs/specs/2026-11-14-crm-catalogue-followup-reschedule-v1.md §3 (slice 1).
 * PM 2026-11-12: once a real person has talked with the guest again, the guest goes back to the staff list and the
 * "AI 跟进中" mark comes off automatically. Judge by content, never by call length; when unsure, count it as talked.
 *
 * Rules, checked in this order (the first that holds wins, so the recorded reason is the strongest one):
 *   1. booked     — the guest has an active booking (countdown letters take over from here)
 *   2. dnc        — the guest must not be contacted any more
 *   3. stage      — the guest's stage stops marketing (won / handed to after-sales / stop marketing / terminal)
 *   4. came_back  — the guest reached out after takeover-on (form, answered inbound call, real email, chat message)
 *   5. talked     — a staff member reached the guest after takeover-on:
 *                     · a telephony call record the call analysis says the guest spoke on ('yes' or 'unclear');
 *                       with no analysis yet, the call's recorded outcome counts when it says they talked (this
 *                       outcome comes from the phone system and may rest on call length; the reason says so)
 *                     · AI voice-agent calls, spreadsheet imports and automated / approximate-time rows never count
 *                     · a staff note whose parsed outcome says the guest was reached (anything but no answer /
 *                       bad number / a do-not-contact correction); notes in the first hour after takeover-on are
 *                       ignored — they describe the call that led to sending the catalogue; and a note written
 *                       within 10 minutes after a call that did not reach the guest describes that failed call
 *                       (11-16: 45 of 69 "please follow up 2027 catalogue" notes sat after a call under 15 s)
 *
 * Getting this wrong in the "stop" direction only puts the guest back in front of staff (cheap, staff can resume);
 * so unknowns lean towards stopping, except a call with no analysis and no outcome, which proves nothing.
 */

import { customerCameBack, type CameBack } from './came-back'
import type { ReengageTouch } from '@/lib/crm/dnc-reengage'
import { FUTURE_TOLERANCE_MS } from '@/lib/crm/dnc-reengage'
import { customerSpokeOf } from '@/lib/crm/customer-spoke'
import { SYSTEM_CALL_SOURCES } from '@/lib/crm/email-templates/call-evidence'
import { CALL_TALKED_OUTCOMES, NOTE_CALL_WINDOW_MS, noteDescribesUnreachedCall } from './call-reach'

export type StopRule = 'booked' | 'dnc' | 'stage' | 'came_back' | 'talked'

export interface StopDecision {
  rule: StopRule
  /** Stable reference of the evidence (touchpoint id, booking id, stage key): one stop per piece of evidence. */
  evidenceRef: string
  /** When the evidence happened (null for state-like evidence such as a stage). */
  at: string | null
  /** One plain sentence for staff, shown in the drawer. */
  why: string
}

/** An outbound staff touch (contact_touchpoints row, already narrowed to what this check reads). */
export interface StaffTouch {
  id: string
  channel: string
  source: string | null
  occurredAt: string
  metadata: Record<string, unknown> | null
}

export interface StopLineInput {
  /** ai_takeover_since: when the AI started following this guest up. */
  since: string
  now: Date
  hasActiveBooking: { id: string } | null
  doNotContact: boolean
  stage: { key: string; label: string; stopsMarketing: boolean } | null
  /** Inbound touches after `since`, in the came-back shape. */
  inbound: readonly ReengageTouch[]
  /** Outbound phone touches (calls and staff notes) after `since`. */
  outboundPhone: readonly StaffTouch[]
}

export const NOTE_GRACE_MS = 60 * 60_000

/** Parsed note / call outcomes that do NOT mean the guest was reached. */
const NOT_REACHED = new Set(['no_answer', 'bad_number', 'dnc_cleared'])
/** Call outcomes (recorded on the call itself) that mean the guest talked, used only without a call analysis. */
const CALL_TALKED = CALL_TALKED_OUTCOMES
export { NOTE_CALL_WINDOW_MS }

const CAME_BACK_WORDS: Record<CameBack['kind'], string> = {
  form: '填了 Facebook 表单',
  web_form: '在官网填了表',
  inbound_call: '打来了电话',
  email: '回了邮件',
  message: '发来了私信',
}

function ms(v: string): number {
  const t = Date.parse(v)
  return Number.isNaN(t) ? Number.NaN : t
}

function outcomeOf(t: StaffTouch): string | null {
  const o = t.metadata?.outcome
  return typeof o === 'string' && o !== '' ? o : null
}

type Reach = 'analysis' | 'call_outcome' | 'note'

/**
 * Did this outbound phone touch reach the guest, and on what evidence? null = it proves nothing.
 * Only the telephony system's own call records (SYSTEM_CALL_SOURCES) are calls; `me_manual` is a staff note; any other
 * source (AI voice agent, spreadsheet imports) is not a staff conversation. Automated or approximate-time rows never count.
 */
function reached(t: StaffTouch): Reach | null {
  const meta = t.metadata ?? {}
  if (meta.automated === true || meta.time_is_approximate === true) return null
  const outcome = outcomeOf(t)
  if (t.source !== null && SYSTEM_CALL_SOURCES.includes(t.source)) {
    const spoke = customerSpokeOf(t.metadata)
    if (spoke === 'yes' || spoke === 'unclear') return 'analysis'
    if (spoke === 'no') return null
    return outcome !== null && CALL_TALKED.has(outcome) ? 'call_outcome' : null
  }
  if (t.source !== 'me_manual') return null
  // A staff note. No parsed outcome = "unsure" = counts as talked.
  return outcome === null || !NOT_REACHED.has(outcome) ? 'note' : null
}

function firstStaffTalk(input: StopLineInput): { touch: StaffTouch; how: Reach } | null {
  const from = ms(input.since)
  if (Number.isNaN(from)) return null
  const latestOk = input.now.getTime() + FUTURE_TOLERANCE_MS
  let best: { touch: StaffTouch; how: Reach } | null = null
  for (const t of input.outboundPhone) {
    if (t.channel !== 'phone') continue
    const at = ms(t.occurredAt)
    if (Number.isNaN(at) || at <= from || at > latestOk) continue
    const how = reached(t)
    if (how === null) continue
    if (how === 'note' && at - from < NOTE_GRACE_MS) continue
    if (how === 'note' && noteDescribesUnreachedCall(t, input.outboundPhone)) continue
    if (best === null || at < ms(best.touch.occurredAt)) best = { touch: t, how }
  }
  return best
}

export function decideStopLine(input: StopLineInput): StopDecision | null {
  if (input.hasActiveBooking !== null) {
    return { rule: 'booked', evidenceRef: `booking:${input.hasActiveBooking.id}`, at: null, why: '客人已经订了团，交给出发前的倒计时信。' }
  }
  if (input.doNotContact) {
    return { rule: 'dnc', evidenceRef: 'dnc', at: null, why: '客人被标成「别再联系」，系统不再跟进。' }
  }
  if (input.stage?.stopsMarketing === true) {
    return { rule: 'stage', evidenceRef: `stage:${input.stage.key}`, at: null, why: `客人的阶段已经是「${input.stage.label}」，不再跟进目录。` }
  }
  const back = customerCameBack(input.inbound, input.since, input.now)
  if (back !== null) {
    return { rule: 'came_back', evidenceRef: `came_back:${back.kind}:${back.at}`, at: back.at, why: `客人${CAME_BACK_WORDS[back.kind]}，交回员工跟进。` }
  }
  const talk = firstStaffTalk(input)
  if (talk !== null) {
    const how = talk.how === 'analysis'
      ? '电话里跟客人聊上了（通话分析）'
      : talk.how === 'call_outcome'
        ? '电话记录显示聊上了（还没有通话分析，按电话系统的结果推断）'
        : '员工记了一笔，跟客人联系上了'
    return { rule: 'talked', evidenceRef: `touch:${talk.touch.id}`, at: talk.touch.occurredAt, why: `${how}，交回员工跟进。` }
  }
  return null
}
