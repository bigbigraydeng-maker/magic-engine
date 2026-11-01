/**
 * 今日待办：下一周整包该批了，或有条目被单独拦住。
 * 总闸关闭时一条都不发。读不到就说读不到，不说「没有」。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'
import { cadenceFromConfig, isWeekday, nzDateKey, targetWeek } from '@/lib/social/week-pack/cadence'
import { weekPackSubject } from '@/lib/social/week-pack/facts'
import { weeklyPackApprovalEnabled, type WeekPackEnv } from '@/lib/social/week-pack/switches'

import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

const CARD_TTL_MS = 30 * 60 * 1000
const EXPIRING_MS = 20 * 60 * 1000
const LOOK_CAP = 200

export interface PendingCard {
  clientId: string
  subjectKey: string
  issuedAt: string
}

export interface HeldCount {
  clientId: string
  stories: number
  reels: number
}

export interface HandledPack {
  clientId: string
  subjectKey: string
}

export interface WeekPackTodoSource {
  configs: Array<{ id: string; name: string; config: unknown }> | 'unread'
  pending: PendingCard[] | 'unread'
  handled: HandledPack[] | 'unread'
  held: HeldCount[] | 'unread'
}

/** A pack this client and week already agreed to, or already turned down. Expired and voided cards are not handled. */
export function readHandledPack(row: {
  clientId: string
  status: string
  subjectKey: string
  reason: string
}): HandledPack | null {
  if (!row.clientId || !row.subjectKey.startsWith('social:week-pack:')) return null
  if (row.status === 'authorized') return { clientId: row.clientId, subjectKey: row.subjectKey }
  if (row.status === 'denied' && row.reason.includes('不做')) {
    return { clientId: row.clientId, subjectKey: row.subjectKey }
  }
  return null
}

export function buildWeekPackTodoItems(source: WeekPackTodoSource, now: Date, enabled: boolean): ManualItem[] {
  if (!enabled) return []
  const items: ManualItem[] = []
  if (source.configs === 'unread' || source.pending === 'unread' || source.handled === 'unread') {
    items.push(unreadable('今天读不到整包该不该批，不要当成没有人待批。', '打开一位客户的本周总览看「批下一周」。'))
  } else {
    items.push(...approvalItems(source.configs, source.pending, source.handled, now))
  }
  if (source.held === 'unread') {
    items.push(unreadable('今天读不到有几条被单独拦住，不要当成 0 条。', '打开本周总览和 Story 页看被拦住的内容。'))
  } else {
    items.push(...heldItems(source.held, source.configs === 'unread' ? [] : source.configs))
  }
  return items
}

export async function pushWeekPackItems(
  supabase: SupabaseClient,
  bucket: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
  env: WeekPackEnv,
  clientIds: readonly string[],
): Promise<void> {
  if (!weeklyPackApprovalEnabled(env) || clientIds.length === 0) return
  const source = await loadWeekPackTodoSource(supabase, now, nameOf, clientIds)
  bucket.push(...buildWeekPackTodoItems(source, now, true))
}

async function loadWeekPackTodoSource(
  supabase: SupabaseClient,
  now: Date,
  nameOf: (id: string) => string,
  clientIds: readonly string[],
): Promise<WeekPackTodoSource> {
  const [configs, pending, handled, held] = await Promise.all([
    loadConfigs(supabase, nameOf, clientIds),
    loadPending(supabase),
    loadHandled(supabase),
    loadHeld(supabase, now, clientIds),
  ])
  return { configs, pending, handled, held }
}

async function loadConfigs(
  supabase: SupabaseClient,
  nameOf: (id: string) => string,
  clientIds: readonly string[],
): Promise<WeekPackTodoSource['configs']> {
  const { data, error } = await supabase.from('clients').select('id, publishing_calendar_config').in('id', [...clientIds])
  if (error) return 'unread'
  return ((data ?? []) as Array<{ id?: unknown; publishing_calendar_config?: unknown }>).flatMap((row) => {
    if (typeof row.id !== 'string') return []
    return [{ id: row.id, name: nameOf(row.id), config: row.publishing_calendar_config ?? null }]
  })
}

async function loadPending(supabase: SupabaseClient): Promise<WeekPackTodoSource['pending']> {
  const { data, error } = await supabase
    .from('action_runs')
    .select('client_id, input')
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .eq('status', 'pending_approval')
    .limit(LOOK_CAP)
  if (error) return 'unread'
  const rows = data ?? []
  if (rows.length >= LOOK_CAP) return 'unread'
  return rows.flatMap((row) => readPending(row as { client_id?: unknown; input?: unknown }))
}

function readPending(row: { client_id?: unknown; input?: unknown }): PendingCard[] {
  if (typeof row.client_id !== 'string') return []
  const input = row.input && typeof row.input === 'object' ? row.input as Record<string, unknown> : null
  const subjectKey = typeof input?.subject_key === 'string' ? input.subject_key : ''
  const issuedAt = typeof input?.issued_at === 'string' ? input.issued_at : ''
  if (!subjectKey.startsWith('social:week-pack:') || !issuedAt) return []
  return [{ clientId: row.client_id, subjectKey, issuedAt }]
}

async function loadHeld(
  supabase: SupabaseClient,
  now: Date,
  clientIds: readonly string[],
): Promise<WeekPackTodoSource['held']> {
  const week = targetWeek(now)
  const [stories, reels] = await Promise.all([
    countStories(supabase, week.weekStart, week.weekEnd, clientIds),
    countReels(supabase, now, clientIds),
  ])
  if (stories === 'unread' || reels === 'unread') return 'unread'
  return mergeHeld(stories, reels)
}

async function countStories(
  supabase: SupabaseClient,
  weekStart: string,
  weekEnd: string,
  clientIds: readonly string[],
): Promise<Map<string, number> | 'unread'> {
  const from = new Date(Date.parse(`${weekStart}T00:00:00Z`) - 2 * 86_400_000).toISOString()
  const to = new Date(Date.parse(`${weekEnd}T00:00:00Z`) + 3 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('story_items')
    .select('client_id, slot_at')
    .in('client_id', [...clientIds])
    .in('status', ['BLOCKED', 'FAILED', 'MISSED'])
    .gte('slot_at', from)
    .lt('slot_at', to)
    .limit(LOOK_CAP)
  if (error || (data ?? []).length >= LOOK_CAP) return 'unread'
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ client_id?: unknown; slot_at?: unknown }>) {
    if (typeof row.client_id !== 'string' || typeof row.slot_at !== 'string') continue
    const day = nzDateKey(row.slot_at)
    if (day < weekStart || day > weekEnd) continue
    counts.set(row.client_id, (counts.get(row.client_id) ?? 0) + 1)
  }
  return counts
}

async function countReels(
  supabase: SupabaseClient,
  now: Date,
  clientIds: readonly string[],
): Promise<Map<string, number> | 'unread'> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('client_id')
    .in('client_id', [...clientIds])
    .eq('status', 'publish_failed')
    .gte('updated_at', since)
    .limit(LOOK_CAP)
  if (error || (data ?? []).length >= LOOK_CAP) return 'unread'
  const counts = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ client_id?: unknown }>) {
    if (typeof row.client_id !== 'string') continue
    counts.set(row.client_id, (counts.get(row.client_id) ?? 0) + 1)
  }
  return counts
}

function mergeHeld(stories: Map<string, number>, reels: Map<string, number>): HeldCount[] {
  const ids = new Set([...stories.keys(), ...reels.keys()])
  return [...ids].map((clientId) => ({
    clientId,
    stories: stories.get(clientId) ?? 0,
    reels: reels.get(clientId) ?? 0,
  }))
}

async function loadHandled(supabase: SupabaseClient): Promise<WeekPackTodoSource['handled']> {
  const { data, error } = await supabase
    .from('action_runs')
    .select('client_id, status, input, authorization_decision_id')
    .eq('action_key', CONFIRMATION_ACTION_KEY)
    .in('status', ['authorized', 'denied'])
    .limit(LOOK_CAP)
  if (error || (data ?? []).length >= LOOK_CAP) return 'unread'
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const reasons = await decisionReasons(supabase, rows)
  if (reasons === 'unread') return 'unread'
  return rows.flatMap((row) => {
    const packed = readHandledPack(handledFields(row, reasons))
    return packed ? [packed] : []
  })
}

function handledFields(row: Record<string, unknown>, reasons: ReadonlyMap<string, string>): {
  clientId: string
  status: string
  subjectKey: string
  reason: string
} {
  const input = row.input && typeof row.input === 'object' ? row.input as Record<string, unknown> : null
  const decisionId = typeof row.authorization_decision_id === 'string' ? row.authorization_decision_id : ''
  return {
    clientId: typeof row.client_id === 'string' ? row.client_id : '',
    status: typeof row.status === 'string' ? row.status : '',
    subjectKey: typeof input?.subject_key === 'string' ? input.subject_key : '',
    reason: reasons.get(decisionId) ?? '',
  }
}

async function decisionReasons(
  supabase: SupabaseClient,
  rows: Array<Record<string, unknown>>,
): Promise<Map<string, string> | 'unread'> {
  const ids = rows.flatMap((row) => (
    row.status === 'denied' && typeof row.authorization_decision_id === 'string'
      ? [row.authorization_decision_id]
      : []
  ))
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.from('authorization_decisions').select('id, reason').in('id', ids)
  if (error) return 'unread'
  const reasons = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ id?: unknown; reason?: unknown }>) {
    if (typeof row.id === 'string') reasons.set(row.id, typeof row.reason === 'string' ? row.reason : '')
  }
  return reasons
}

function approvalItems(
  configs: Array<{ id: string; name: string; config: unknown }>,
  pending: PendingCard[],
  handled: HandledPack[],
  now: Date,
): ManualItem[] {
  const week = targetWeek(now)
  const items: ManualItem[] = []
  for (const client of configs) {
    const cadence = cadenceFromConfig(client.config)
    const subject = weekPackSubject(client.id, week.weekStart)
    if (handled.some((row) => row.clientId === client.id && row.subjectKey === subject)) continue
    const card = pending.find((row) => row.clientId === client.id && row.subjectKey === subject)
    const age = card ? now.getTime() - Date.parse(card.issuedAt) : null
    const fresh = age != null && age >= 0 && age < EXPIRING_MS
    const expiring = age != null && age >= EXPIRING_MS && age < CARD_TTL_MS
    if (isWeekday(now, cadence.approveWeekday) && !fresh) items.push(needsApproval(client, Boolean(card)))
    else if (expiring) items.push(needsApproval(client, true))
  }
  return items
}

function needsApproval(client: { id: string; name: string }, expiring: boolean): ManualItem {
  return {
    kind: 'week_pack_needs_approval',
    client_id: client.id,
    client_name: client.name,
    what: expiring
      ? '下一周的整包确认卡快过期了。过了就要重新打开页面，不批就不会按这张卡发。'
      : '下一周的社媒整包还没批。不批的话，到了发布日不会按这张卡发出去。',
    how: '打开本周总览，拉到「批下一周」，看完再点同意或先不发。',
    href: `${APP_BASE}/dashboard/clients/${encodeURIComponent(client.id)}/daily-plan?tab=overview#approve-week`,
  }
}

function heldItems(held: HeldCount[], configs: Array<{ id: string; name: string }>): ManualItem[] {
  const names = new Map(configs.map((client) => [client.id, client.name]))
  return held.filter((row) => row.stories + row.reels > 0).map((row) => ({
    kind: 'week_pack_items_held' as const,
    client_id: row.clientId,
    client_name: names.get(row.clientId) ?? '这位客户',
    what: `单独拦下 ${row.stories + row.reels} 条（Story ${row.stories} 条，视频 ${row.reels} 条），没有整包撤回。这些不会发出去。`,
    how: '打开 Story 页看被拦住的条目；视频没公开的，去视频工厂逐条处理。',
    href: row.stories > 0
      ? `${APP_BASE}/dashboard/clients/${encodeURIComponent(row.clientId)}/story`
      : `${APP_BASE}/dashboard/clients/${encodeURIComponent(row.clientId)}/daily-plan?tab=reels`,
  }))
}

function unreadable(what: string, how: string): ManualItem {
  return {
    kind: 'week_pack_needs_approval',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what,
    how,
    href: `${APP_BASE}/dashboard`,
  }
}
