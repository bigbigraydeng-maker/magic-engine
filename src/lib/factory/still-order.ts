/**
 * One asset_only work order per client per week for stills.
 * Status is closed so the video review and publish queues never pick it up.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { FACTORY_DAILY_ORDER_CAP } from '@/lib/factory/constants'
import { isoDate, nzCalendar } from '@/lib/social/week-pack/cadence'

import { roundUsd } from './still-config'
import type { WeekWindow } from '@/lib/social/image-post-week'

export interface StillOrder {
  id: string
  spentUsd: number
}

export async function openStillOrder(
  supabase: SupabaseClient,
  clientId: string,
  week: WeekWindow,
  capUsd: number,
  now: Date,
): Promise<StillOrder | 'daily_order_cap' | 'no_factory_goal' | 'no_master_brief' | 'order_unreadable'> {
  const existing = await findStillOrder(supabase, clientId, week.weekStart)
  if (existing === 'unreadable') return 'order_unreadable'
  if (existing) return existing
  const todayCount = await countOrdersToday(supabase, clientId, now)
  if (todayCount === 'unreadable') return 'order_unreadable'
  if (todayCount >= FACTORY_DAILY_ORDER_CAP) return 'daily_order_cap'
  const goalId = await oneId(supabase, 'goals', clientId)
  if (goalId === 'unreadable') return 'order_unreadable'
  if (!goalId) return 'no_factory_goal'
  const briefId = await oneBriefId(supabase, clientId)
  if (briefId === 'unreadable') return 'order_unreadable'
  if (!briefId) return 'no_master_brief'
  return insertStillOrder(supabase, clientId, week, capUsd, goalId, briefId)
}

export async function recordStillSpend(
  supabase: SupabaseClient,
  order: StillOrder,
  amountUsd: number,
  slotKey: string,
): Promise<number | 'ledger_failed'> {
  const amount = roundUsd(amountUsd)
  if (amount <= 0) return order.spentUsd
  const { error } = await supabase.from('factory_balance_ledger').insert({
    entry_type: 'spend',
    amount_usd: -amount,
    work_order_id: order.id,
    note: `factory still ${slotKey}`,
  })
  if (error) return 'ledger_failed'
  const spent = roundUsd(order.spentUsd + amount)
  await supabase.from('content_work_orders').update({ actual_cost_usd: spent }).eq('id', order.id)
  return spent
}

async function findStillOrder(
  supabase: SupabaseClient,
  clientId: string,
  weekStart: string,
): Promise<StillOrder | null | 'unreadable'> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id')
    .eq('client_id', clientId)
    .eq('brief->factory_stills->>week_start', weekStart)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return 'unreadable'
  const id = rowId(data?.[0])
  if (!id) return null
  const spent = await spentOnOrder(supabase, id)
  if (spent === 'unreadable') return 'unreadable'
  return { id, spentUsd: spent }
}

async function spentOnOrder(supabase: SupabaseClient, orderId: string): Promise<number | 'unreadable'> {
  const { data, error } = await supabase
    .from('factory_balance_ledger')
    .select('amount_usd')
    .eq('work_order_id', orderId)
    .eq('entry_type', 'spend')
    .limit(80)
  if (error) return 'unreadable'
  const spent = (data ?? []).reduce((sum, row) => {
    const amount = typeof (row as { amount_usd?: unknown }).amount_usd === 'number'
      ? (row as { amount_usd: number }).amount_usd
      : 0
    return sum + (amount < 0 ? -amount : 0)
  }, 0)
  return roundUsd(spent)
}

async function countOrdersToday(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
): Promise<number | 'unreadable'> {
  const today = isoDate(nzCalendar(now))
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(40)
  if (error) return 'unreadable'
  return (data ?? []).filter((row) => {
    const created = (row as { created_at?: unknown }).created_at
    return typeof created === 'string' && isoDate(nzCalendar(new Date(created))) === today
  }).length
}

async function oneId(supabase: SupabaseClient, table: 'goals', clientId: string): Promise<string | null | 'unreadable'> {
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return 'unreadable'
  return rowId(data?.[0])
}

async function oneBriefId(supabase: SupabaseClient, clientId: string): Promise<string | null | 'unreadable'> {
  const { data, error } = await supabase
    .from('master_briefs')
    .select('id')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
  if (error) return 'unreadable'
  return rowId(data?.[0])
}

async function insertStillOrder(
  supabase: SupabaseClient,
  clientId: string,
  week: WeekWindow,
  capUsd: number,
  goalId: string,
  briefId: string,
): Promise<StillOrder | 'order_unreadable'> {
  const { data, error } = await supabase.from('content_work_orders').insert({
    client_id: clientId,
    goal_id: goalId,
    master_brief_id: briefId,
    order_type: 'fresh_angle',
    angle: `social stills ${week.weekStart}`,
    angle_source: { source: 'factory_stills', week_start: week.weekStart },
    rationale_one_liner: 'Still images for one social week. Not a video and not for publish.',
    brief: {
      engine: 'still',
      remotion: { deliverable: 'asset_only' },
      factory_stills: { week_start: week.weekStart, week_end: week.weekEnd },
    },
    budget_cap_usd: capUsd,
    actual_cost_usd: 0,
    status: 'closed',
    output: { stills: [] },
  }).select('id').single()
  if (error) return 'order_unreadable'
  const id = rowId(data)
  return id ? { id, spentUsd: 0 } : 'order_unreadable'
}

function rowId(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null
  const id = (row as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}
