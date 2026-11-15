/**
 * Catalogue follow-up stop line — read every guest in "AI 跟进中", decide (stop-line.ts), and take the mark off
 * for those that should go back to staff. Runs from the daily Inngest function
 * (inngest/functions/crm-followup-stopline.ts); `dryRun` decides only and writes nothing.
 *
 * The only write is the takeover event log + its mirror column (store.ts recordTakeover), actor
 * `system:followup-stopline`, one event per piece of evidence (source_ref) so a retry or a second run writes nothing
 * new. No email, no stage change, nothing outside the CRM. A guest whose data cannot be read is left as it is and
 * listed in the receipt (never stopped on a guess).
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { isMarketingAction, stageSuppressesWorklist } from '@/lib/crm/pipeline'
import { isDoNotContact } from '@/lib/crm/dnc'
import { toReengageTouchRow, type CameBackRow } from './came-back'
import { createTakeoverStore } from './prod'
import { recordTakeover, type TakeoverStoreDeps } from './store'
import { STOPLINE_ACTOR_ID } from './actions'
import { decideStopLine, type StaffTouch, type StopRule } from './stop-line'

export const STOPLINE_JOB = 'crm-followup-stopline'
export const STOPLINE_ACTOR = STOPLINE_ACTOR_ID
/** Receipt event (business-readable) and manual trigger event. */
export const STOPLINE_EVENT = 'crm.followup_stopline.checked'
export const STOPLINE_EVENT_DUE = 'crm.followup_stopline.due'

const CHUNK = 100

interface GuestRow {
  id: string
  ai_takeover_since: string
  do_not_contact: boolean | null
  stage: string | null
}

interface TouchRow extends CameBackRow {
  id: string
  contact_id: string
}

export interface StoplineGuestResult {
  contact_id: string
  rule: StopRule
  evidence_ref: string
  /** written = event inserted; already = this evidence was already recorded; would = dry run; failed = write failed */
  write: 'written' | 'already' | 'would' | 'failed'
}

export interface StoplineClientReceipt {
  client_id: string
  in_takeover: number
  stopped: StoplineGuestResult[]
  error: string | null
}

export interface StoplineReceipt {
  request_id: string
  checked_at: string
  dry_run: boolean
  /** Nothing leaves the CRM: no email, no stage change. */
  no_publish: true
  status: 'ok' | 'partial' | 'read_failed'
  error: string | null
  clients: StoplineClientReceipt[]
}

async function clientsInTakeover(sb: SupabaseClient): Promise<string[]> {
  const rows = await fetchAll<{ client_id: string; id: string }>((from, to) =>
    sb.from('contacts').select('client_id, id').not('ai_takeover_since', 'is', null).order('id', { ascending: true }).range(from, to),
  )
  return [...new Set(rows.map((r) => r.client_id))].sort()
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

async function loadClientInputs(sb: SupabaseClient, clientId: string) {
  const guests = await fetchAll<GuestRow>((from, to) =>
    sb.from('contacts').select('id, ai_takeover_since, do_not_contact, stage')
      .eq('client_id', clientId).not('ai_takeover_since', 'is', null).order('id', { ascending: true }).range(from, to),
  )
  const stages = await fetchAll<{ stage_key: string; label: string; marketing_action: string; is_terminal: boolean }>((from, to) =>
    sb.from('client_pipeline_stages').select('stage_key, label, marketing_action, is_terminal')
      .eq('client_id', clientId).order('sort_order', { ascending: true }).range(from, to),
  )
  // Timestamps are compared as instants, never as strings (precision differs between rows).
  const minSince = guests.reduce<string | null>((m, g) => (m === null || Date.parse(g.ai_takeover_since) < Date.parse(m) ? g.ai_takeover_since : m), null)
  if (minSince === null) return { guests, stages, touches: [], bookings: [] }
  const ids = guests.map((g) => g.id)
  const touchParts = await Promise.all(chunks(ids).map((part) => fetchAll<TouchRow>((from, to) =>
    sb.from('contact_touchpoints').select('id, contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
      .eq('client_id', clientId).in('contact_id', part).gt('occurred_at', minSince)
      .order('occurred_at', { ascending: true }).order('id', { ascending: true }).range(from, to),
  )))
  const bookingParts = await Promise.all(chunks(ids).map((part) => fetchAll<{ id: string; contact_id: string }>((from, to) =>
    sb.from('crm_bookings').select('id, contact_id').eq('client_id', clientId).eq('status', 'active')
      .in('contact_id', part).order('id', { ascending: true }).range(from, to),
  )))
  return { guests, stages, touches: touchParts.flat(), bookings: bookingParts.flat() }
}

async function checkClient(
  sb: SupabaseClient,
  clientId: string,
  now: Date,
  dryRun: boolean,
  store: TakeoverStoreDeps,
): Promise<StoplineClientReceipt> {
  let inputs: Awaited<ReturnType<typeof loadClientInputs>>
  try {
    inputs = await loadClientInputs(sb, clientId)
  } catch (err) {
    return { client_id: clientId, in_takeover: 0, stopped: [], error: err instanceof Error ? err.message : String(err) }
  }
  const stageOf = new Map(inputs.stages.map((s) => [s.stage_key, s]))
  const touchesOf = new Map<string, TouchRow[]>()
  for (const t of inputs.touches) touchesOf.set(t.contact_id, [...(touchesOf.get(t.contact_id) ?? []), t])
  const bookingOf = new Map(inputs.bookings.map((b) => [b.contact_id, b]))

  const stopped: StoplineGuestResult[] = []
  for (const g of inputs.guests) {
    const sinceMs = Date.parse(g.ai_takeover_since)
    const mine = (touchesOf.get(g.id) ?? []).filter((t) => Date.parse(t.occurred_at) > sinceMs)
    const stageRow = g.stage ? stageOf.get(g.stage) : undefined
    const decision = decideStopLine({
      since: g.ai_takeover_since,
      now,
      hasActiveBooking: bookingOf.get(g.id) ?? null,
      doNotContact: isDoNotContact(g.do_not_contact === true, mine.map((t) => ({
        outcome: typeof t.metadata?.outcome === 'string' ? t.metadata.outcome : null,
        flagged: t.metadata?.do_not_contact === true,
        occurredAt: t.occurred_at,
      }))),
      stage: stageRow
        ? {
            key: stageRow.stage_key,
            label: stageRow.label,
            stopsMarketing: stageSuppressesWorklist(isMarketingAction(stageRow.marketing_action) ? stageRow.marketing_action : 'suppress', stageRow.is_terminal),
          }
        : null,
      inbound: mine.filter((t) => t.direction === 'inbound').map(toReengageTouchRow),
      outboundPhone: mine
        .filter((t) => t.direction === 'outbound' && t.channel === 'phone')
        .map((t): StaffTouch => ({ id: t.id, channel: t.channel, source: t.source, occurredAt: t.occurred_at, metadata: t.metadata })),
    })
    if (decision === null) continue
    const base = { contact_id: g.id, rule: decision.rule, evidence_ref: decision.evidenceRef }
    if (dryRun) {
      stopped.push({ ...base, write: 'would' })
      continue
    }
    const res = await recordTakeover(
      {
        clientId,
        contactId: g.id,
        kind: 'ai_takeover_off',
        actor: STOPLINE_ACTOR,
        reason: decision.why,
        catalogVersion: null,
        sourceRef: `stopline:${g.id}:${decision.evidenceRef}`.slice(0, 200),
      },
      store,
    )
    stopped.push({ ...base, write: !res.ok ? 'failed' : res.inserted ? 'written' : 'already' })
  }
  return { client_id: clientId, in_takeover: inputs.guests.length, stopped, error: null }
}

export async function runStopline(
  sb: SupabaseClient,
  opts: { dryRun: boolean; now?: Date; store?: TakeoverStoreDeps },
): Promise<StoplineReceipt> {
  const now = opts.now ?? new Date()
  const store = opts.store ?? createTakeoverStore(sb)
  const base = { request_id: randomUUID(), checked_at: now.toISOString(), dry_run: opts.dryRun, no_publish: true as const }
  let clientIds: string[]
  try {
    clientIds = await clientsInTakeover(sb)
  } catch (err) {
    return { ...base, status: 'read_failed', error: err instanceof Error ? err.message : String(err), clients: [] }
  }
  const clients: StoplineClientReceipt[] = []
  for (const clientId of clientIds) clients.push(await checkClient(sb, clientId, now, opts.dryRun, store))
  const bad = clients.some((c) => c.error !== null || c.stopped.some((s) => s.write === 'failed'))
  return { ...base, status: bad ? 'partial' : 'ok', error: null, clients }
}
