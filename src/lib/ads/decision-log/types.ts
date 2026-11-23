/**
 * Structured ads decision record (`ads_decision_v1`) stored in flywheel_actions.payload.
 */

export const ADS_DECISION_SCHEMA_VERSION = 'ads_decision_v1' as const

export type AdsDecisionStatus = 'active' | 'pending_confirm' | 'superseded'

export type AdsDecisionReviewVerdict = 'met' | 'not_met' | 'cant_tell'

export interface AdsDecisionSubject {
  readonly level: 'campaign' | 'adset' | 'ad' | 'account'
  readonly ref: string
  readonly label_zh: string
}

export interface AdsDecisionActor {
  readonly kind: 'human' | 'agent_draft' | 'card_execution'
  readonly label: string
}

export interface AdsDecisionExpectationItem {
  readonly metric: string
  readonly target: string
  readonly horizon_days: number
  readonly scope?: string
  readonly consecutive_days?: number
  readonly entity_refs?: readonly string[]
}

export interface AdsDecisionExpectation {
  readonly items: readonly AdsDecisionExpectationItem[]
  readonly notes_zh?: string
}

export interface AdsDecisionEvidence {
  readonly cpl_ratio_to_target?: number
  readonly ctr_vs_day1_pct?: number
  readonly note_zh?: string
}

export interface AdsDecisionReviewResult {
  readonly verdict: AdsDecisionReviewVerdict
  readonly reason_zh: string
  readonly suggested_next_zh: string | null
  readonly reviewed_at: string
}

export interface AdsDecisionV1 {
  readonly schema_version: typeof ADS_DECISION_SCHEMA_VERSION
  readonly decided_at: string
  readonly decided_by: AdsDecisionActor
  readonly subject: AdsDecisionSubject
  readonly decision_type: string
  readonly what_done_zh: string
  readonly evidence_at_decision: AdsDecisionEvidence
  readonly reasoning_zh: string
  readonly expectation: AdsDecisionExpectation
  readonly stop_or_rollback_zh: string
  readonly review_due_on: string
  readonly status: AdsDecisionStatus
  readonly review_result: AdsDecisionReviewResult | null
  readonly linked_card_action_id?: string
}

export interface DecisionDailyInsightRow {
  readonly insight_date: string
  readonly level: string
  readonly entity_id: string
  readonly spend: number | null
  readonly impressions: number | null
  readonly clicks: number | null
  readonly ctr: number | null
  readonly leads: number | null
  readonly results: number | null
}
