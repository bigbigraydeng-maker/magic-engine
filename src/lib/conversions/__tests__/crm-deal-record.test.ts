import { afterEach, describe, expect, it, vi } from 'vitest'
import { choosePartySize, partySizesInText } from '../crm-deal-party'
import { isPastEventWindow } from '../event-window'
import {
  blockingApprovedPurchase,
  crmDealSourceRef,
  dealOccurredAt,
  recordMilestoneDeal,
  recordStageDeal,
  type ApprovedPurchase,
  type DealIo,
  type DealWrite,
} from '../crm-deal-record'
import type { IntakeRow } from '../intake'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTACT = '11111111-1111-4111-8111-111111111111'
const BOOKING = '30000000-0000-4000-8000-0000000000a1'
const NOW = new Date('2026-10-31T00:00:00.000Z')

type Memory = DealIo & {
  inserted: IntakeRow[]
  writes: Array<DealWrite | undefined>
  sends: string[]
  storedPartyLoads: number
  bookingLoads: number
}

function memory(over: Partial<DealIo> = {}): Memory {
  const inserted: IntakeRow[] = []
  const mem: Memory = {
    inserted,
    writes: [],
    sends: [],
    storedPartyLoads: 0,
    bookingLoads: 0,
    loadClient: async () => ({
      conversionStage: 'live',
      defaultPhoneCountry: '61',
      leadsConfig: { capi_deal_milestone: 'deposit', capi_deal_stage_key: 'won' },
    }),
    loadContact: async () => ({ email: 'a@b.test', phone: '0412345678', doNotContact: false }),
    loadPsid: async () => null,
    loadMetaLeadId: async () => '123456789012345',
    loadBooking: async () => {
      mem.bookingLoads += 1
      return { contactId: CONTACT, partySize: 2, tourId: 'tour', departureId: 'dep' }
    },
    loadPriceTexts: async () => ({ departurePriceText: null, tourPriceText: 'From NZD $4,999 per person' }),
    loadApprovedPurchases: async () => [],
    loadDncTouches: async () => [],
    loadExistingSourceDeal: async () => null,
    restoreVoidedDeal: async () => ({ ok: false }),
    loadStoredPartySize: async () => {
      mem.storedPartyLoads += 1
      return null
    },
    dispatchSend: async (id) => {
      mem.sends.push(id)
      return 'sent'
    },
    insertOutcome: async (row, write) => {
      if (inserted.some((r) => r.source_ref === row.source_ref && r.source_kind === row.source_kind)) {
        return { ok: false, duplicate: true }
      }
      inserted.push(row)
      mem.writes.push(write)
      return { ok: true, id: `out-${inserted.length}` }
    },
    ...over,
  }
  return mem
}

function purchase(over: Partial<ApprovedPurchase> = {}): ApprovedPurchase {
  return {
    sourceKind: 'payment_email',
    occurredAt: '2026-10-20T00:00:00.000Z',
    reviewStatus: 'approved',
    outcomeKind: 'purchase',
    ...over,
  }
}

describe('deal helpers', () => {
  it('keeps the paid-on calendar date and uses the row id as the only event id', () => {
    expect(dealOccurredAt('2026-10-08', NOW)).toBe('2026-10-08T00:00:00.000Z')
    expect(dealOccurredAt(null, NOW)).toBe(NOW.toISOString())
    expect(crmDealSourceRef(CONTACT, BOOKING, 'won')).toBe(`crm_deal:${CONTACT}:${BOOKING}`)
    expect(crmDealSourceRef(CONTACT, null, 'won')).toBe(`crm_deal:${CONTACT}:stage:won`)
  })

  it('blocks another source at the 30-day boundary and ignores same-source, pending, and older rows', () => {
    const since = NOW.getTime() - 30 * 24 * 60 * 60 * 1000
    expect(blockingApprovedPurchase([purchase({ occurredAt: new Date(since).toISOString() })], NOW)?.sourceKind).toBe('payment_email')
    expect(blockingApprovedPurchase([purchase({ occurredAt: new Date(since - 1).toISOString() })], NOW)).toBeNull()
    expect(blockingApprovedPurchase([purchase({ sourceKind: 'crm_stage_manual' })], NOW)).toBeNull()
    expect(blockingApprovedPurchase([purchase({ reviewStatus: 'pending_review' })], NOW)).toBeNull()
    expect(blockingApprovedPurchase([purchase({ reviewStatus: 'rejected' })], NOW)).toBeNull()
  })
})

describe('recordMilestoneDeal', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  afterEach(() => info.mockClear())

  it('writes one pending purchase from the starting price and returns that row id', async () => {
    const io = memory()
    const result = await recordMilestoneDeal(io, {
      clientId: CLIENT,
      bookingId: BOOKING,
      kind: 'deposit',
      paidOn: '2026-10-08',
      actor: 'staff@example.com',
    }, NOW)
    expect(result).toMatchObject({ attempted: true, recorded: true, outcomeId: 'out-1', advanceStage: false })
    expect(result.message).toContain('已自动通过')
    expect(result.message).toContain('已发给广告平台')
    expect(result.message).not.toContain('等审核')
    expect(io.writes[0]).toMatchObject({ reviewStatus: 'approved', reviewedBy: 'system:crm-deal-auto', milestoneKind: 'deposit' })
    expect(io.sends).toEqual(['out-1'])
    expect(io.storedPartyLoads).toBe(0)
    expect(io.inserted).toHaveLength(1)
    expect(io.inserted[0]).toMatchObject({
      outcome_kind: 'purchase',
      amount_minor: 999800,
      currency: 'NZD',
      source_kind: 'crm_stage_manual',
      source_ref: `crm_deal:${CONTACT}:${BOOKING}`,
      order_ref: BOOKING,
      meta_lead_id: '123456789012345',
      occurred_at: '2026-10-08T00:00:00.000Z',
      customer_phone: '61412345678',
    })
    expect(io.inserted[0]).not.toHaveProperty('review_status')
  })

  it('does not query the booking when the milestone is not configured', async () => {
    const io = memory({ loadClient: async () => ({ conversionStage: 'live', defaultPhoneCountry: null, leadsConfig: {} }) })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: null, actor: null }, NOW)
    expect(result.attempted).toBe(false)
    expect(io.bookingLoads).toBe(0)
    expect(io.inserted).toHaveLength(0)
  })

  it('a malformed milestone is not a deal', async () => {
    const io = memory({
      loadClient: async () => ({ conversionStage: 'live', defaultPhoneCountry: null, leadsConfig: { capi_deal_milestone: 'won' } }),
    })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: null, actor: null }, NOW)
    expect(result).toMatchObject({ attempted: false })
    expect(io.inserted).toHaveLength(0)
  })

  it('skips a client that is not live', async () => {
    const io = memory({
      loadClient: async () => ({ conversionStage: 'dry_run', defaultPhoneCountry: null, leadsConfig: { capi_deal_milestone: 'deposit' } }),
    })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: null, actor: null }, NOW)
    expect(result).toMatchObject({ attempted: true, recorded: false, reason: 'not_live' })
    expect(io.inserted).toHaveLength(0)
  })

  it('does not auto-send when the only stored headcount splits adults and children', async () => {
    const io = memory({
      loadBooking: async () => ({ contactId: CONTACT, partySize: null, tourId: 'tour', departureId: null }),
      loadStoredPartySize: async () => choosePartySize(null, [partySizesInText('2 adults and 1 child')]),
    })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(result).toMatchObject({ recorded: false, reason: 'missing_party_size' })
    expect(io.inserted).toHaveLength(0)
    expect(io.sends).toEqual([])
  })

  it('does not insert when party size is missing, and does not fall back to a typed amount', async () => {
    const io = memory({
      loadBooking: async () => ({ contactId: CONTACT, partySize: null, tourId: 'tour', departureId: null }),
    })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(result).toMatchObject({ attempted: true, recorded: false, reason: 'missing_party_size' })
    expect(io.inserted).toHaveLength(0)
  })

  it('does not insert without a match key', async () => {
    const io = memory({
      loadContact: async () => ({ email: null, phone: null, doNotContact: false }),
      loadPsid: async () => null,
    })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(result).toMatchObject({ recorded: false, reason: 'no_match_key', advanceStage: false })
    expect(io.inserted).toHaveLength(0)
  })

  it('skips when another source already has an approved purchase, without logging ids', async () => {
    const io = memory({ loadApprovedPurchases: async () => [purchase()] })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(result).toMatchObject({ recorded: false, reason: 'recent_other_source' })
    expect(io.inserted).toHaveLength(0)
    const line = info.mock.calls.map((c) => String(c[0])).join('\n')
    expect(line).toContain('"reason":"recent_other_source"')
    expect(line).toContain('"otherSource":"payment_email"')
    expect(line).not.toContain(CLIENT)
    expect(line).not.toContain(CONTACT)
    expect(line).not.toContain('@')
  })

  it('a repeated booking is already recorded, not a second insert', async () => {
    const io = memory()
    await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    const again = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(again).toMatchObject({ alreadyRecorded: true, recorded: false })
    expect(io.inserted).toHaveLength(1)
  })

  it('reopens a deal voided by a payment reversal instead of treating the clash as already recorded', async () => {
    const restored: string[] = []
    const io = memory({
      insertOutcome: async () => ({ ok: false, duplicate: true }),
      loadExistingSourceDeal: async () => ({ id: 'voided-1', voidedByPaymentReversal: true, stoppedSendIds: ['wb-1'] }),
      restoreVoidedDeal: async (id, _row, ids, write) => {
        restored.push(id, ...ids)
        expect(write).toMatchObject({ reviewStatus: 'approved', reviewedBy: 'system:crm-deal-auto', milestoneKind: 'deposit' })
        return { ok: true }
      },
    })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(result).toMatchObject({ recorded: true, alreadyRecorded: false, outcomeId: 'voided-1', reason: null, advanceStage: false })
    expect(result.message).toContain('重新打开')
    expect(result.message).toContain('已自动通过')
    expect(result.message).not.toContain('等审核')
    expect(restored).toEqual(['voided-1', 'wb-1'])
    expect(io.sends).toEqual(['voided-1'])
  })

  it('does not reopen a rejection that was not caused by undoing the payment', async () => {
    let calls = 0
    const io = memory({
      insertOutcome: async () => ({ ok: false, duplicate: true }),
      loadExistingSourceDeal: async () => ({ id: 'human-rej', voidedByPaymentReversal: false, stoppedSendIds: [] }),
      restoreVoidedDeal: async () => {
        calls += 1
        return { ok: true }
      },
    })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(result).toMatchObject({ alreadyRecorded: true, recorded: false })
    expect(calls).toBe(0)
  })

  it('a failed reopen is not reported as already recorded', async () => {
    const io = memory({
      insertOutcome: async () => ({ ok: false, duplicate: true }),
      loadExistingSourceDeal: async () => ({ id: 'voided-1', voidedByPaymentReversal: true, stoppedSendIds: ['wb-1'] }),
      restoreVoidedDeal: async () => ({ ok: false }),
    })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(result).toMatchObject({ recorded: false, alreadyRecorded: false, reason: 'record_failed' })
  })

  it('uses the stored paid date, so an old payment stays outside the send window', async () => {
    const io = memory({
      loadBooking: async () => ({
        contactId: CONTACT,
        partySize: 2,
        tourId: 'tour',
        departureId: 'dep',
        paidOnByKind: { deposit: '2026-09-01' },
      }),
    })
    const result = await recordMilestoneDeal(io, {
      clientId: CLIENT,
      bookingId: BOOKING,
      kind: 'deposit',
      paidOn: '2026-10-31',
      actor: null,
    }, NOW)
    expect(result.recorded).toBe(true)
    expect(io.inserted[0]?.occurred_at).toBe('2026-09-01T00:00:00.000Z')
    expect(isPastEventWindow(io.inserted[0]?.occurred_at ?? '', NOW)).toBe(true)
  })

  it('refuses when the milestone rows were read and this kind has no paid date', async () => {
    const io = memory({
      loadBooking: async () => ({
        contactId: CONTACT,
        partySize: 2,
        tourId: 'tour',
        departureId: 'dep',
        paidOnByKind: {},
      }),
    })
    const result = await recordMilestoneDeal(io, {
      clientId: CLIENT,
      bookingId: BOOKING,
      kind: 'deposit',
      paidOn: '2026-10-31',
      actor: null,
    }, NOW)
    expect(result).toMatchObject({ recorded: false, reason: 'paid_on_missing' })
    expect(io.inserted).toHaveLength(0)
  })

  it('an insert error does not pretend the deal was stored', async () => {
    const io = memory({ insertOutcome: async () => ({ ok: false, duplicate: false }) })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(result).toMatchObject({ recorded: false, reason: 'record_failed', advanceStage: false })
    expect(io.sends).toEqual([])
  })

  it('reads one stored headcount when the booking has none, and does not treat a send error as a lost row', async () => {
    const io = memory({
      loadBooking: async () => ({ contactId: CONTACT, partySize: null, tourId: 'tour', departureId: null }),
      loadStoredPartySize: async () => {
        io.storedPartyLoads += 1
        return 3
      },
      dispatchSend: async () => {
        throw new Error('platform down')
      },
    })
    const result = await recordMilestoneDeal(io, { clientId: CLIENT, bookingId: BOOKING, kind: 'deposit', paidOn: '2026-10-08', actor: null }, NOW)
    expect(result).toMatchObject({ recorded: true, reason: null, outcomeId: 'out-1' })
    expect(result.message).toContain('没成功')
    expect(result.message).toContain('往来或跟进记录')
    expect(io.inserted[0]?.amount_minor).toBe(1_499_700)
    expect(io.storedPartyLoads).toBe(1)
  })
})

describe('recordStageDeal', () => {
  it('refuses when the booking belongs to a different contact', async () => {
    const other = '22222222-2222-4222-8222-222222222222'
    const io = memory({
      loadBooking: async () => ({ contactId: other, partySize: 2, tourId: 'tour', departureId: 'dep' }),
    })
    const result = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: BOOKING,
      occurredAt: null, actor: null, staffAmount: null, staffCurrency: null,
    }, NOW)
    expect(result).toMatchObject({
      attempted: true,
      recorded: false,
      advanceStage: false,
      reason: 'contact_mismatch',
    })
    expect(result.message).toContain('不是同一人')
    expect(io.inserted).toHaveLength(0)
    expect(io.inserted.some((row) => row.contact_id === other)).toBe(false)
  })

  it('does not advance when the stage is not the configured deal stage', async () => {
    const io = memory()
    const result = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'quoted', bookingId: null,
      occurredAt: null, actor: null, staffAmount: '10', staffCurrency: 'NZD',
    }, NOW)
    expect(result).toMatchObject({ attempted: false, advanceStage: false })
    expect(io.inserted).toHaveLength(0)
  })

  it('a non-live client advances the stage and does not insert', async () => {
    const io = memory({
      loadClient: async () => ({ conversionStage: 'dry_run', defaultPhoneCountry: null, leadsConfig: { capi_deal_stage_key: 'won' } }),
    })
    const result = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: null,
      occurredAt: null, actor: null, staffAmount: '10', staffCurrency: 'NZD',
    }, NOW)
    expect(result).toMatchObject({ attempted: true, recorded: false, reason: 'not_live', advanceStage: true })
    expect(io.inserted).toHaveLength(0)
  })

  it('missing party size does not fall back to the typed amount and does not advance', async () => {
    const io = memory({
      loadBooking: async () => ({ contactId: CONTACT, partySize: null, tourId: 'tour', departureId: null }),
    })
    const result = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: BOOKING,
      occurredAt: '2026-10-08', actor: null, staffAmount: '500', staffCurrency: 'NZD',
    }, NOW)
    expect(result).toMatchObject({ reason: 'missing_party_size', advanceStage: false, recorded: false })
    expect(io.inserted).toHaveLength(0)
    expect(io.storedPartyLoads).toBe(0)
  })

  it('uses a typed amount only when the party size is present and the catalog has no price', async () => {
    const io = memory({
      loadPriceTexts: async () => ({ departurePriceText: null, tourPriceText: null }),
    })
    const result = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: BOOKING,
      occurredAt: '2026-10-08', actor: null, staffAmount: '80', staffCurrency: 'AUD',
    }, NOW)
    expect(result.recorded).toBe(true)
    expect(io.inserted[0]).toMatchObject({ amount_minor: 8000, currency: 'AUD' })
    expect(result.advanceStage).toBe(true)
    expect(result.message).toContain('审核')
    expect(io.sends).toEqual([])
    expect(io.writes[0]).toBeUndefined()
    expect(io.storedPartyLoads).toBe(0)
  })

  it('a cross-source duplicate advances and does not insert again', async () => {
    const io = memory({ loadApprovedPurchases: async () => [purchase()] })
    const result = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: BOOKING,
      occurredAt: null, actor: null, staffAmount: null, staffCurrency: null,
    }, NOW)
    expect(result).toMatchObject({ reason: 'recent_other_source', advanceStage: true, recorded: false })
    expect(io.inserted).toHaveLength(0)
  })

  it('a duplicate source ref still advances', async () => {
    const io = memory()
    await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: BOOKING,
      occurredAt: null, actor: null, staffAmount: null, staffCurrency: null,
    }, NOW)
    const again = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: BOOKING,
      occurredAt: null, actor: null, staffAmount: null, staffCurrency: null,
    }, NOW)
    expect(again).toMatchObject({ alreadyRecorded: true, advanceStage: true })
    expect(io.inserted).toHaveLength(1)
  })

  it('no match key does not advance', async () => {
    const io = memory({
      loadContact: async () => ({ email: null, phone: null, doNotContact: false }),
      loadPsid: async () => null,
    })
    const result = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: null,
      occurredAt: null, actor: null, staffAmount: '10', staffCurrency: 'NZD',
    }, NOW)
    expect(result).toMatchObject({ reason: 'no_match_key', advanceStage: false })
  })

  it('insert error does not advance', async () => {
    const io = memory({ insertOutcome: async () => ({ ok: false, duplicate: false }) })
    const result = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: null,
      occurredAt: null, actor: null, staffAmount: '10', staffCurrency: 'NZD',
    }, NOW)
    expect(result).toMatchObject({ reason: 'record_failed', advanceStage: false })
  })

  it('warns when the contact is do-not-contact but still records', async () => {
    const io = memory({
      loadContact: async () => ({ email: 'a@b.test', phone: null, doNotContact: true }),
    })
    const result = await recordStageDeal(io, {
      clientId: CLIENT, contactId: CONTACT, stageKey: 'won', bookingId: null,
      occurredAt: null, actor: null, staffAmount: '10', staffCurrency: 'NZD',
    }, NOW)
    expect(result.recorded).toBe(true)
    expect(result.doNotContact).toBe(true)
    expect(result.message).toContain('拒联')
  })
})
