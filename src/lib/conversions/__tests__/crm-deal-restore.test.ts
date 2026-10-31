/**
 * Restoring a voided deal stays on the existing row. The source unique index
 * still covers rejected rows, so a second insert is not available.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PAYMENT_VOID_REJECT_NOTE, PAYMENT_VOID_STOP_ERROR } from '../crm-deal-void'
import { readSourceDeal, restoreVoidedDeal } from '../crm-deal-restore'
import type { IntakeRow } from '../intake'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OUTCOME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type Row = Record<string, unknown>

function row(over: Row = {}): IntakeRow {
  return {
    client_id: CLIENT,
    contact_id: '11111111-1111-4111-8111-111111111111',
    outcome_kind: 'purchase',
    customer_email: 'a@b.test',
    customer_phone: null,
    customer_first: null,
    customer_last: null,
    order_ref: 'booking-1',
    amount_minor: 1000,
    currency: 'NZD',
    occurred_at: '2026-10-08T00:00:00.000Z',
    source_kind: 'crm_stage_manual',
    source_ref: 'crm_deal:contact:booking-1',
    created_by: 'staff@example.com',
    page_scoped_user_id: null,
    meta_lead_id: null,
    ...over,
  } as IntakeRow
}

function fakeDb(seed: { outcomes: Row[]; writebacks: Row[] }) {
  const audits: Row[] = []
  function run(table: string, patch: Row | null, filters: Array<[string, unknown]>, single: boolean) {
    const src = table === 'me_sale_outcomes' ? seed.outcomes : table === 'me_conversion_writebacks' ? seed.writebacks : audits
    let matched = src.filter((item) => filters.every(([col, val]) => item[col] === val))
    if (patch && table !== 'me_conversion_audit') {
      for (const item of matched) Object.assign(item, patch)
    }
    if (patch && table === 'me_conversion_audit') {
      audits.push(patch)
      matched = [patch]
    }
    if (single) return { data: matched[0] ?? null, error: null }
    return { data: matched, error: null }
  }
  function from(table: string) {
    const filters: Array<[string, unknown]> = []
    let patch: Row | null = null
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val])
        return builder
      },
      update: (next: Row) => {
        patch = next
        return builder
      },
      insert: (next: Row) => {
        patch = next
        return builder
      },
      maybeSingle: async () => run(table, patch, filters, true),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(run(table, patch, filters, false))),
    }
    return builder
  }
  return { db: { from } as unknown as SupabaseClient, audits, seed }
}

describe('restoreVoidedDeal', () => {
  it('puts the voided deal back to pending review and reopens only the stopped send', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { db, seed, audits } = fakeDb({
      outcomes: [{
        id: OUTCOME,
        client_id: CLIENT,
        source_kind: 'crm_stage_manual',
        source_ref: 'crm_deal:contact:booking-1',
        review_status: 'rejected',
        reject_note: PAYMENT_VOID_REJECT_NOTE,
        reject_reason: 'not_real_sale',
        amount_minor: 500,
      }],
      writebacks: [{
        id: 'wb-1',
        outcome_id: OUTCOME,
        status: 'failed_permanent',
        last_error: PAYMENT_VOID_STOP_ERROR,
        payload_preview: { paymentRevoked: true },
      }],
    })
    const found = await readSourceDeal(db, CLIENT, 'crm_stage_manual', 'crm_deal:contact:booking-1')
    expect(found).toMatchObject({ id: OUTCOME, voidedByPaymentReversal: true, stoppedSendIds: ['wb-1'] })
    const ok = await restoreVoidedDeal(db, OUTCOME, row(), found?.stoppedSendIds ?? [])
    expect(ok).toBe(true)
    expect(seed.outcomes).toHaveLength(1)
    expect(seed.outcomes[0]).toMatchObject({
      review_status: 'pending_review',
      reject_note: null,
      reject_reason: null,
      amount_minor: 1000,
      currency: 'NZD',
    })
    expect(seed.writebacks[0]).toMatchObject({ status: 'queued', last_error: null, payload_preview: null })
    expect(audits[0]).toMatchObject({ action: 'restored', outcome_id: OUTCOME })
    info.mockRestore()
  })

  it('a live pending row is not a payment reversal', async () => {
    const { db } = fakeDb({
      outcomes: [{
        id: OUTCOME,
        client_id: CLIENT,
        source_kind: 'crm_stage_manual',
        source_ref: 'crm_deal:contact:booking-1',
        review_status: 'pending_review',
        reject_note: null,
      }],
      writebacks: [],
    })
    const found = await readSourceDeal(db, CLIENT, 'crm_stage_manual', 'crm_deal:contact:booking-1')
    expect(found).toMatchObject({ voidedByPaymentReversal: false, stoppedSendIds: [] })
  })

  it('refuses to reopen when the rejection note is not the payment reversal', async () => {
    const { db, seed } = fakeDb({
      outcomes: [{
        id: OUTCOME,
        client_id: CLIENT,
        review_status: 'rejected',
        reject_note: '客人说这不是成交',
        review_status_keep: 'rejected',
      }],
      writebacks: [],
    })
    const ok = await restoreVoidedDeal(db, OUTCOME, row(), [])
    expect(ok).toBe(false)
    expect(seed.outcomes[0].review_status).toBe('rejected')
    expect(seed.outcomes[0].reject_note).toBe('客人说这不是成交')
  })

  it('a payment deal that auto-passes comes back approved, and an already reopened send is left queued', async () => {
    const { db, seed } = fakeDb({
      outcomes: [{
        id: OUTCOME,
        client_id: CLIENT,
        source_kind: 'crm_stage_manual',
        source_ref: 'crm_deal:contact:booking-1',
        review_status: 'rejected',
        reject_note: PAYMENT_VOID_REJECT_NOTE,
      }],
      writebacks: [{
        id: 'wb-1',
        outcome_id: OUTCOME,
        status: 'queued',
        last_error: null,
      }],
    })
    const found = await readSourceDeal(db, CLIENT, 'crm_stage_manual', 'crm_deal:contact:booking-1')
    expect(found).toMatchObject({ voidedByPaymentReversal: true, stoppedSendIds: [] })
    const ok = await restoreVoidedDeal(db, OUTCOME, row(), [], {
      reviewStatus: 'approved',
      reviewedBy: 'system:crm-deal-auto',
      reviewedAt: '2026-10-31T00:00:00.000Z',
      milestoneKind: 'deposit',
    })
    expect(ok).toBe(true)
    expect(seed.outcomes[0]).toMatchObject({
      review_status: 'approved',
      reviewed_by: 'system:crm-deal-auto',
      reject_note: null,
    })
    expect(seed.writebacks[0].status).toBe('queued')
  })
})
