/**
 * Distributor (reseller) commission engine — shared types.
 *
 * All money is integer cents; all rates are basis points (1% = 100 bp).
 * The engine is pure: callers load rows, pass them in, and persist the result.
 * Spec: docs/specs/2026-11-10-distributor-commission-system-v0.1.md
 */

export type DistributorLevel = 'standard' | 'tier1' | 'premier'

export const LEVEL_ORDER: readonly DistributorLevel[] = ['standard', 'tier1', 'premier']

export interface LevelChange {
  level: DistributorLevel
  /** ISO timestamp; the level applies to sales paid at or after this instant. */
  effectiveFrom: string
}

export interface Distributor {
  id: string
  /** Recruiting upline; null for a top-level distributor. */
  parentId: string | null
  /** Must contain at least one entry; sorted or unsorted is fine. */
  levelHistory: readonly LevelChange[]
  /** Suspended distributors earn nothing payable; clawbacks still apply. */
  suspended?: boolean
}

export type SaleKind = 'plan' | 'addon' | 'refund'

export interface Sale {
  id: string
  sellerId: string
  kind: SaleKind
  /** Amount actually paid, excluding tax. Refunds are negative. */
  amountCents: number
  /** ISO 4217; must equal CommissionRules.currency. */
  currency: string
  /** ISO timestamp of payment (or of the refund). */
  paidAt: string
  /** The distributor bought for their own use. */
  isSelfPurchase: boolean
  /** For kind === 'refund': the sale being refunded (claws back at that sale's level). */
  refundOfSaleId?: string
}

export interface TeamRateStep {
  /** Minimum monthly team sales (cents) to reach this rate. */
  minTeamSalesCents: number
  rateBp: number
}

export interface PlanPrice {
  code: string
  videosPerMonth: number
  monthlyCents: number
}

export interface CommissionRules {
  version: string
  currency: string
  /** IANA timezone that defines settlement months. */
  timeZone: string
  retailRateBp: Readonly<Record<DistributorLevel, number>>
  peerRateBp: number
  /** Ascending by minTeamSalesCents. Below the first step the rate is 0. */
  teamRateSteps: readonly TeamRateStep[]
  refundWindowDays: number
  /** Days with zero personal sales after which team commission is withheld. */
  teamInactivityDays: number
  upgrade: {
    tier1SingleSelfPurchaseCents: number
    tier1CumulativeDirectSalesCents: number
    premierMonthlyTeamSalesCents: number
    premierConsecutiveMonths: number
    premierMinDirectTier1: number
  }
  catalog: {
    plans: readonly PlanPrice[]
    includedAvatars: number
    /** One-time charge per avatar beyond includedAvatars. */
    extraAvatarOneTimeCents: number
  }
}

export type CommissionKind = 'retail' | 'peer' | 'team'

export interface CommissionLine {
  distributorId: string
  kind: CommissionKind
  /** Source sale for retail / peer lines and team clawbacks; null for monthly team lines. */
  saleId: string | null
  amountCents: number
  /** False when earned but withheld (e.g. team commission while inactive). */
  payable: boolean
  note: string
}

/** A distributor's team result for one settled month, kept so later refunds claw back correctly. */
export interface TeamMonthEntry {
  rateBp: number
  /** False when that month's team commission was withheld or suspended (so it is never clawed back). */
  paid: boolean
}

/** Where a non-refund sale was settled, and which of its lines were not paid out. */
export interface SettledSaleInfo {
  /** Settlement month (YYYY-MM) of the statement that included the sale. */
  month: string
  /** Keys `${kind}:${distributorId}` of lines for this sale that were recorded but not payable. */
  unpaid: ReadonlySet<string>
}

/** Per-distributor money for one statement. opening/closing are carried debts (≤ 0). */
export interface DistributorBalance {
  openingCents: number
  periodCents: number
  /** Amount to pay out this period (≥ 0). */
  payoutCents: number
  /** Debt carried into the next period (≤ 0). */
  closingCents: number
}
