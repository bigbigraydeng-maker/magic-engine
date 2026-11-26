import type { CommissionRules } from './types'

export interface OrderSpec {
  planCode: string
  months: number
  /** Avatars beyond the included ones bought in this order (one-time charge). */
  extraAvatars: number
}

export class PricingError extends Error {}

/** List price of an order in cents. Discounts are recorded as the actual paid amount, not here. */
export function priceOrder(spec: OrderSpec, rules: CommissionRules): number {
  if (!Number.isInteger(spec.months) || spec.months < 1) throw new PricingError('months must be a positive integer')
  if (!Number.isInteger(spec.extraAvatars) || spec.extraAvatars < 0) {
    throw new PricingError('extraAvatars must be a non-negative integer')
  }
  const plan = rules.catalog.plans.find((p) => p.code === spec.planCode)
  if (!plan) throw new PricingError(`unknown plan ${spec.planCode}`)
  return plan.monthlyCents * spec.months + spec.extraAvatars * rules.catalog.extraAvatarOneTimeCents
}
