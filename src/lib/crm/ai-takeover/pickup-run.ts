/**
 * Daily AI pickup: read every recent enquiry of the clients that opted in, decide (pickup.ts), and mark the AI
 * takeover on for the guests the AI should follow up. Knocked by the Render dispatcher
 * (app/api/cron/crm-ai-pickup/route.ts).
 *
 * Switches (env, not client data):
 *   CRM_AI_PICKUP_CLIENTS   comma list of client ids that opted in; empty = nobody
 *   CRM_AI_PICKUP           'live' writes; 'off' does nothing; anything else (default) decides and writes nothing
 *   CRM_AI_PICKUP_DAILY_MAX at most this many marks per client per run, oldest enquiry first (default 30): a marked
 *                           guest leaves the staff list, so marks never run ahead of what can be emailed in a day
 *
 * The only write is the takeover event log + its mirror (store.ts recordTakeover), actor `system:ai-pickup`, one event
 * per enquiry and rule (source_ref), re-read just before writing. No email, no stage change.
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { isDoNotContact } from '@/lib/crm/dnc'
import { judgeEligibility, type EligibilityStage } from '@/lib/crm/catalogue-line/eligibility'
import { SYSTEM_CALL_SOURCES } from '@/lib/crm/email-templates/call-evidence'
import { toReengageTouchRow, type CameBackRow } from './came-back'
import { callReach, isSystemCall } from './call-reach'
import { createTakeoverStore } from './prod'
import { recordTakeover, type TakeoverStoreDeps } from './store'
import { DEFAULT_PICKUP_CONFIG, decideAiPickup, type PickupConfig, type PickupRule } from './pickup'

export const PICKUP_JOB = 'crm-ai-pickup'
export const PICKUP_ACTOR = 'system:ai-pickup'
const WINDOW_DAYS = 60
const CHUNK = 100
const ENQUIRY_CHANNELS = ['meta_lead_form', 'web_form']
/** Platform convention for the new-lead stage key (lib/crm/new-lead-stage.ts). */
const NEW_LEAD_STAGE = 'new'

export type PickupMode = 'off' | 'dry_run' | 'live'

export function pickupSwitches(env: Record<string, string | undefined>): { mode: PickupMode; clients: string[]; dailyMax: number } {
  const v = (env.CRM_AI_PICKUP ?? '').trim().toLowerCase()
  const mode: PickupMode = v === 'off' ? 'off' : v === 'live' ? 'live' : 'dry_run'
  const clients = (env.CRM_AI_PICKUP_CLIENTS ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '')
  const n = Number.parseInt(env.CRM_AI_PICKUP_DAILY_MAX ?? '', 10)
  return { mode, clients, dailyMax: Number.isFinite(n) && n >= 0 ? n : 30 }
}

interface TouchRow extends CameBackRow { id: string; contact_id: string }
interface ContactRow { id: string; do_not_contact: boolean | null; stage: string | null; snooze_until: string | null; ai_takeover_since: string | null }

export interface PickupGuestResult {
  contact_id: string
  rule: PickupRule
  lead_at: string
  /** written / already = marked; would = dry run or over today's cap in a dry run; waiting = over today's cap;
   *  skipped = the guest's follow-up changed since it was read; failed = the write did not take. */
  write: 'written' | 'already' | 'would' | 'waiting' | 'skipped' | 'failed'
}

export interface PickupClientReceipt {
  client_id: string
  enquiries: number
  picked: PickupGuestResult[]
  error: string | null
}

export interface PickupReceipt {
  request_id: string
  checked_at: string
  dry_run: boolean
  no_publish: true
  status: 'ok' | 'partial'
  clients: PickupClientReceipt[]
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

async function inChunks<T>(ids: string[], read: (part: string[]) => Promise<T[]>): Promise<T[]> {
  return (await Promise.all(chunks(ids).map(read))).flat()
}

async function latestEnquiries(sb: SupabaseClient, clientId: string, now: Date): Promise<Map<string, string>> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()
  const rows = await fetchAll<{ contact_id: string; occurred_at: string }>((from, to) =>
    sb.from('contact_touchpoints').select('contact_id, occurred_at').eq('client_id', clientId).eq('direction', 'inbound')
      .in('channel', ENQUIRY_CHANNELS).gte('occurred_at', since).order('id', { ascending: true }).range(from, to),
  )
  const latest = new Map<string, string>()
  for (const r of rows) {
    const cur = latest.get(r.contact_id)
    if (cur === undefined || Date.parse(r.occurred_at) > Date.parse(cur)) latest.set(r.contact_id, r.occurred_at)
  }
  return latest
}

type ContactIdRow = { contact_id: string }

async function loadInputs(sb: SupabaseClient, clientId: string, ids: string[]) {
  const contacts = await inChunks(ids, (part) => fetchAll<ContactRow>((from, to) =>
    sb.from('contacts').select('id, do_not_contact, stage, snooze_until, ai_takeover_since').eq('client_id', clientId)
      .in('id', part).order('id', { ascending: true }).range(from, to)))
  const stages = await fetchAll<{ stage_key: string; marketing_action: string | null; is_terminal: boolean | null }>((from, to) =>
    sb.from('client_pipeline_stages').select('stage_key, marketing_action, is_terminal').eq('client_id', clientId)
      .order('sort_order', { ascending: true }).range(from, to))
  const [events, emails, bookings, touches] = await Promise.all([
    inChunks(ids, (part) => fetchAll<ContactIdRow>((from, to) =>
      sb.from('contact_automation_events').select('contact_id').eq('client_id', clientId).in('contact_id', part)
        .order('id', { ascending: true }).range(from, to))),
    inChunks(ids, (part) => fetchAll<ContactIdRow>((from, to) =>
      sb.from('contact_identities').select('contact_id').eq('client_id', clientId).eq('kind', 'email').in('contact_id', part)
        .order('id', { ascending: true }).range(from, to))),
    inChunks(ids, (part) => fetchAll<ContactIdRow>((from, to) =>
      sb.from('crm_bookings').select('contact_id').eq('client_id', clientId).eq('status', 'active').in('contact_id', part)
        .order('id', { ascending: true }).range(from, to))),
    inChunks(ids, (part) => fetchAll<TouchRow>((from, to) =>
      sb.from('contact_touchpoints').select('id, contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
        .eq('client_id', clientId).in('contact_id', part).order('occurred_at', { ascending: true }).order('id', { ascending: true })
        .range(from, to))),
  ])
  return { contacts, stages, events, emails, bookings, touches, ...(await clientFacts(sb, clientId)) }
}

/** The client's qualified stages (ad strategy config) and the first phone-system call. Unreadable = throw (fail closed). */
async function clientFacts(sb: SupabaseClient, clientId: string): Promise<{ qualifiedKeys: Set<string>; callsTrackedSince: string | null }> {
  const cfg = await sb.from('ad_strategy_configs').select('qualified_stage_keys').eq('client_id', clientId).maybeSingle()
  if (cfg.error) throw new Error(`读不到合格客人阶段设置：${cfg.error.message}`)
  const raw = (cfg.data as { qualified_stage_keys?: unknown } | null)?.qualified_stage_keys
  const qualifiedKeys = new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [])
  // Without the client's qualified stages, high-intent guests cannot be told apart: do not judge this client at all.
  if (qualifiedKeys.size === 0) throw new Error('这个客户还没设「哪些阶段算合格客人」，不判（防止把已报价的客人交给 AI）')
  const first = await sb.from('contact_touchpoints').select('occurred_at').eq('client_id', clientId).eq('channel', 'phone')
    .in('source', [...SYSTEM_CALL_SOURCES]).order('occurred_at', { ascending: true }).limit(1)
  if (first.error) throw new Error(`读不到最早一通电话：${first.error.message}`)
  const row = (first.data ?? [])[0] as { occurred_at: string } | undefined
  return { qualifiedKeys, callsTrackedSince: row?.occurred_at ?? null }
}

type Inputs = Awaited<ReturnType<typeof loadInputs>>

function toStages(rows: Inputs['stages']): EligibilityStage[] {
  return rows.map((s) => ({ stageKey: s.stage_key, marketingAction: s.marketing_action, isTerminal: s.is_terminal }))
}

/** Decide every guest with an enquiry in the window; oldest enquiry first. */
function decideAll(inputs: Inputs, leads: Map<string, string>, now: Date, cfg: PickupConfig) {
  const ids = (rows: ContactIdRow[]) => new Set(rows.map((r) => r.contact_id))
  const withEvents = ids(inputs.events)
  const withEmail = ids(inputs.emails)
  const booked = ids(inputs.bookings)
  const stages = toStages(inputs.stages)
  const touchesOf = new Map<string, TouchRow[]>()
  for (const t of inputs.touches) touchesOf.set(t.contact_id, [...(touchesOf.get(t.contact_id) ?? []), t])
  const out: Array<{ contactId: string; rule: PickupRule; leadAt: string; why: string }> = []
  for (const c of inputs.contacts) {
    const leadAt = leads.get(c.id) ?? null
    if (leadAt === null || c.ai_takeover_since !== null) continue
    const all = touchesOf.get(c.id) ?? []
    const after = all.filter((t) => Date.parse(t.occurred_at) > Date.parse(leadAt))
    const reachedBefore = all.some((t) => t.channel === 'phone' && isSystemCall(t.source) && Date.parse(t.occurred_at) <= Date.parse(leadAt) && callReach(t.metadata) === 'reached')
    const dnc = isDoNotContact(c.do_not_contact === true, all.map((t) => ({
      outcome: typeof t.metadata?.outcome === 'string' ? t.metadata.outcome : null,
      flagged: t.metadata?.do_not_contact === true,
      occurredAt: t.occurred_at,
    })))
    const decision = decideAiPickup({
      now,
      leadAt,
      hasTakeoverHistory: withEvents.has(c.id),
      eligible: judgeEligibility({ doNotContact: dnc, stage: c.stage, snoozeUntil: c.snooze_until }, stages, now).ok,
      hasActiveBooking: booked.has(c.id),
      hasEmail: withEmail.has(c.id),
      qualified: c.stage !== null && inputs.qualifiedKeys.has(c.stage),
      newLeadStage: c.stage === null || c.stage === NEW_LEAD_STAGE,
      callsTrackedSince: inputs.callsTrackedSince,
      reachedBefore,
      inbound: after.filter((t) => t.direction === 'inbound').map(toReengageTouchRow),
      touches: after.map((t) => ({ channel: t.channel, direction: t.direction, source: t.source, occurredAt: t.occurred_at, metadata: t.metadata })),
    }, cfg)
    if (decision !== null) out.push({ contactId: c.id, ...decision })
  }
  return out.sort((a, b) => Date.parse(a.leadAt) - Date.parse(b.leadAt))
}

async function markOne(
  clientId: string,
  p: { contactId: string; rule: PickupRule; leadAt: string; why: string },
  store: TakeoverStoreDeps,
): Promise<PickupGuestResult['write']> {
  // Re-read just before writing: a staff click since the batch read (catalogue sent, 收回人工) decides instead.
  try {
    if ((await store.loadEvents(clientId, p.contactId)).length > 0) return 'skipped'
  } catch {
    return 'failed'
  }
  const res = await recordTakeover(
    {
      clientId,
      contactId: p.contactId,
      kind: 'ai_takeover_on',
      actor: PICKUP_ACTOR,
      reason: p.why,
      catalogVersion: null,
      sourceRef: `pickup:${p.contactId}:${Date.parse(p.leadAt)}:${p.rule}`.slice(0, 200),
    },
    store,
  )
  if (!res.ok || res.since === null) return 'failed'
  return res.inserted ? 'written' : 'already'
}

async function checkClient(
  sb: SupabaseClient,
  clientId: string,
  opts: { now: Date; dryRun: boolean; dailyMax: number; store: TakeoverStoreDeps; cfg: PickupConfig },
): Promise<PickupClientReceipt> {
  try {
    const leads = await latestEnquiries(sb, clientId, opts.now)
    const inputs = await loadInputs(sb, clientId, [...leads.keys()])
    const picks = decideAll(inputs, leads, opts.now, opts.cfg)
    const picked: PickupGuestResult[] = []
    let marked = 0
    for (const p of picks) {
      const base = { contact_id: p.contactId, rule: p.rule, lead_at: p.leadAt }
      if (marked >= opts.dailyMax) {
        picked.push({ ...base, write: 'waiting' })
        continue
      }
      const write = opts.dryRun ? 'would' : await markOne(clientId, p, opts.store)
      if (write === 'would' || write === 'written' || write === 'already') marked++
      picked.push({ ...base, write })
    }
    return { client_id: clientId, enquiries: leads.size, picked, error: null }
  } catch (err) {
    return { client_id: clientId, enquiries: 0, picked: [], error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runAiPickup(
  sb: SupabaseClient,
  opts: { clients: string[]; dryRun: boolean; dailyMax: number; now?: Date; store?: TakeoverStoreDeps; cfg?: PickupConfig },
): Promise<PickupReceipt> {
  const now = opts.now ?? new Date()
  const store = opts.store ?? createTakeoverStore(sb)
  const cfg = opts.cfg ?? DEFAULT_PICKUP_CONFIG
  const clients: PickupClientReceipt[] = []
  for (const clientId of opts.clients) {
    clients.push(await checkClient(sb, clientId, { now, dryRun: opts.dryRun, dailyMax: opts.dailyMax, store, cfg }))
  }
  const bad = clients.some((c) => c.error !== null || c.picked.some((p) => p.write === 'failed'))
  return { request_id: randomUUID(), checked_at: now.toISOString(), dry_run: opts.dryRun, no_publish: true, status: bad ? 'partial' : 'ok', clients }
}
