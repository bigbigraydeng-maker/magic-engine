/**
 * Identity rules are a proposal until `confirmed` is set. Review fixes stay off
 * unless a caller passes the review overlay. Core is invite-only and requires Nexus.
 */
import { MN_TEMPLATE_V12 } from './template'

export type MnIdentity = 'Link' | 'Node' | 'Nexus' | 'Core'

export interface IdentityPolicy {
  version: string
  confirmed: boolean
  linkOnJoin: boolean
  node: {
    cumulativeValidMuCents: number
    minDirects: number
    directsNeedQualifiedNonSelfSale: boolean
    /** Proposal: once reached, Node stays. Review can turn this off and recompute. */
    sticky: boolean
  }
  nexus: {
    teamMuCents: number
    requireNode: boolean
    /** null = a single direct line can qualify the whole upline. Review suggests half the Nexus line. */
    lineCapMuCents: number | null
    retention: 'lifetime' | 'monthly' | 'rolling_quarter'
  }
  core: { inviteOnly: boolean; requiresNexus: boolean }
  /** Review: peer bonus starts the month after the identity is reached. */
  peerStartsNextMonth: boolean
  /**
   * The plan says the retail rate does not fall while valid sales still support it.
   * The "no longer supported" test is not decided, so `true` is rejected rather than guessed.
   */
  retailCanFall: boolean
  annualRecognition: 'unset' | 'full_in_sale_month' | 'monthly_slice' | 'cap_two_units'
  /** null = do not apply the suggested "1 unit per month" self-purchase meter cap. */
  selfPurchaseCapUnitsPerMonth: number | null
  observationDays: number
  minPayoutMuCents: number
  timeZone: string
}

export const PROPOSED_IDENTITY_POLICY: IdentityPolicy = {
  version: 'mn-identity-proposal-v1.2',
  confirmed: false,
  linkOnJoin: true,
  node: {
    cumulativeValidMuCents: 288_000,
    minDirects: 3,
    directsNeedQualifiedNonSelfSale: false,
    sticky: true,
  },
  nexus: {
    teamMuCents: 1_080_000,
    requireNode: false,
    lineCapMuCents: null,
    retention: 'lifetime',
  },
  core: { inviteOnly: true, requiresNexus: true },
  peerStartsNextMonth: false,
  retailCanFall: false,
  annualRecognition: 'unset',
  selfPurchaseCapUnitsPerMonth: null,
  observationDays: 45,
  minPayoutMuCents: 5_000,
  timeZone: 'Pacific/Auckland',
}

/** The stress-test fixes, still unapproved. Spread over the proposal to switch them on together. */
export function withReviewFixes(policy: IdentityPolicy = PROPOSED_IDENTITY_POLICY): IdentityPolicy {
  return {
    ...policy,
    version: `${policy.version}+review-v1.2`,
    node: {
      ...policy.node,
      cumulativeValidMuCents: 287_640,
      directsNeedQualifiedNonSelfSale: true,
      sticky: false,
    },
    nexus: {
      ...policy.nexus,
      requireNode: true,
      lineCapMuCents: Math.floor(policy.nexus.teamMuCents / 2),
      retention: 'rolling_quarter',
    },
    peerStartsNextMonth: true,
  }
}

export const TEMPLATE_VERSION = MN_TEMPLATE_V12.version
