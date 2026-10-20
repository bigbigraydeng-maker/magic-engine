// Pure types for the ad heartbeat decision core.
// No I/O, no Meta calls, no database access.

export type ReadKind = 'account' | 'adsets' | 'insights' | 'ads';

export type ReadVerdict = 'ok' | 'read_failed' | 'token_expired' | 'rate_limited';

export interface ClassifyReadInput {
  ok: boolean;
  complete: boolean;
  errorCode: number | null;
  rowCount: number;
  accountHasActiveCampaigns: boolean;
  kind: ReadKind;
}

export interface ClassifyReadResult {
  verdict: ReadVerdict;
  reason: string;
}

export type FailureCategory = 'money' | 'other';

export interface EvaluateZeroSpendInput {
  effectiveStatus: string | null;
  deliverySubStatus: string | null;
  /** ISO timestamp of when the object became approved AND ACTIVE. */
  activeSinceIso: string | null;
  nowIso: string;
  /** Caller-computed hours inside the delivery schedule since activeSince. */
  effectiveDeliveryHours: number;
  spendTodayMinor: number | null;
  impressionsToday: number | null;
  dailyBudgetMinor: number | null;
  /** Minor units per 1000 impressions. */
  expectedCpmMinor: number | null;
  hasDeliverySchedule: boolean;
}

export type ZeroSpendCode =
  | 'alarm'
  | 'delivering'
  | 'not_active'
  | 'in_review_or_learning'
  | 'activation_unknown'
  | 'too_fresh'
  | 'report_lag'
  | 'micro_budget'
  | 'night_low_traffic_or_schedule'
  | 'data_missing';

export interface EvaluateZeroSpendResult {
  alarm: boolean;
  reason: string;
  code: ZeroSpendCode;
}

export type BudgetLevel = 'adset' | 'campaign';

export interface EvaluateOverspendInput {
  budgetLevel: BudgetLevel | null;
  objectKind: 'adset' | 'account';
  dailyBudgetMinor: number | null;
  spendTodayMinor: number | null;
  currency: string | null;
  capCurrency?: string | null;
  capMinor?: number | null;
}

export type OverspendSeverity = 'yellow' | 'red' | 'none';

export interface EvaluateOverspendResult {
  alarm: boolean;
  severity: OverspendSeverity;
  reason: string;
}

export interface StatusSample {
  effectiveStatus: string | null;
  accountStatus?: number | null;
  pendingReviewSinceIso?: string | null;
}

export type StatusChangeType =
  | 'disapproved'
  | 'with_issues'
  | 'pending_review_over_24h'
  | 'account_status_changed';

export interface StatusChange {
  type: StatusChangeType;
  from: string | null;
  to: string | null;
}

export type AlarmType =
  | 'zero_spend'
  | 'overspend'
  | 'status_change'
  | 'account_status'
  | 'read_failed'
  | 'heartbeat_stalled';

export interface DedupeKeyInput {
  clientId: string;
  accountId: string;
  objectId: string | null;
  type: AlarmType;
  timezone: string | null;
  now: Date;
}

export interface AlarmLike {
  key: string;
  severity: 'yellow' | 'red';
}

export interface CapAlarmsResult<T extends AlarmLike> {
  kept: T[];
  mergedSummary: string | null;
}

export interface HeartbeatThresholds {
  /** Must be >= default (stricter = longer wait). */
  reportLagHours?: number;
  /** Must be >= default (stricter = longer wait). */
  zeroSpendMinEffectiveHours?: number;
  /** Must be <= default (stricter = higher bar to alarm). */
  zeroSpendImpressionFraction?: number;
  /** Must be <= default (stricter = higher bar to alarm). */
  overspendFactor?: number;
  /** Must be >= default (stricter = longer wait). */
  pendingReviewMaxHours?: number;
  /** Must be <= default (stricter = fewer alarms). */
  maxAlarmsPerAccountPerDay?: number;
}
