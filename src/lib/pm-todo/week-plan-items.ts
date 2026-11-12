/**
 * 今日待办：本周社媒方案（周计划）确认卡还在等批。
 * 只读 action_runs 里 social:week-plan 待确认行，不发布、不自动点同意。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { readStoredCard } from '@/lib/confirmation-card/view'
import { weekPlanSubject } from '@/lib/social/weekly-plan/approval'
import { targetWeek } from '@/lib/social/week-pack/cadence'

import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

const LOOK_CAP = 200

export interface WeekPlanPendingCard {
  clientId: string
  subjectKey: string
  runId: string
}

export function buildWeekPlanApprovalTodoItems(
  pending: readonly WeekPlanPendingCard[],
  nameOf: (id: string) => string,
  now: Date,
): ManualItem[] {
  const week = targetWeek(now)
  const seen = new Set<string>()
  const items: ManualItem[] = []
  for (const card of pending) {
    if (seen.has(card.clientId)) continue
    const expected = weekPlanSubject(card.clientId, week.weekStart)
    if (card.subjectKey !== expected) continue
    seen.add(card.clientId)
    items.push({
      kind: 'week_plan_needs_approval',
      client_id: card.clientId,
      client_name: nameOf(card.clientId),
      what: '本周包等你批',
      how: '打开本周总览，看完这一周的 Story、图文和 Reel 方案，再点同意或先不发。',
      href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(card.clientId)}/daily-plan?tab=overview`,
    })
  }
  return items
}

export async function pushWeekPlanApprovalItems(
  supabase: SupabaseClient,
  bucket: ManualItem[],
  clientIds: readonly string[],
  nameOf: (id: string) => string,
  now: Date = new Date(),
): Promise<void> {
  if (clientIds.length === 0) return
  const pending = await loadWeekPlanPending(supabase, clientIds)
  if (pending === 'unread') {
    bucket.push({
      kind: 'week_plan_needs_approval',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what: '本周方案待批清单今天没读出来，这一栏可能不全。',
      how: '这条不用你动手，是我们这边的欠账。',
      href: 'https://app.inngest.com',
    })
    return
  }
  bucket.push(...buildWeekPlanApprovalTodoItems(pending, nameOf, now))
}

async function loadWeekPlanPending(
  supabase: SupabaseClient,
  clientIds: readonly string[],
): Promise<WeekPlanPendingCard[] | 'unread'> {
  const { data, error } = await supabase
    .from('action_runs')
    .select('id, client_id, input')
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .eq('status', 'pending_approval')
    .in('client_id', [...clientIds])
    .like('input->>subject_key', 'social:week-plan:%')
    .order('updated_at', { ascending: false })
    .limit(LOOK_CAP)
  if (error || (data ?? []).length >= LOOK_CAP) return 'unread'
  const out: WeekPlanPendingCard[] = []
  for (const row of data ?? []) {
    const record = row as { id?: unknown; client_id?: unknown; input?: unknown }
    if (typeof record.id !== 'string' || typeof record.client_id !== 'string') continue
    const input = record.input && typeof record.input === 'object' ? (record.input as Record<string, unknown>) : null
    const stored = input ? readStoredCard(input) : null
    const subjectKey = stored?.subjectKey ?? ''
    if (!subjectKey.startsWith('social:week-plan:')) continue
    out.push({ clientId: record.client_id, subjectKey, runId: record.id })
  }
  return out
}
