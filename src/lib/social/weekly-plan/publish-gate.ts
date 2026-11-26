/**
 * Whether this client's image posts may really go out.
 * A weekly card is stored by the Monday of its week. A post is not linked to a
 * card, so the card is the one whose Monday–Sunday contains the scheduled date.
 * The planning week (next Monday, or the one after) is not used here.
 * Anything other than a confirmed card for that week refuses the send.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { addCalendarDays, isoDate } from '@/lib/social/week-pack/cadence'

import { readLatestWeeklyPlan, type StoredWeeklyPlan } from './db'

export type WeekPackApprovalRead = 'approved' | 'unapproved' | 'missing' | 'unreadable'

export function weekPackApprovalRead(found: StoredWeeklyPlan | null | 'unreadable'): WeekPackApprovalRead {
  if (found === 'unreadable') return 'unreadable'
  if (found === null) return 'missing'
  if (found.approval?.status === 'confirmed') return 'approved'
  return 'unapproved'
}

export function weekPackSkipReason(read: WeekPackApprovalRead): string | null {
  if (read === 'approved') return null
  if (read === 'missing') return 'WEEK_PACK_MISSING'
  if (read === 'unreadable') return 'WEEK_PACK_UNREADABLE'
  return 'WEEK_PACK_NOT_APPROVED'
}

/** Monday of the Monday–Sunday that contains a YYYY-MM-DD scheduled date. */
export function weekStartOfScheduledDate(scheduledDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scheduledDate)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() + 1 !== month || utc.getUTCDate() !== day) return null
  const weekday = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay()
  return isoDate(addCalendarDays(year, month, day, 1 - weekday))
}

export async function lookupWeekPackApproval(
  db: SupabaseClient,
  clientId: string,
  scheduledDate: string,
): Promise<WeekPackApprovalRead> {
  try {
    const weekStart = weekStartOfScheduledDate(scheduledDate)
    if (!weekStart) return 'unreadable'
    const found = await readLatestWeeklyPlan(db, clientId, weekStart)
    return weekPackApprovalRead(found)
  } catch {
    return 'unreadable'
  }
}
