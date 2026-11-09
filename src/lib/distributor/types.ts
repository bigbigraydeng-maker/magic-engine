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
}

export type SaleKind = 'plan' | 'addon' | 'refund'

export interface Sale {
  id: string
  sellerId: string
  kind: SaleKind
  /** Amount actually paid, excluding tax. Refunds are negative. */
  amountCents: number
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
  /** Source sale for retail / peer lines; null for team lines. */
  saleId: string | null
  amountCents: number
  /** False when earned but withheld (e.g. team commission while inactive). */
  payable: boolean
  note: string
}
