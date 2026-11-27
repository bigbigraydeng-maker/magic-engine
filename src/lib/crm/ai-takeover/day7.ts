/**
 * Who is due the day-7 follow-up letter today. Pure (design docs/specs/2026-11-14-crm-catalogue-followup-reschedule-v1.md
 * §2 "第 7 天"; PM 11-27 「继续做第二件，第 7 天跟进信」).
 *
 * A guest in "AI 跟进中" is due when, counted from the day the catalogue went out (`ai_takeover_since`):
 *   - 7 days or more have passed, and fewer than 30 (from day 30 the AI stops writing, design §2);
 *   - the guest has not come back (a form, a call, a real reply, a chat — `customerCameBack`): staff handle those;
 *   - the guest has not opened what we sent (a human click on our mail link): those are back on staff's list (PR #3962);
 *   - nobody has written to them since (a non-automated outbound e-mail after the catalogue): one follow-up only.
 * Nothing here sends: the page drafts each letter with the existing AI follow-up writer and staff release it through
 * the existing compose route, where every send check (7 days / 2 mails, do-not-contact, unsubscribe…) still runs.
 */

import { isAutomatedTouch } from '@/lib/crm/automated-touch'
import { customerCameBack, toReengageTouchRow, type CameBackRow } from './came-back'

export const DAY_MS = 24 * 60 * 60 * 1000
export const DUE_FROM_DAY = 7
/** From this day on the AI no longer writes (design §2: day 30 = stop writing, only the regular newsletter). */
export const STOP_AT_DAY = 30
/** The catalogue mail itself is stamped around the takeover time: e-mails this close after it are that same send. */
const SAME_SEND_SLACK_MS = 30 * 60 * 1000

export type Day7Status = 'due' | 'not_yet' | 'past_30' | 'came_back' | 'clicked' | 'already_written'

export interface Day7Input {
  since: string
  touches: readonly CameBackRow[]
  /** Latest human click on a link in a mail we sent (`SiteReading.lastClickAt`), or null. */
  lastClickAt: string | null
}

export interface Day7Verdict {
  status: Day7Status
  /** Whole days since the catalogue went out. */
  day: number
}

function wroteSince(touches: readonly CameBackRow[], sinceMs: number): boolean {
  return touches.some(
    (t) =>
      t.direction === 'outbound' &&
      t.channel === 'email' &&
      !isAutomatedTouch(t.source, t.metadata ?? {}) &&
      Date.parse(t.occurred_at) > sinceMs + SAME_SEND_SLACK_MS,
  )
}

export function day7Status(input: Day7Input, now: Date): Day7Verdict {
  const sinceMs = Date.parse(input.since)
  const day = Number.isNaN(sinceMs) ? 0 : Math.floor((now.getTime() - sinceMs) / DAY_MS)
  if (Number.isNaN(sinceMs) || day < DUE_FROM_DAY) return { status: 'not_yet', day }
  if (customerCameBack(input.touches.map(toReengageTouchRow), input.since, now) !== null) return { status: 'came_back', day }
  if (input.lastClickAt !== null && Date.parse(input.lastClickAt) > sinceMs) return { status: 'clicked', day }
  if (wroteSince(input.touches, sinceMs)) return { status: 'already_written', day }
  if (day >= STOP_AT_DAY) return { status: 'past_30', day }
  return { status: 'due', day }
}
