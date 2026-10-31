/**
 * Follow-ups for payment deals that no longer wait on a person.
 * A deal that already went out says so. A deal that did not says what is
 * missing. A paid booking with no headcount is listed so it is not skipped
 * in silence. Held and in-doubt rows already have their own lines.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readCapiClientConfig, type DealMilestone } from '@/lib/conversions/capi-client-config'
import { legalPartySize } from '@/lib/conversions/crm-deal-party'
import { CRM_DEAL_AUTO_ACTOR } from '@/lib/conversions/crm-deal-send'
import { CRM_STAGE_MANUAL_SOURCE, crmDealSourceRef } from '@/lib/conversions/crm-deal-record'
import { DAY_MS, META_EVENT_WINDOW_DAYS, isPastEventWindow } from '@/lib/conversions/event-window'
import type { ManualItem } from './manual-items'

type NameMap = Map<string, { name: string }>

type AutoRow = {
  id: string
  client_id: string
  occurred_at: string
}

type SendRow = {
  outcome_id: string
  status: string
  payload_preview: unknown
}

type PartyGap = {
  clientId: string
  contactId: string
  paidOn: string | null
}

const APP = 'https://app.magicengine.com.au'

export async function pushCrmDealFollowUps(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: NameMap,
  now: Date,
): Promise<void> {
  await pushAutoPassedNotes(supabase, items, clientNames, now)
  await pushMissingPartyNotes(supabase, items, clientNames, now)
}

async function pushAutoPassedNotes(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: NameMap,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - META_EVENT_WINDOW_DAYS * DAY_MS).toISOString()
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('id, client_id, occurred_at')
    .eq('review_status', 'approved')
    .eq('reviewed_by', CRM_DEAL_AUTO_ACTOR)
    .is('redacted_at', null)
    .in('outcome_kind', ['purchase', 'balance'])
    .gte('occurred_at', since)
    .limit(200)
  if (error) throw new Error(`自动通过的成交查询失败: ${error.message}`)
  const rows = (data ?? []) as unknown as AutoRow[]
  if (rows.length === 0) return
  const sends = await loadSends(supabase, rows.map((row) => row.id))
  for (const [clientId, text] of describeAuto(rows, sends, now)) {
    items.push(line(clientNames, clientId, text.what, text.how, `${APP}/dashboard/conversions?client=${clientId}`))
  }
}

async function loadSends(supabase: SupabaseClient, ids: string[]): Promise<SendRow[]> {
  const { data, error } = await supabase
    .from('me_conversion_writebacks')
    .select('outcome_id, status, payload_preview')
    .in('outcome_id', ids)
    .limit(200)
  if (error) throw new Error(`自动通过的发送结果查询失败: ${error.message}`)
  return (data ?? []) as unknown as SendRow[]
}

function describeAuto(rows: AutoRow[], sends: SendRow[], now: Date): Map<string, { what: string; how: string }> {
  const byClient = new Map<string, { sent: number; gaps: string[] }>()
  for (const row of rows) {
    if (isPastEventWindow(row.occurred_at, now)) continue
    const bucket = classifySends(sends.filter((item) => item.outcome_id === row.id))
    if (bucket === 'skip') continue
    const cur = byClient.get(row.client_id) ?? { sent: 0, gaps: [] }
    if (bucket === 'sent') cur.sent += 1
    else cur.gaps.push(bucket)
    byClient.set(row.client_id, cur)
  }
  const out = new Map<string, { what: string; how: string }>()
  for (const [clientId, agg] of byClient) out.set(clientId, autoCopy(agg))
  return out
}

function classifySends(rows: SendRow[]): 'skip' | 'sent' | string {
  if (rows.some((row) => row.status === 'in_doubt' || row.status === 'sending')) return 'skip'
  if (rows.some((row) => row.status === 'queued' && held(row.payload_preview))) return 'skip'
  if (rows.some((row) => row.status === 'confirmed')) return 'sent'
  if (rows.length === 0) return '还没有发送记录'
  if (rows.some((row) => row.status === 'expired_no_send')) return '已经超过 7 天，广告平台收不进去'
  return '发送没有成功'
}

function autoCopy(agg: { sent: number; gaps: string[] }): { what: string; how: string } {
  if (agg.gaps.length === 0) {
    return {
      what: `有 ${agg.sent} 笔成交已自动发给广告平台，不用再批准。`,
      how: '不用点批准。若要核对，打开这一页看发送结果。',
    }
  }
  const missing = [...new Set(agg.gaps)].join('；')
  const sent = agg.sent > 0 ? `另有 ${agg.sent} 笔已经发出去。` : ''
  return {
    what: `有 ${agg.gaps.length} 笔成交已自动通过，但没有发出去。缺的是：${missing}。${sent}不用再批准。`,
    how: '打开这一页看缺的是哪一笔。人数没填的，回到订单里补上人数。',
  }
}

async function pushMissingPartyNotes(
  supabase: SupabaseClient,
  items: ManualItem[],
  clientNames: NameMap,
  now: Date,
): Promise<void> {
  const gaps = await findMissingParty(supabase)
  const byClient = new Map<string, PartyGap[]>()
  for (const gap of gaps) {
    const cur = byClient.get(gap.clientId) ?? []
    cur.push(gap)
    byClient.set(gap.clientId, cur)
  }
  for (const [clientId, group] of byClient) {
    const fresh = group.some((gap) => gap.paidOn != null && !isPastEventWindow(`${gap.paidOn}T12:00:00+12:00`, now))
    const tail = fresh ? '还在 7 天内的，补上后会自动发给广告平台。' : '补上后会留下成交记录。'
    const first = group[0]
    items.push(line(
      clientNames,
      clientId,
      `有 ${group.length} 笔已收款的订单没有出行人数，成交没有写成。${tail}`,
      '打开订单，填上出行人数并保存。保存后会补记这笔成交。',
      `${APP}/dashboard/clients/${clientId}/crm/all?contact=${first.contactId}&focus=bookings`,
    ))
  }
}

async function findMissingParty(supabase: SupabaseClient): Promise<PartyGap[]> {
  const clients = await liveMilestoneClients(supabase)
  if (clients.length === 0) return []
  const paid = await paidMilestones(supabase, clients)
  if (paid.length === 0) return []
  const open = await bookingsMissingParty(supabase, paid)
  if (open.length === 0) return []
  const taken = await activeDealRefs(supabase, open.map((row) => crmDealSourceRef(row.contactId, row.bookingId, null)))
  return open.filter((row) => !taken.has(crmDealSourceRef(row.contactId, row.bookingId, null))).map((row) => ({
    clientId: row.clientId,
    contactId: row.contactId,
    paidOn: row.paidOn,
  }))
}

async function liveMilestoneClients(supabase: SupabaseClient): Promise<Array<{ id: string; milestone: DealMilestone }>> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, conversion_stage, leads_config')
    .eq('conversion_stage', 'live')
    .limit(200)
  if (error) throw new Error(`成交客户查询失败: ${error.message}`)
  const out: Array<{ id: string; milestone: DealMilestone }> = []
  for (const row of (data ?? []) as unknown as Array<{ id?: unknown; leads_config?: unknown }>) {
    if (typeof row.id !== 'string') continue
    const cfg = readCapiClientConfig(row.leads_config)
    if (cfg.dealMilestoneMalformed || cfg.dealMilestone == null) continue
    out.push({ id: row.id, milestone: cfg.dealMilestone })
  }
  return out
}

async function paidMilestones(
  supabase: SupabaseClient,
  clients: Array<{ id: string; milestone: DealMilestone }>,
): Promise<Array<{ clientId: string; bookingId: string; paidOn: string | null }>> {
  const wanted = new Map(clients.map((client) => [client.id, client.milestone]))
  const { data, error } = await supabase
    .from('crm_booking_milestones')
    .select('client_id, booking_id, kind, paid_on')
    .in('client_id', [...wanted.keys()])
    .limit(500)
  if (error) throw new Error(`已收款订单查询失败: ${error.message}`)
  const out: Array<{ clientId: string; bookingId: string; paidOn: string | null }> = []
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const clientId = typeof row.client_id === 'string' ? row.client_id : null
    const bookingId = typeof row.booking_id === 'string' ? row.booking_id : null
    if (!clientId || !bookingId || row.kind !== wanted.get(clientId)) continue
    const paidOn = typeof row.paid_on === 'string' ? row.paid_on.slice(0, 10) : null
    if (paidOn == null || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) continue
    out.push({ clientId, bookingId, paidOn })
  }
  return out
}

async function bookingsMissingParty(
  supabase: SupabaseClient,
  paid: Array<{ clientId: string; bookingId: string; paidOn: string | null }>,
): Promise<Array<{ clientId: string; bookingId: string; contactId: string; paidOn: string | null }>> {
  const byBooking = new Map(paid.map((row) => [row.bookingId, row]))
  const { data, error } = await supabase
    .from('crm_bookings')
    .select('id, client_id, contact_id, party_size')
    .in('id', [...byBooking.keys()])
    .limit(500)
  if (error) throw new Error(`缺人数订单查询失败: ${error.message}`)
  const out: Array<{ clientId: string; bookingId: string; contactId: string; paidOn: string | null }> = []
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    if (legalPartySize(row.party_size) != null || typeof row.id !== 'string' || typeof row.contact_id !== 'string') continue
    const hit = byBooking.get(row.id)
    if (!hit || hit.clientId !== row.client_id) continue
    out.push({ clientId: hit.clientId, bookingId: row.id, contactId: row.contact_id, paidOn: hit.paidOn })
  }
  return out
}

async function activeDealRefs(supabase: SupabaseClient, refs: string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set()
  const { data, error } = await supabase
    .from('me_sale_outcomes')
    .select('source_ref, review_status, source_kind')
    .eq('source_kind', CRM_STAGE_MANUAL_SOURCE)
    .in('source_ref', refs)
    .limit(500)
  if (error) throw new Error(`已有成交查询失败: ${error.message}`)
  const taken = new Set<string>()
  for (const row of (data ?? []) as unknown as Array<{ source_ref?: unknown; review_status?: unknown }>) {
    if (row.review_status === 'rejected' || typeof row.source_ref !== 'string') continue
    taken.add(row.source_ref)
  }
  return taken
}

function held(preview: unknown): boolean {
  return preview !== null && typeof preview === 'object' && (preview as { held?: unknown }).held === true
}

function line(names: NameMap, clientId: string, what: string, how: string, href: string): ManualItem {
  return {
    kind: 'conversion_needs_review',
    client_name: names.get(clientId)?.name ?? '客户',
    client_id: clientId,
    what,
    how,
    href,
  }
}
