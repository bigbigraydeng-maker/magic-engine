/**
 * 成绩单「合格客人」这一块的数据加载（服务端，只读）。
 * 从 Supabase 拉近 30 天新客人、阶段变更、跟进记录，交给纯函数 computeQualifiedBlock 算。
 * 任何一步出错都返回 { error }，不抛。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import type { LeadTouch } from '@/lib/crm/lead-followup-due'
import {
  computeQualifiedBlock,
  QUALIFIED_OBSERVE_DAYS,
  QUALIFIED_WINDOW_DAYS,
  type QualifiedBlock,
  type QualifiedContact,
  type QualifiedEvent,
  type QualifiedUnitRef,
} from './qualified-leads'
import { adsetRows, buildAccountContext, localDayEndUtc, shiftDate, sumSpend } from './diagnostics/context'
import { scopeAccountToClient } from './diagnostics/ownership'
import type { DiagnosisInput } from './diagnostics/types'

const ID_CHUNK = 100

interface StageRow { id: string; stage_key: string | null }
interface ContactRow { id: string; stage: string | null; attr_adset_id: string | null; created_at: string }
interface EventRow { id: string; contact_id: string; to_stage: string; changed_by: string | null; created_at: string }
interface TouchRow {
  id: string
  contact_id: string
  channel: string
  direction: string | null
  occurred_at: string
  source: string | null
  metadata: Record<string, unknown> | null
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function unitsForQualified(input: DiagnosisInput): QualifiedUnitRef[] {
  const units: QualifiedUnitRef[] = []
  for (const raw of input.accounts) {
    if (raw.shared) continue
    const scoped = scopeAccountToClient(raw, input.clientPageId, input.date, input.evaluatedAt)
    if (scoped.accountLevelOnly) continue
    const ctx = buildAccountContext(scoped.account, input.date)
    for (const u of ctx.allBudgetUnits) {
      units.push({
        id: u.id,
        name: u.name,
        level: u.level,
        adsetIds: [...u.adsetIds],
        spentLast7d: sumSpend(adsetRows(ctx, u.adsetIds)) > 0,
      })
    }
  }
  return units
}

async function loadQualifiedStageKeys(clientId: string): Promise<string[] | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('qualified_stage_keys')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) {
    if (error.code === 'PGRST204' || error.code === '42703' || /qualified_stage_keys/.test(error.message)) {
      return { error: '数据库还没加「合格阶段」这一列' }
    }
    return { error: '读不到「哪些阶段算合格」的设置' }
  }
  const raw = (data as { qualified_stage_keys?: unknown } | null)?.qualified_stage_keys
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
}

async function loadKnownStageKeys(clientId: string): Promise<string[]> {
  const rows = await fetchAll<StageRow>((from, to) =>
    supabaseAdmin
      .from('client_pipeline_stages')
      .select('id, stage_key')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(from, to),
  )
  return rows.map(r => r.stage_key).filter((k): k is string => typeof k === 'string')
}

async function loadContacts(clientId: string, startIso: string, endIso: string): Promise<ContactRow[]> {
  return fetchAll<ContactRow>((from, to) =>
    supabaseAdmin
      .from('contacts')
      .select('id, stage, attr_adset_id, created_at')
      .eq('client_id', clientId)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('id', { ascending: true })
      .range(from, to),
  )
}

async function loadEvents(clientId: string, contactIds: string[]): Promise<EventRow[]> {
  const out: EventRow[] = []
  for (const ids of chunk(contactIds, ID_CHUNK)) {
    const rows = await fetchAll<EventRow>((from, to) =>
      supabaseAdmin
        .from('contact_stage_events')
        .select('id, contact_id, to_stage, changed_by, created_at')
        .eq('client_id', clientId)
        .in('contact_id', ids)
        .order('id', { ascending: true })
        .range(from, to),
    )
    out.push(...rows)
  }
  return out
}

async function loadTouches(clientId: string, contactIds: string[]): Promise<TouchRow[]> {
  const out: TouchRow[] = []
  for (const ids of chunk(contactIds, ID_CHUNK)) {
    const rows = await fetchAll<TouchRow>((from, to) =>
      supabaseAdmin
        .from('contact_touchpoints')
        .select('id, contact_id, channel, direction, occurred_at, source, metadata')
        .eq('client_id', clientId)
        .in('contact_id', ids)
        .order('id', { ascending: true })
        .range(from, to),
    )
    out.push(...rows)
  }
  return out
}

function toTouch(r: TouchRow): LeadTouch {
  return {
    channel: r.channel,
    direction: r.direction,
    occurredAt: r.occurred_at,
    source: r.source,
    metadata: r.metadata,
  }
}

function groupByContact<T extends { contact_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const list = map.get(r.contact_id)
    if (list) list.push(r)
    else map.set(r.contact_id, [r])
  }
  return map
}

function toEvent(r: EventRow): QualifiedEvent {
  return { toStage: r.to_stage, changedBy: r.changed_by, createdAt: r.created_at }
}

function buildContacts(
  contacts: ContactRow[],
  events: EventRow[],
  touches: TouchRow[],
): QualifiedContact[] {
  const eventsByContact = groupByContact(events)
  const touchesByContact = groupByContact(touches)
  return contacts.map(c => ({
    id: c.id,
    adsetId: c.attr_adset_id,
    createdAt: c.created_at,
    stage: c.stage,
    events: (eventsByContact.get(c.id) ?? []).map(toEvent),
    touches: (touchesByContact.get(c.id) ?? []).map(toTouch),
  }))
}

export async function loadQualifiedBlock(input: DiagnosisInput): Promise<QualifiedBlock | { error: string }> {
  try {
    const tz = input.accounts[0]?.timezone ?? null
    const windowStart = shiftDate(input.date, -(QUALIFIED_WINDOW_DAYS - 1))
    const startIso = new Date(localDayEndUtc(shiftDate(windowStart, -1), tz) + 1).toISOString()
    const endMs = localDayEndUtc(input.date, tz)
    const endIso = new Date(endMs).toISOString()

    const keys = await loadQualifiedStageKeys(input.clientId)
    if (!Array.isArray(keys)) return keys
    // 没设置哪些阶段算合格：页面只写「还没设置」，不用读客人
    if (keys.length === 0) {
      return computeQualifiedBlock({
        date: input.date, windowStart, endUtcMs: endMs, observeDays: QUALIFIED_OBSERVE_DAYS,
        qualifiedStageKeys: [], knownStageKeys: [], contacts: [], units: [],
      })
    }

    const knownStageKeys = await loadKnownStageKeys(input.clientId)
    const contactRows = await loadContacts(input.clientId, startIso, endIso)
    const contactIds = contactRows.map(c => c.id)
    const events = contactIds.length > 0 ? await loadEvents(input.clientId, contactIds) : []
    const touches = contactIds.length > 0 ? await loadTouches(input.clientId, contactIds) : []
    const contacts = buildContacts(contactRows, events, touches)

    return computeQualifiedBlock({
      date: input.date,
      windowStart,
      endUtcMs: endMs,
      observeDays: QUALIFIED_OBSERVE_DAYS,
      qualifiedStageKeys: keys,
      knownStageKeys,
      contacts,
      units: unitsForQualified(input),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { error: '合格客人这一块没算出来：' + message }
  }
}
