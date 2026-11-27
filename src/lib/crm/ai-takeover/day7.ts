/**
 * Who is due the day-7 follow-up letter today. Pure (design docs/specs/2026-11-14-crm-catalogue-followup-reschedule-v1.md
 * §2 "第 7 天"; PM 11-27 「继续做第二件，第 7 天跟进信」).
 *
 * A guest in "AI 跟进中" is due when, counted in the client's own calendar days from the day the catalogue went out
 * (`ai_takeover_since`):
 *   - day 7 or later, and before day 30 (from day 30 the AI stops writing, design §2);
 *   - the daily stop line would not stop them right now (booked, do-not-contact, stage, came back, talked to staff) —
 *     the caller judges that live with the stop line's own code, so nothing waits for tomorrow's 07:30 run;
 *   - the guest has not opened what we sent (a human click on our mail link): those are back on staff's list (#3962);
 *   - nobody has written to them since — an e-mail, WhatsApp or Messenger message by a person, or a send of ours that
 *     is in flight or done (the send log), so an unknown outcome never invites a second letter.
 * Nothing here sends: the page drafts each letter with the existing AI follow-up writer and staff release it through
 * the existing compose route, where every send check (7 days / 2 mails, do-not-contact, unsubscribe…) still runs.
 */

import { isAutomatedTouch } from '@/lib/crm/automated-touch'
import { todayInZone } from '@/lib/crm/email-templates/send-gates'
import type { CameBackRow } from './came-back'

export const DUE_FROM_DAY = 7
/** From this day on the AI no longer writes (design §2: day 30 = stop writing, only the regular newsletter). */
export const STOP_AT_DAY = 30
/** The catalogue mail itself is stamped around the takeover time: messages this close after it are that same send. */
const SAME_SEND_SLACK_MS = 30 * 60 * 1000
const WRITTEN_CHANNELS: ReadonlySet<string> = new Set(['email', 'whatsapp', 'messenger'])

export type Day7Status = 'due' | 'not_yet' | 'past_30' | 'stopped' | 'clicked' | 'already_written'

export interface Day7Input {
  since: string
  touches: readonly CameBackRow[]
  /** Latest human click on a link in a mail we sent, or null. */
  lastClickAt: string | null
  /** Latest send of ours to this guest in the send log (pending or sent), or null. */
  lastSendAt: string | null
  /** The stop line says stop right now. */
  stopped: boolean
  timeZone: string
}

export interface Day7Verdict {
  status: Day7Status
  /** Client-local calendar days since the catalogue went out. */
  day: number
}

/** Whole calendar days between two instants in one time zone (YYYY-MM-DD dates compared as UTC midnights). */
export function calendarDays(fromIso: string, now: Date, timeZone: string): number {
  const from = Date.parse(todayInZone(new Date(fromIso), timeZone))
  const to = Date.parse(todayInZone(now, timeZone))
  return Math.round((to - from) / 86_400_000)
}

function wroteSince(touches: readonly CameBackRow[], afterMs: number): boolean {
  return touches.some(
    (t) =>
      t.direction === 'outbound' &&
      WRITTEN_CHANNELS.has(t.channel) &&
      !isAutomatedTouch(t.source, t.metadata ?? {}) &&
      Date.parse(t.occurred_at) > afterMs,
  )
}

export function day7Status(input: Day7Input, now: Date): Day7Verdict {
  const sinceMs = Date.parse(input.since)
  if (Number.isNaN(sinceMs)) return { status: 'not_yet', day: 0 }
  const day = calendarDays(input.since, now, input.timeZone)
  if (day < DUE_FROM_DAY) return { status: 'not_yet', day }
  if (input.stopped) return { status: 'stopped', day }
  if (input.lastClickAt !== null && Date.parse(input.lastClickAt) > sinceMs) return { status: 'clicked', day }
  const after = sinceMs + SAME_SEND_SLACK_MS
  if (wroteSince(input.touches, after) || (input.lastSendAt !== null && Date.parse(input.lastSendAt) > after)) {
    return { status: 'already_written', day }
  }
  if (day >= STOP_AT_DAY) return { status: 'past_30', day }
  return { status: 'due', day }
}
