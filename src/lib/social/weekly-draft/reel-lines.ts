/**
 * Week-plan reel lines keep reels already dated in the target week.
 * A later write run's receipt lists only rows that run newly scheduled.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { readPublishOn } from '@/lib/social/week-pack/manifest'

export interface ScheduledReelRef {
  id: string
  publishOn: string
}

const READ_CAP = 50

export function mergeScheduledReels(
  fresh: ReadonlyArray<ScheduledReelRef>,
  existing: ReadonlyArray<ScheduledReelRef>,
  week: { weekStart: string; weekEnd: string },
): ScheduledReelRef[] {
  const byId = new Map<string, ScheduledReelRef>()
  for (const row of existing) {
    if (!inWeek(row, week)) continue
    byId.set(row.id, { id: row.id, publishOn: row.publishOn })
  }
  for (const row of fresh) {
    if (!isRef(row)) continue
    byId.set(row.id, { id: row.id, publishOn: row.publishOn })
  }
  return [...byId.values()].sort(byDateThenId)
}

export async function loadScheduledReelsForWeek(
  db: SupabaseClient,
  clientId: string,
  week: { weekStart: string; weekEnd: string },
): Promise<ScheduledReelRef[] | 'unreadable'> {
  const { data, error } = await db
    .from('content_work_orders')
    .select('id, brief')
    .eq('client_id', clientId)
    .gte('brief->weekly_pack->>publish_on', week.weekStart)
    .lte('brief->weekly_pack->>publish_on', week.weekEnd)
    .limit(READ_CAP)
  if (error || !Array.isArray(data) || data.length >= READ_CAP) return 'unreadable'
  const rows: ScheduledReelRef[] = []
  for (const row of data) {
    const parsed = parseRow(row)
    if (parsed && inWeek(parsed, week)) rows.push(parsed)
  }
  return rows
}

function parseRow(row: unknown): ScheduledReelRef | null {
  if (!row || typeof row !== 'object') return null
  const id = (row as { id?: unknown }).id
  const day = readPublishOn((row as { brief?: unknown }).brief)
  if (typeof id !== 'string' || id.length === 0 || day === null || day === 'invalid') return null
  return { id, publishOn: day }
}

function isRef(row: ScheduledReelRef): boolean {
  return typeof row?.id === 'string' && row.id.length > 0
    && typeof row.publishOn === 'string' && row.publishOn.length > 0
}

function inWeek(row: ScheduledReelRef, week: { weekStart: string; weekEnd: string }): boolean {
  return isRef(row) && row.publishOn >= week.weekStart && row.publishOn <= week.weekEnd
}

function byDateThenId(a: ScheduledReelRef, b: ScheduledReelRef): number {
  if (a.publishOn !== b.publishOn) return a.publishOn < b.publishOn ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}
