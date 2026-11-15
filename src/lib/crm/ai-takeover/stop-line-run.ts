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
import { takeoverState } from './state'
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
  /**
   * written = event inserted and the guest is off; already = this evidence was recorded before and the guest is off;
   * would = dry run; skipped = the guest's follow-up changed since it was read (left alone, checked again tomorrow);
   * failed = the write failed or the guest is still in follow-up after it.
   */
  write: 'written' | 'already' | 'would' | 'skipped' | 'failed'
}

export interface StoplineClientReceipt {
  client_id: string
  in_takeover: number
  stopped: StoplineGuestResult[]
  /** Guests whose stage key is not in the client's stage list: checked without the stage rule, listed for a human. */
  unknown_stage: string[]
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
  if (guests.length === 0) return { guests, stages, touches: [], bookings: [] }
  const ids = guests.map((g) => g.id)
  // The whole history of these guests, not only after takeover-on: the do-not-contact verdict needs older
  // corrections (dnc_cleared) to outrank a stale contacts.do_not_contact flag.
  const touchParts = await Promise.all(chunks(ids).map((part) => fetchAll<TouchRow>((from, to) =>
    sb.from('contact_touchpoints').select('id, contact_id, channel, direction, occurred_at, summary, raw, metadata, source')
      .eq('client_id', clientId).in('contact_id', part)
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
    return { client_id: clientId, in_takeover: 0, stopped: [], unknown_stage: [], error: err instanceof Error ? err.message : String(err) }
  }
  const stageOf = new Map(inputs.stages.map((s) => [s.stage_key, s]))
  const touchesOf = new Map<string, TouchRow[]>()
  for (const t of inputs.touches) touchesOf.set(t.contact_id, [...(touchesOf.get(t.contact_id) ?? []), t])
  const bookingOf = new Map(inputs.bookings.map((b) => [b.contact_id, b]))

  const stopped: StoplineGuestResult[] = []
  const unknownStage: string[] = []
  for (const g of inputs.guests) {
    // Timestamps are compared as instants, never as strings (precision differs between rows).
    const sinceMs = Date.parse(g.ai_takeover_since)
    const all = touchesOf.get(g.id) ?? []
    const mine = all.filter((t) => Date.parse(t.occurred_at) > sinceMs)
    const stageRow = g.stage ? stageOf.get(g.stage) : undefined
    if (g.stage && stageRow === undefined) unknownStage.push(g.id)
    const decision = decideStopLine({
      since: g.ai_takeover_since,
      now,
      hasActiveBooking: bookingOf.get(g.id) ?? null,
      doNotContact: isDoNotContact(g.do_not_contact === true, all.map((t) => ({
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
    // Re-read just before writing: a staff click (收回人工, or a new catalogue) since the batch read means this
    // evidence belongs to an old round of follow-up. Leave the guest alone; tomorrow's run sees the new state.
    try {
      const current = takeoverState(await store.loadEvents(clientId, g.id))
      if (!current.on || Date.parse(current.since) !== sinceMs) {
        stopped.push({ ...base, write: 'skipped' })
        continue
      }
    } catch {
      stopped.push({ ...base, write: 'failed' })
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
        // The takeover-on instant is part of the key: the same fact (stage, do-not-contact) in a later round of
        // follow-up is a new stop, not a duplicate of the old one.
        sourceRef: `stopline:${g.id}:${sinceMs}:${decision.evidenceRef}`.slice(0, 200),
      },
      store,
    )
    // A write that leaves the guest in follow-up did not do its job: report it, never as success.
    const write = !res.ok || res.since !== null ? 'failed' : res.inserted ? 'written' : 'already'
    stopped.push({ ...base, write })
  }
  return { client_id: clientId, in_takeover: inputs.guests.length, stopped, unknown_stage: unknownStage, error: null }
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
