/**
 * Whether this client's image posts may really go out.
 * Uses the same week and the same stored approval as the weekly plan card.
 * Anything other than a confirmed card for that week refuses the send.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { targetWeek } from '@/lib/social/week-pack/cadence'

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

export async function lookupWeekPackApproval(
  db: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<WeekPackApprovalRead> {
  try {
    const found = await readLatestWeeklyPlan(db, clientId, targetWeek(now).weekStart)
    return weekPackApprovalRead(found)
  } catch {
    return 'unreadable'
  }
}
