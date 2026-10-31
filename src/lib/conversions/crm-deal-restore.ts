/**
 * Re-open a deal that a payment reversal voided, when the same payment is
 * recorded again. The source unique index still covers rejected rows, so a
 * new insert cannot land. This does not touch a live row, a human rejection,
 * or any send that may already have left.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { PAYMENT_VOID_REJECT_NOTE, PAYMENT_VOID_STOP_ERROR } from './crm-deal-void'
import type { DealWrite } from './crm-deal-record'
import type { IntakeRow } from './intake'

export type SourceWriteback = { id: string; status: string; lastError: string | null }

export type SourceDealHit = {
  id: string
  voidedByPaymentReversal: boolean
  stoppedSendIds: string[]
}

type SourceRow = {
  reviewStatus: string
  rejectNote: string | null
  writebacks: SourceWriteback[]
}

/** Send ids to reopen, or null when this row must stay as it is. */
export function voidStoppedSendIds(row: SourceRow): string[] | null {
  if (row.reviewStatus !== 'rejected' || row.rejectNote !== PAYMENT_VOID_REJECT_NOTE) return null
  const ids: string[] = []
  for (const item of row.writebacks) {
    if (item.status === 'failed_permanent' && item.lastError === PAYMENT_VOID_STOP_ERROR) {
      ids.push(item.id)
      continue
    }
    if (item.status === 'queued' && (item.lastError == null || item.lastError === '')) continue
    return null
  }
  return ids
}

export async function readSourceDeal(
  db: SupabaseClient,
  clientId: string,
  sourceKind: string,
  sourceRef: string,
): Promise<SourceDealHit | null> {
  const { data, error } = await db
    .from('me_sale_outcomes')
    .select('id, review_status, reject_note')
    .eq('client_id', clientId)
    .eq('source_kind', sourceKind)
    .eq('source_ref', sourceRef)
    .maybeSingle()
  if (error) throw new Error('crm_deal_read_failed')
  const row = asRow(data)
  const id = str(row?.id)
  if (!row || !id) return null
  const writebacks = await readWritebacks(db, id)
  const stopped = voidStoppedSendIds({
    reviewStatus: str(row.review_status) ?? '',
    rejectNote: str(row.reject_note),
    writebacks,
  })
  if (stopped == null) return { id, voidedByPaymentReversal: false, stoppedSendIds: [] }
  return { id, voidedByPaymentReversal: true, stoppedSendIds: stopped }
}

export async function restoreVoidedDeal(
  db: SupabaseClient,
  id: string,
  row: IntakeRow,
  stoppedSendIds: string[],
  write?: DealWrite,
): Promise<boolean> {
  for (const sendId of stoppedSendIds) {
    if (!(await reopenStoppedSend(db, sendId))) return false
  }
  if (!(await reopenDeal(db, id, row, write))) return false
  await writeRestoreAudit(db, id, row.created_by)
  return true
}

async function reopenStoppedSend(db: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await db
    .from('me_conversion_writebacks')
    .update(reopenPatch())
    .eq('id', id)
    .eq('status', 'failed_permanent')
    .eq('last_error', PAYMENT_VOID_STOP_ERROR)
    .select('id')
  if (error) return false
  if ((data?.length ?? 0) === 1) return true
  const { data: current, error: readError } = await db
    .from('me_conversion_writebacks')
    .select('status, last_error')
    .eq('id', id)
    .maybeSingle()
  if (readError) return false
  const found = asRow(current)
  return found?.status === 'queued' && (found.last_error == null || found.last_error === '')
}

async function reopenDeal(db: SupabaseClient, id: string, row: IntakeRow, write?: DealWrite): Promise<boolean> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('me_sale_outcomes')
    .update({
      contact_id: row.contact_id,
      customer_email: row.customer_email,
      customer_phone: row.customer_phone,
      customer_first: row.customer_first,
      customer_last: row.customer_last,
      order_ref: row.order_ref,
      amount_minor: row.amount_minor,
      currency: row.currency,
      occurred_at: row.occurred_at,
      page_scoped_user_id: row.page_scoped_user_id,
      meta_lead_id: row.meta_lead_id,
      review_status: write ? 'approved' : 'pending_review',
      reviewed_by: write?.reviewedBy ?? null,
      reviewed_at: write?.reviewedAt ?? null,
      reviewed_ip: null,
      reviewed_ua: null,
      review_request_id: null,
      reject_reason: null,
      reject_note: null,
      updated_at: now,
    })
    .eq('id', id)
    .eq('review_status', 'rejected')
    .eq('reject_note', PAYMENT_VOID_REJECT_NOTE)
    .select('id')
  if (error) return false
  return (data?.length ?? 0) === 1
}

async function writeRestoreAudit(db: SupabaseClient, outcomeId: string, actor: string | null): Promise<void> {
  const { error } = await db.from('me_conversion_audit').insert({
    outcome_id: outcomeId,
    action: 'restored',
    actor,
    detail: { from: 'payment_void' },
  })
  if (error) console.info(JSON.stringify({ event: 'crm_deal.audit_failed' }))
}

function reopenPatch(): Record<string, unknown> {
  return {
    status: 'queued',
    last_error: null,
    last_error_code: null,
    payload_preview: null,
    updated_at: new Date().toISOString(),
  }
}

async function readWritebacks(db: SupabaseClient, outcomeId: string): Promise<SourceWriteback[]> {
  const { data, error } = await db
    .from('me_conversion_writebacks')
    .select('id, status, last_error')
    .eq('outcome_id', outcomeId)
  if (error) throw new Error('crm_deal_read_failed')
  const rows = Array.isArray(data) ? data : []
  return rows.map(asRow).filter((row): row is Record<string, unknown> => row != null && typeof row.id === 'string').map((row) => ({
    id: row.id as string,
    status: str(row.status) ?? '',
    lastError: str(row.last_error),
  }))
}

function asRow(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
