import { describe, expect, it } from 'vitest'
import { AI_STEWARD_RULES_V1 as RULES } from '../config'
import { nextStatus, parseCreateDistributor, parseDecision, parseRefund, parseSale } from '../admin-input'

const ID = '3f2b8c1e-6a4d-4e2f-9b1a-0c5d7e8f9a0b'
const NOW = Date.parse('2026-11-10T12:00:00+13:00')
const PAID = '2026-11-09T10:00:00+13:00'

describe('parseCreateDistributor', () => {
  it('trims and accepts a minimal distributor', () => {
    expect(parseCreateDistributor({ display_name: '  王小明 ' })).toEqual({
      ok: true,
      value: { displayName: '王小明', contactEmail: null, contactPhone: null, parentId: null },
    })
  })

  it('rejects empty names, bad emails and bad upline ids', () => {
    const r = parseCreateDistributor({ display_name: '\u0000 ', contact_email: 'nope', parent_id: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toHaveLength(3)
  })
})

describe('decisions', () => {
  it('only allows the four decisions', () => {
    expect(parseDecision({ decision: 'approve' })).toEqual({ ok: true, value: 'approve' })
    expect(parseDecision({ decision: 'delete' }).ok).toBe(false)
    expect(parseDecision(null).ok).toBe(false)
  })

  it('allows only forward transitions', () => {
    expect(nextStatus('pending', 'approve')).toBe('approved')
    expect(nextStatus('pending', 'reject')).toBe('rejected')
    expect(nextStatus('approved', 'suspend')).toBe('suspended')
    expect(nextStatus('suspended', 'reinstate')).toBe('approved')
    expect(nextStatus('rejected', 'approve')).toBeNull()
    expect(nextStatus('approved', 'approve')).toBeNull()
    expect(nextStatus('pending', 'suspend')).toBeNull()
  })
})

describe('parseSale', () => {
  const plan = { distributor_id: ID, kind: 'plan', plan_code: 'videos-16', months: 2, extra_avatars: 1, order_ref: 'INV-1', paid_at: PAID }

  it('prices a plan sale from the price list', () => {
    const r = parseSale(plan, RULES, NOW)
    expect(r.ok && r.value.listPriceCents).toBe(2 * 79_900 + 10_000)
    expect(r.ok && r.value.amountCents).toBe(169_800)
    expect(r.ok && r.value.paidAt).toBe('2026-11-08T21:00:00.000Z')
  })

  it('accepts a discount but never more than the list price', () => {
    expect(parseSale({ ...plan, amount_cents: 150_000 }, RULES, NOW).ok).toBe(true)
    expect(parseSale({ ...plan, amount_cents: 169_801 }, RULES, NOW).ok).toBe(false)
    expect(parseSale({ ...plan, amount_cents: 0 }, RULES, NOW).ok).toBe(false)
  })

  it('prices an add-on of extra avatars only', () => {
    const r = parseSale({ distributor_id: ID, kind: 'addon', extra_avatars: 3, order_ref: 'INV-2', paid_at: PAID }, RULES, NOW)
    expect(r.ok && r.value.amountCents).toBe(30_000)
    expect(r.ok && r.value.planCode).toBeNull()
    expect(parseSale({ distributor_id: ID, kind: 'addon', extra_avatars: 0, order_ref: 'x', paid_at: PAID }, RULES, NOW).ok).toBe(false)
  })

  it('rejects unknown plans, future dates, timestamps without offset and missing seller', () => {
    expect(parseSale({ ...plan, plan_code: 'videos-999' }, RULES, NOW).ok).toBe(false)
    expect(parseSale({ ...plan, paid_at: '2026-11-11T12:00:00+13:00' }, RULES, NOW).ok).toBe(false)
    expect(parseSale({ ...plan, paid_at: '2026-11-09T10:00:00' }, RULES, NOW).ok).toBe(false)
    expect(parseSale({ ...plan, distributor_id: undefined }, RULES, NOW).ok).toBe(false)
    expect(parseSale({ ...plan, months: 1.5 }, RULES, NOW).ok).toBe(false)
  })
})

describe('parseRefund', () => {
  it('takes a positive amount and requires the original sale', () => {
    expect(parseRefund({ refund_of_sale_id: ID, amount_cents: 79_900, order_ref: 'RF-1', paid_at: PAID }, NOW).ok).toBe(true)
    expect(parseRefund({ refund_of_sale_id: ID, amount_cents: -1, order_ref: 'RF-1', paid_at: PAID }, NOW).ok).toBe(false)
    expect(parseRefund({ amount_cents: 1, order_ref: 'RF-1', paid_at: PAID }, NOW).ok).toBe(false)
  })
})
