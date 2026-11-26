/**
 * Validation for the distributor admin API (create / decide / record sale / record refund).
 * Pure: returns either a typed value or a list of human-readable errors. No I/O.
 */
import { priceOrder } from './pricing'
import { toMs } from './time'
import type { CommissionRules } from './types'

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FUTURE_TOLERANCE_MS = 5 * 60_000

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\p{C}/gu, '').trim() : ''
}

function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

function optionalUuid(value: unknown, field: string, errors: string[]): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string' && UUID.test(value)) return value.toLowerCase()
  errors.push(`${field} must be a UUID`)
  return null
}

function requiredUuid(value: unknown, field: string, errors: string[]): string {
  const id = optionalUuid(value, field, errors)
  if (id === null && !errors.some((e) => e.startsWith(field))) errors.push(`${field} is required`)
  return id ?? ''
}

function intIn(value: unknown, field: string, min: number, max: number, errors: string[]): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) return value
  errors.push(`${field} must be an integer between ${min} and ${max}`)
  return min
}

export interface CreateDistributorInput {
  displayName: string
  contactEmail: string | null
  contactPhone: string | null
  parentId: string | null
}

export function parseCreateDistributor(body: unknown): Parsed<CreateDistributorInput> {
  const b = asRecord(body)
  const errors: string[] = []
  const displayName = cleanText(b.display_name)
  if (displayName.length < 1 || displayName.length > 200) errors.push('display_name must be 1–200 characters')
  const email = cleanText(b.contact_email)
  if (email && (!EMAIL.test(email) || email.length > 254)) errors.push('contact_email is not a valid email')
  const phone = cleanText(b.contact_phone)
  if (phone.length > 40) errors.push('contact_phone must be at most 40 characters')
  const parentId = optionalUuid(b.parent_id, 'parent_id', errors)
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { displayName, contactEmail: email || null, contactPhone: phone || null, parentId } }
}

export type DistributorStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate'

const TRANSITIONS: Record<Decision, { from: readonly DistributorStatus[]; to: DistributorStatus }> = {
  approve: { from: ['pending'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  suspend: { from: ['approved'], to: 'suspended' },
  reinstate: { from: ['suspended'], to: 'approved' },
}

export function parseDecision(body: unknown): Parsed<Decision> {
  const d = asRecord(body).decision
  if (d === 'approve' || d === 'reject' || d === 'suspend' || d === 'reinstate') return { ok: true, value: d }
  return { ok: false, errors: ['decision must be one of approve, reject, suspend, reinstate'] }
}

/** Target status for a decision, or null if the decision is not allowed from `current`. */
export function nextStatus(current: DistributorStatus, decision: Decision): DistributorStatus | null {
  const t = TRANSITIONS[decision]
  return t.from.includes(current) ? t.to : null
}

function paidAtOf(value: unknown, now: number, errors: string[]): string {
  if (typeof value !== 'string') {
    errors.push('paid_at is required (ISO timestamp with offset)')
    return ''
  }
  try {
    if (toMs(value) > now + FUTURE_TOLERANCE_MS) errors.push('paid_at cannot be in the future')
    return new Date(toMs(value)).toISOString()
  } catch {
    errors.push('paid_at must be an ISO timestamp with an offset, e.g. 2026-11-10T10:00:00+13:00')
    return ''
  }
}

function orderRefOf(value: unknown, errors: string[]): string {
  const ref = cleanText(value)
  if (ref.length < 1 || ref.length > 128) errors.push('order_ref must be 1–128 characters')
  return ref
}

export interface SaleInput {
  distributorId: string
  kind: 'plan' | 'addon'
  planCode: string | null
  months: number | null
  extraAvatars: number
  isSelfPurchase: boolean
  orderRef: string
  paidAt: string
  listPriceCents: number
  amountCents: number
}

/**
 * A plan sale (plan_code + months, optional extra avatars) or an add-on sale (extra avatars only).
 * amount_cents defaults to the list price and may only be lower (discounts), never higher.
 */
export function parseSale(body: unknown, rules: CommissionRules, now: number): Parsed<SaleInput> {
  const b = asRecord(body)
  const errors: string[] = []
  const distributorId = requiredUuid(b.distributor_id, 'distributor_id', errors)
  const kind = b.kind === 'addon' ? 'addon' : b.kind === 'plan' ? 'plan' : null
  if (!kind) errors.push('kind must be plan or addon')
  const extraAvatars = intIn(b.extra_avatars ?? 0, 'extra_avatars', kind === 'addon' ? 1 : 0, 50, errors)
  let planCode: string | null = null
  let months: number | null = null
  if (kind === 'plan') {
    planCode = cleanText(b.plan_code)
    if (!rules.catalog.plans.some((p) => p.code === planCode)) errors.push('plan_code is not in the price list')
    months = intIn(b.months, 'months', 1, 60, errors)
  }
  const orderRef = orderRefOf(b.order_ref, errors)
  const paidAt = paidAtOf(b.paid_at, now, errors)
  if (errors.length || !kind) return { ok: false, errors }
  const listPriceCents = kind === 'plan'
    ? priceOrder({ planCode: planCode as string, months: months as number, extraAvatars }, rules)
    : extraAvatars * rules.catalog.extraAvatarOneTimeCents
  const amountCents = b.amount_cents === undefined || b.amount_cents === null
    ? listPriceCents
    : intIn(b.amount_cents, 'amount_cents', 1, listPriceCents, errors)
  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    value: { distributorId, kind, planCode, months, extraAvatars, isSelfPurchase: b.is_self_purchase === true, orderRef, paidAt, listPriceCents, amountCents },
  }
}

export interface RefundInput {
  refundOfSaleId: string
  /** Positive amount entered by the admin; stored negative. */
  amountCents: number
  orderRef: string
  paidAt: string
}

export function parseRefund(body: unknown, now: number): Parsed<RefundInput> {
  const b = asRecord(body)
  const errors: string[] = []
  const refundOfSaleId = requiredUuid(b.refund_of_sale_id, 'refund_of_sale_id', errors)
  const amountCents = intIn(b.amount_cents, 'amount_cents', 1, 100_000_000, errors)
  const orderRef = orderRefOf(b.order_ref, errors)
  const paidAt = paidAtOf(b.paid_at, now, errors)
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { refundOfSaleId, amountCents, orderRef, paidAt } }
}
