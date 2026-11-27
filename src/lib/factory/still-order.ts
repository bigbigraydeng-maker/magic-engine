/**
 * One asset_only work order per client per week for stills.
 * Status is closed so the video review and publish queues never pick it up.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { FACTORY_DAILY_ORDER_CAP } from '@/lib/factory/constants'
import { isoDate, nzCalendar } from '@/lib/social/week-pack/cadence'

import { roundUsd } from './still-config'
import type { StillWorkReview } from './still-review'
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

export interface HandledStillSlot {
  role: 'story' | 'post'
  aspect: '9:16' | '4:5'
  slotDate: string
}

/**
 * Slots this week's still order already failed. A pass without an asset stamp stays open
 * so a later run can write the mark. A miss here is not made again.
 */
export async function loadHandledStillSlots(
  supabase: SupabaseClient,
  clientId: string,
  weekStart: string,
): Promise<HandledStillSlot[] | 'unreadable'> {
  const stills = await readWeekStills(supabase, clientId, weekStart)
  if (stills === 'unreadable') return 'unreadable'
  const handled: HandledStillSlot[] = []
  for (const raw of stills) {
    const slot = handledSlot(raw)
    if (slot) handled.push(slot)
  }
  return handled
}

export interface OpenPassStill {
  role: 'story' | 'post'
  aspect: '9:16' | '4:5'
  slotDate: string
  assetId: string | null
  tourId: string | null
}

/** Latest pass review for each slot. A later fail closes that slot. */
export async function loadOpenPassStills(
  supabase: SupabaseClient,
  clientId: string,
  weekStart: string,
): Promise<OpenPassStill[] | 'unreadable'> {
  const stills = await readWeekStills(supabase, clientId, weekStart)
  if (stills === 'unreadable') return 'unreadable'
  const latest = new Map<string, OpenPassStill | null>()
  for (const raw of stills) {
    const slot = openPassOf(raw)
    if (!slot) continue
    latest.set(slot.key, slot.pass)
  }
  return [...latest.values()].filter((row): row is OpenPassStill => row !== null)
}

export async function replacePassWithFail(
  supabase: SupabaseClient,
  orderId: string,
  slot: { role: 'story' | 'post'; aspect: '9:16' | '4:5'; date: string },
  reasons: string[],
): Promise<boolean> {
  const { data, error } = await supabase.from('content_work_orders').select('output').eq('id', orderId).limit(1)
  if (error) return false
  const row = (data ?? [])[0] as { output?: unknown } | undefined
  if (!row) return false
  const output = record(row.output) ?? {}
  const prior = Array.isArray(output.stills) ? output.stills : []
  const changed = { value: false }
  const stills = prior.map((raw) => rewritePass(raw, slot, reasons, changed))
  if (!changed.value) return false
  const { error: updErr } = await supabase.from('content_work_orders').update({
    output: { ...output, stills },
  }).eq('id', orderId)
  return !updErr
}

export async function appendStillReview(
  supabase: SupabaseClient,
  orderId: string,
  review: StillWorkReview,
): Promise<boolean> {
  const { data, error } = await supabase.from('content_work_orders').select('output').eq('id', orderId).limit(1)
  if (error) return false
  const row = (data ?? [])[0] as { output?: unknown } | undefined
  if (!row) return false
  const output = record(row.output) ?? {}
  const prior = Array.isArray(output.stills) ? output.stills : []
  const { error: updErr } = await supabase.from('content_work_orders').update({
    output: { ...output, stills: [...prior, review].slice(-40) },
  }).eq('id', orderId)
  return !updErr
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

async function readWeekStills(
  supabase: SupabaseClient,
  clientId: string,
  weekStart: string,
): Promise<unknown[] | 'unreadable'> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('output')
    .eq('client_id', clientId)
    .eq('brief->factory_stills->>week_start', weekStart)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return 'unreadable'
  const output = record(record((data ?? [])[0])?.output)
  return Array.isArray(output?.stills) ? output.stills : []
}

function handledSlot(raw: unknown): HandledStillSlot | null {
  const row = record(raw)
  if (!row || row.verdict === 'pass') return null
  if (row.role !== 'story' && row.role !== 'post') return null
  if (row.aspect !== '9:16' && row.aspect !== '4:5') return null
  if (typeof row.slot_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.slot_date)) return null
  return { role: row.role, aspect: row.aspect, slotDate: row.slot_date }
}

function openPassOf(raw: unknown): { key: string; pass: OpenPassStill | null } | null {
  const row = record(raw)
  if (!row) return null
  if (row.role !== 'story' && row.role !== 'post') return null
  if (row.aspect !== '9:16' && row.aspect !== '4:5') return null
  if (typeof row.slot_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.slot_date)) return null
  const tourId = typeof row.tour_id === 'string' ? row.tour_id.trim() : ''
  return {
    key: `${row.role}:${row.aspect}:${row.slot_date}`,
    pass: row.verdict === 'pass' ? {
      role: row.role,
      aspect: row.aspect,
      slotDate: row.slot_date,
      assetId: typeof row.asset_id === 'string' ? row.asset_id : null,
      tourId: tourId.length > 0 ? tourId : null,
    } : null,
  }
}

function rewritePass(
  raw: unknown,
  slot: { role: 'story' | 'post'; aspect: '9:16' | '4:5'; date: string },
  reasons: string[],
  changed: { value: boolean },
): unknown {
  const item = record(raw)
  if (!item || item.verdict !== 'pass') return raw
  if (item.role !== slot.role || item.aspect !== slot.aspect || item.slot_date !== slot.date) return raw
  changed.value = true
  return { ...item, verdict: 'fail', reasons: reasons.slice(0, 4) }
}

function record(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}

function rowId(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null
  const id = (row as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}
