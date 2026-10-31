import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dealBelongsToUnmarkedKind, milestoneStampFromAudits, PAYMENT_VOID_REJECT_NOTE, PAYMENT_VOID_STOP_ERROR, planDealVoid, selectDealsForUnmark, voidDealAfterUnpaid, voidDealMessage, type DealVoidRow } from '../crm-deal-void'
import { voidStoppedSendIds } from '../crm-deal-restore'

function row(status: string, writebacks: Array<{ id: string; status: string }> = []): DealVoidRow {
  return {
    id: 'outcome-1',
    reviewStatus: status,
    writebacks: writebacks.map((item) => ({ ...item, payloadPreview: null })),
  }
}

describe('planDealVoid', () => {
  it('voids a queued deal and stops its send row', () => {
    const plan = planDealVoid([row('pending_review', [{ id: 'wb-1', status: 'queued' }])])
    expect(plan.voidIds).toEqual(['outcome-1'])
    expect(plan.stopIds).toEqual(['wb-1'])
    expect(plan.flagIds).toEqual([])
    expect(voidDealMessage(plan)).toContain('已作废')
    expect(voidDealMessage(plan)).not.toContain('已经发给')
  })

  it('stops a queued companion when the original send already went out, and does not void the deal', () => {
    const plan = planDealVoid([row('approved', [
      { id: 'wb-primary', status: 'confirmed' },
      { id: 'wb-stage', status: 'queued' },
    ])])
    expect(plan.voidIds).toEqual([])
    expect(plan.stopIds).toEqual(['wb-stage'])
    expect(plan.flagIds).toEqual(['wb-primary'])
    expect(plan.confirmed).toBe(true)
  })

  it('leaves a confirmed send and does not void the deal', () => {
    const plan = planDealVoid([row('approved', [{ id: 'wb-1', status: 'confirmed' }])])
    expect(plan.voidIds).toEqual([])
    expect(plan.stopIds).toEqual([])
    expect(plan.confirmed).toBe(true)
    expect(voidDealMessage(plan)).toContain('已经发给广告平台')
    expect(voidDealMessage(plan)).toContain('撤不回来')
  })

  it('only a payment-voided rejection with its stopped send can be reopened', () => {
    const stopped = [{ id: 'wb-1', status: 'failed_permanent', lastError: PAYMENT_VOID_STOP_ERROR }]
    expect(voidStoppedSendIds({
      reviewStatus: 'rejected',
      rejectNote: PAYMENT_VOID_REJECT_NOTE,
      writebacks: stopped,
    })).toEqual(['wb-1'])
    expect(voidStoppedSendIds({
      reviewStatus: 'rejected',
      rejectNote: PAYMENT_VOID_REJECT_NOTE,
      writebacks: [],
    })).toEqual([])
    expect(voidStoppedSendIds({
      reviewStatus: 'pending_review',
      rejectNote: null,
      writebacks: [],
    })).toBeNull()
    expect(voidStoppedSendIds({
      reviewStatus: 'rejected',
      rejectNote: '客人说这不是成交',
      writebacks: stopped,
    })).toBeNull()
    expect(voidStoppedSendIds({
      reviewStatus: 'rejected',
      rejectNote: PAYMENT_VOID_REJECT_NOTE,
      writebacks: [{ id: 'wb-2', status: 'confirmed', lastError: null }],
    })).toBeNull()
    expect(voidStoppedSendIds({
      reviewStatus: 'rejected',
      rejectNote: PAYMENT_VOID_REJECT_NOTE,
      writebacks: [{ id: 'wb-3', status: 'failed_permanent', lastError: '别的原因' }],
    })).toBeNull()
    expect(voidStoppedSendIds({
      reviewStatus: 'rejected',
      rejectNote: PAYMENT_VOID_REJECT_NOTE,
      writebacks: [{ id: 'wb-4', status: 'queued', lastError: null }],
    })).toEqual([])
    expect(voidStoppedSendIds({
      reviewStatus: 'rejected',
      rejectNote: PAYMENT_VOID_REJECT_NOTE,
      writebacks: [{ id: 'wb-5', status: 'queued', lastError: '还停着' }],
    })).toBeNull()
  })

  it('a creation stamp follows the payment that was unmarked, not today\'s setting', () => {
    expect(dealBelongsToUnmarkedKind('deposit', 'deposit', 'balance')).toBe('void')
    expect(dealBelongsToUnmarkedKind('deposit', 'balance', 'deposit')).toBe('skip')
    expect(dealBelongsToUnmarkedKind(null, 'deposit', 'deposit')).toBe('void')
    expect(dealBelongsToUnmarkedKind(null, 'deposit', 'balance')).toBe('skip')
    expect(dealBelongsToUnmarkedKind(null, 'deposit', 'malformed')).toBe('void_failed')
    expect(selectDealsForUnmark(
      [{ id: 'stamped', stamp: 'deposit' }, { id: 'old', stamp: null }],
      'deposit',
      'malformed',
    )).toEqual({ ids: ['stamped'], failed: true })
  })

  it('a later restore stamp replaces the payment the deal was created on', () => {
    const created = { action: 'created', detail: { milestone: 'deposit' }, at: '2026-10-01T00:00:00.000Z' }
    const restored = { action: 'restored', detail: { from: 'payment_void', milestone: 'balance' }, at: '2026-10-02T00:00:00.000Z' }
    expect(milestoneStampFromAudits([restored, created])).toBe('balance')
    expect(milestoneStampFromAudits([
      created,
      { action: 'restored', detail: { from: 'payment_void' }, at: '2026-10-03T00:00:00.000Z' },
    ])).toBe('deposit')
  })

  it('voids an unsent restored deal by the payment named on restore', async () => {
    const seed = restoredDeal('balance')
    const notice = await voidDealAfterUnpaid(fakeVoidDb(seed), {
      clientId: CLIENT,
      bookingId: BOOKING,
      kind: 'balance',
      actor: null,
    })
    expect(notice?.reason).toBe('voided')
    expect(seed.me_sale_outcomes[0].review_status).toBe('rejected')
    const skipped = restoredDeal('balance')
    const other = await voidDealAfterUnpaid(fakeVoidDb(skipped), {
      clientId: CLIENT,
      bookingId: BOOKING,
      kind: 'deposit',
      actor: null,
    })
    expect(other).toBeNull()
    expect(skipped.me_sale_outcomes[0].review_status).toBe('approved')
  })

  it('leaves an in-doubt send without calling it already delivered', () => {
    const plan = planDealVoid([row('approved', [{ id: 'wb-1', status: 'in_doubt' }])])
    expect(plan.voidIds).toEqual([])
    expect(plan.maybeSent).toBe(true)
    expect(voidDealMessage(plan)).toContain('可能已经发给')
    expect(voidDealMessage(plan)).not.toContain('已经发给广告平台的成交留着')
  })
})

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTACT = '11111111-1111-4111-8111-111111111111'
const BOOKING = '22222222-2222-4222-8222-222222222222'
const OUTCOME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

type VoidRow = Record<string, unknown>

function restoredDeal(restoredKind: 'deposit' | 'balance'): Record<string, VoidRow[]> {
  return {
    crm_bookings: [{ id: BOOKING, client_id: CLIENT, contact_id: CONTACT }],
    clients: [{ id: CLIENT, leads_config: { capi_deal_milestone: 'deposit' } }],
    me_sale_outcomes: [{
      id: OUTCOME,
      client_id: CLIENT,
      source_kind: 'crm_stage_manual',
      source_ref: `crm_deal:${CONTACT}:${BOOKING}`,
      review_status: 'approved',
    }],
    me_conversion_writebacks: [{ id: 'wb-1', outcome_id: OUTCOME, status: 'queued', payload_preview: null }],
    me_conversion_audit: [
      { outcome_id: OUTCOME, action: 'restored', detail: { from: 'payment_void', milestone: restoredKind }, at: '2026-10-02T00:00:00.000Z' },
      { outcome_id: OUTCOME, action: 'created', detail: { milestone: 'deposit', source_kind: 'crm_stage_manual' }, at: '2026-10-01T00:00:00.000Z' },
    ],
  }
}

function fakeVoidDb(seed: Record<string, VoidRow[]>): SupabaseClient {
  const tableOf = (name: string): VoidRow[] => seed[name] ?? []
  function from(table: string) {
    const filters: Array<(item: VoidRow) => boolean> = []
    let patch: VoidRow | null = null
    let orderCol: string | null = null
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push((item) => item[col] === val)
        return builder
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((item) => vals.includes(item[col]))
        return builder
      },
      order: (col: string) => {
        orderCol = col
        return builder
      },
      update: (next: VoidRow) => {
        patch = next
        return builder
      },
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: matched(), error: null })),
    }
    function matched(): VoidRow[] {
      let rows = tableOf(table).filter((item) => filters.every((keep) => keep(item)))
      if (patch) {
        for (const item of rows) Object.assign(item, patch)
      }
      if (orderCol) {
        const col = orderCol
        rows = [...rows].sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')))
      }
      return rows
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}
