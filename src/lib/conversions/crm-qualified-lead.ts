/**
 * Record one qualified CRM stage as a Meta lead step, then send it.
 * The stage change itself is already saved by the caller. A failure here
 * must not undo that change. NAL does not call this.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readCapiClientConfig, stageCountsAsQualifiedLead } from './capi-client-config'
import {
  latestMetaLeadId,
  NO_META_LEAD_MESSAGE,
  qualifiedLeadSourceRef,
  redactQualifiedSourceRef,
  stageKeyFromQualifiedRef,
} from './conversion-lead'
import { buildIntakeRow, type IntakeInput } from './intake'

export const CRM_QUALIFIED_LEAD_ACTOR = 'system:crm-qualified-lead'

const SETTLED_SEND = new Set([
  'confirmed',
  'dry_run',
  'failed_permanent',
  'expired_no_send',
  'redacted',
  'in_doubt',
  'sending',
])

export type QualifiedLeadResult = { attempted: boolean; message: string }

type Gate = { stageKey: string; phoneCountry: string | null }
type Row = Record<string, unknown>

export async function recordQualifiedStageLead(
  db: SupabaseClient,
  input: { clientId: string; contactId: string; stageKey: string; actor: string | null },
  now: Date = new Date(),
): Promise<QualifiedLeadResult> {
  const gate = await openGate(db, input)
  if (!gate) return { attempted: false, message: '' }
  const leadId = await readMetaLeadId(db, input.clientId, input.contactId)
  if (!leadId) return { attempted: true, message: NO_META_LEAD_MESSAGE }
  const sourceRef = qualifiedLeadSourceRef(leadId, gate.stageKey)
  const existingId = await existingOutcomeId(db, input.clientId, leadId, gate.stageKey)
  if (existingId) return retryQualified(db, existingId)
  const built = await intakeRow(db, input, { sourceRef, phoneCountry: gate.phoneCountry }, leadId, now)
  if (!built.ok) return { attempted: true, message: built.message }
  const id = await insertLead(db, built.row, input.actor, now)
  if (!id) return { attempted: true, message: '这条合格咨询已经记过了。' }
  return { attempted: true, message: await dispatchQualified(db, id) }
}

async function openGate(
  db: SupabaseClient,
  input: { clientId: string; stageKey: string },
): Promise<Gate | null> {
  const client = await one(db, 'clients', 'leads_config, conversion_stage, default_phone_country', [['id', input.clientId]])
  if (!client || client.conversion_stage !== 'live') return null
  const cfg = readCapiClientConfig(client.leads_config)
  if (!cfg.conversionLeadsEnabled || cfg.qualifiedLeadStageMalformed) return null
  if (!stageCountsAsQualifiedLead(input.stageKey, cfg.qualifiedLeadStageKey)) return null
  const country = client.default_phone_country
  return {
    stageKey: input.stageKey,
    phoneCountry: typeof country === 'string' ? country : null,
  }
}

async function existingOutcomeId(
  db: SupabaseClient,
  clientId: string,
  leadId: string,
  stageKey: string,
): Promise<string | null> {
  const rows = await many(db, 'me_sale_outcomes', 'id, source_ref, meta_lead_id', [
    ['client_id', clientId],
    ['source_kind', 'crm_stage_manual'],
    ['meta_lead_id', leadId],
  ])
  const hit = rows.find((row) => stageKeyFromQualifiedRef(text(row.source_ref)) === stageKey)
  return text(hit?.id)
}

async function retryQualified(db: SupabaseClient, outcomeId: string): Promise<QualifiedLeadResult> {
  const wb = await one(db, 'me_conversion_writebacks', 'status', [
    ['outcome_id', outcomeId],
    ['destination', 'meta_capi'],
    ['event_id', outcomeId],
  ])
  const status = text(wb?.status)
  if (status && SETTLED_SEND.has(status)) {
    return { attempted: true, message: '这条合格咨询已经记过了。' }
  }
  return { attempted: true, message: await dispatchQualified(db, outcomeId) }
}

async function readMetaLeadId(db: SupabaseClient, clientId: string, contactId: string): Promise<string | null> {
  const found = await many(db, 'contact_touchpoints', 'source_ref, occurred_at', [
    ['contact_id', contactId],
    ['client_id', clientId],
    ['source', 'meta_lead_form'],
  ])
  return latestMetaLeadId(found)
}

async function intakeRow(
  db: SupabaseClient,
  input: { clientId: string; contactId: string; actor: string | null },
  gate: { sourceRef: string; phoneCountry: string | null },
  leadId: string,
  now: Date,
): Promise<{ ok: true; row: Row } | { ok: false; message: string }> {
  const contact = await one(db, 'contacts', 'primary_email, primary_phone', [
    ['id', input.contactId],
    ['client_id', input.clientId],
  ])
  const intake: IntakeInput = {
    clientId: input.clientId,
    contactId: input.contactId,
    outcomeKind: 'lead',
    customerEmail: text(contact?.primary_email),
    customerPhone: text(contact?.primary_phone),
    metaLeadId: leadId,
    occurredAt: now.toISOString(),
    sourceKind: 'crm_stage_manual',
    sourceRef: gate.sourceRef,
    createdBy: input.actor,
  }
  const built = buildIntakeRow(intake, { defaultPhoneCountry: gate.phoneCountry, now })
  if (!built.ok) return { ok: false, message: built.errors.join('；') }
  return { ok: true, row: built.row as unknown as Row }
}

async function insertLead(db: SupabaseClient, row: Row, actor: string | null, now: Date): Promise<string | null> {
  const payload = {
    ...row,
    review_status: 'approved',
    reviewed_by: CRM_QUALIFIED_LEAD_ACTOR,
    reviewed_at: now.toISOString(),
  }
  const inserted = await db.from('me_sale_outcomes').insert(payload).select('id').single()
  if (inserted.error) {
    if ((inserted.error as { code?: string }).code === '23505') return null
    throw new Error(inserted.error.message)
  }
  const id = text((inserted.data as { id?: unknown } | null)?.id)
  if (!id) return null
  await writeAudit(db, id, actor, row)
  return id
}

async function writeAudit(db: SupabaseClient, outcomeId: string, actor: string | null, row: Row): Promise<void> {
  try {
    await db.from('me_conversion_audit').insert({
      outcome_id: outcomeId,
      action: 'created',
      actor: actor ?? CRM_QUALIFIED_LEAD_ACTOR,
      detail: { source_kind: 'crm_stage_manual', source_ref: redactQualifiedSourceRef(text(row.source_ref)) },
    })
  } catch {
    // The lead row is the receipt. A missing audit line must not block the send.
  }
}

async function dispatchQualified(db: SupabaseClient, outcomeId: string): Promise<string> {
  try {
    const { sendApprovedOutcome } = await import('./writeback-service')
    const { metaCapiWriter } = await import('@/lib/meta/capi/writer')
    const result = await sendApprovedOutcome(outcomeId, { supabase: db, writer: metaCapiWriter, fetcher: fetch })
    return result.message
  } catch {
    return '记下了，发送没有完成。可以稍后再试，不会另发成普通咨询。'
  }
}

async function one(db: SupabaseClient, table: string, columns: string, filters: Array<[string, string]>): Promise<Row | null> {
  let query = selectFrom(db, table, columns)
  for (const [column, value] of filters) query = query.eq(column, value)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  return isRow(data) ? data : null
}

async function many(db: SupabaseClient, table: string, columns: string, filters: Array<[string, string]>): Promise<Row[]> {
  let query = selectFrom(db, table, columns)
  for (const [column, value] of filters) query = query.eq(column, value)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data.filter(isRow) : []
}

interface FilterQuery extends PromiseLike<{ data: unknown; error: { message: string } | null }> {
  eq(column: string, value: string): FilterQuery
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>
}

function selectFrom(db: SupabaseClient, table: string, columns: string): FilterQuery {
  const from = db.from(table) as unknown as { select(cols: string): FilterQuery }
  return from.select(columns)
}

function isRow(value: unknown): value is Row {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}
