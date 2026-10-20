// Pure decision core for the ad heartbeat.
// No I/O, no Meta calls, no database access.
// English code/comments; short Chinese reason strings only.

import { accountDayKey } from '@/lib/ads-strategy/account-timezone';
import { D1_REPORT_LAG_HOURS } from '@/lib/ads-strategy/portfolio/diagnostics/thresholds';
import type {
  AlarmLike,
  CapAlarmsResult,
  ClassifyReadInput,
  ClassifyReadResult,
  DedupeKeyInput,
  EvaluateOverspendInput,
  EvaluateOverspendResult,
  EvaluateZeroSpendInput,
  EvaluateZeroSpendResult,
  FailureCategory,
  HeartbeatThresholds,
  StatusChange,
  StatusSample,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REPORT_LAG_HOURS = D1_REPORT_LAG_HOURS;
export const ZERO_SPEND_MIN_EFFECTIVE_HOURS = 2;
export const ZERO_SPEND_IMPRESSION_FRACTION = 0.1;
export const OVERSPEND_FACTOR = 1.25;
export const PENDING_REVIEW_MAX_HOURS = 24;
export const MAX_ALARMS_PER_ACCOUNT_PER_DAY = 5;

const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Threshold resolution (only stricter overrides allowed)
// ---------------------------------------------------------------------------

// Override direction (callers may only make the heartbeat STRICTER):
//   - reportLagHours, zeroSpendMinEffectiveHours, pendingReviewMaxHours:
//     can only be RAISED (evidence-based floors; wait longer before alarming).
//   - zeroSpendImpressionFraction, maxAlarmsPerAccountPerDay:
//     can only be LOWERED (higher bar to alarm / fewer alarms).
//   - overspendFactor: can only be LOWERED (money: more sensitivity allowed).
interface ResolvedThresholds {
  reportLagHours: number;
  zeroSpendMinEffectiveHours: number;
  zeroSpendImpressionFraction: number;
  overspendFactor: number;
  pendingReviewMaxHours: number;
  maxAlarmsPerAccountPerDay: number;
}

function resolveThresholds(t?: HeartbeatThresholds): ResolvedThresholds {
  const pickMin = (v: number | undefined, def: number) =>
    v === undefined ? def : Math.max(v, def);
  const pickMax = (v: number | undefined, def: number) =>
    v === undefined ? def : Math.min(v, def);
  return {
    reportLagHours: pickMin(t?.reportLagHours, REPORT_LAG_HOURS),
    zeroSpendMinEffectiveHours: pickMin(
      t?.zeroSpendMinEffectiveHours,
      ZERO_SPEND_MIN_EFFECTIVE_HOURS,
    ),
    zeroSpendImpressionFraction: pickMax(
      t?.zeroSpendImpressionFraction,
      ZERO_SPEND_IMPRESSION_FRACTION,
    ),
    overspendFactor: pickMax(t?.overspendFactor, OVERSPEND_FACTOR),
    pendingReviewMaxHours: pickMin(
      t?.pendingReviewMaxHours,
      PENDING_REVIEW_MAX_HOURS,
    ),
    maxAlarmsPerAccountPerDay: pickMax(
      t?.maxAlarmsPerAccountPerDay,
      MAX_ALARMS_PER_ACCOUNT_PER_DAY,
    ),
  };
}

// ---------------------------------------------------------------------------
// A) classifyRead
// ---------------------------------------------------------------------------

const RATE_LIMIT_CODES = new Set([17, 80004, 429]);
const TOKEN_EXPIRED_CODE = 190;

export function classifyRead(input: ClassifyReadInput): ClassifyReadResult {
  const { ok, complete, errorCode, rowCount, accountHasActiveCampaigns, kind } =
    input;

  if (errorCode === TOKEN_EXPIRED_CODE) {
    return { verdict: 'token_expired', reason: 'token_expired' };
  }
  if (errorCode !== null && RATE_LIMIT_CODES.has(errorCode)) {
    return { verdict: 'rate_limited', reason: 'rate_limited' };
  }
  if (!ok || !complete) {
    return { verdict: 'read_failed', reason: 'read_failed' };
  }
  if (kind === 'adsets' && accountHasActiveCampaigns && rowCount === 0) {
    return { verdict: 'read_failed', reason: 'empty_adset_list' };
  }
  return { verdict: 'ok', reason: 'ok' };
}

// ---------------------------------------------------------------------------
// B) failuresBeforeAlarm
// ---------------------------------------------------------------------------

export function failuresBeforeAlarm(category: FailureCategory): number {
  return category === 'money' ? 1 : 2;
}

// ---------------------------------------------------------------------------
// C) evaluateZeroSpend
// ---------------------------------------------------------------------------

const IN_REVIEW_SUBSTRINGS = [
  'PENDING_REVIEW',
  'IN_PROCESS',
  'LEARNING',
  'PREAPPROVED',
];

function hoursBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / HOUR_MS;
}

export function evaluateZeroSpend(
  input: EvaluateZeroSpendInput,
  thresholds?: HeartbeatThresholds,
): EvaluateZeroSpendResult {
  const t = resolveThresholds(thresholds);
  const {
    effectiveStatus,
    deliverySubStatus,
    activeSinceIso,
    nowIso,
    effectiveDeliveryHours,
    spendTodayMinor,
    impressionsToday,
    dailyBudgetMinor,
    expectedCpmMinor,
    hasDeliverySchedule,
  } = input;

  if (effectiveStatus !== 'ACTIVE') {
    return { alarm: false, reason: 'not_active', code: 'not_active' };
  }

  if (deliverySubStatus) {
    const upper = deliverySubStatus.toUpperCase();
    if (IN_REVIEW_SUBSTRINGS.some((s) => upper.includes(s))) {
      return {
        alarm: false,
        reason: 'in_review_or_learning',
        code: 'in_review_or_learning',
      };
    }
  }

  if (activeSinceIso === null) {
    return {
      alarm: false,
      reason: 'activation_unknown',
      code: 'activation_unknown',
    };
  }

  const hoursSinceActive = hoursBetween(activeSinceIso, nowIso);

  if (hoursSinceActive < t.zeroSpendMinEffectiveHours) {
    return { alarm: false, reason: 'too_fresh', code: 'too_fresh' };
  }

  if (hoursSinceActive < t.zeroSpendMinEffectiveHours + t.reportLagHours) {
    return { alarm: false, reason: 'report_lag', code: 'report_lag' };
  }

  if (
    effectiveDeliveryHours < t.zeroSpendMinEffectiveHours ||
    (hasDeliverySchedule && effectiveDeliveryHours === 0)
  ) {
    return {
      alarm: false,
      reason: 'night_low_traffic_or_schedule',
      code: 'night_low_traffic_or_schedule',
    };
  }

  if (
    spendTodayMinor === null ||
    impressionsToday === null ||
    dailyBudgetMinor === null ||
    expectedCpmMinor === null
  ) {
    return { alarm: false, reason: 'data_missing', code: 'data_missing' };
  }

  if (expectedCpmMinor <= 0) {
    // Cannot compute expected impressions; treat as missing data.
    return { alarm: false, reason: 'data_missing', code: 'data_missing' };
  }

  const expectedImpressions =
    (dailyBudgetMinor / (expectedCpmMinor / 1000)) *
    (effectiveDeliveryHours / 24);

  if (expectedImpressions < 1) {
    return { alarm: false, reason: 'micro_budget', code: 'micro_budget' };
  }

  if (
    spendTodayMinor === 0 &&
    impressionsToday < t.zeroSpendImpressionFraction * expectedImpressions
  ) {
    return { alarm: true, reason: 'zero_spend', code: 'alarm' };
  }

  return { alarm: false, reason: 'delivering', code: 'delivering' };
}

// ---------------------------------------------------------------------------
// D) evaluateOverspend
// ---------------------------------------------------------------------------

export function evaluateOverspend(
  input: EvaluateOverspendInput,
  thresholds?: HeartbeatThresholds,
): EvaluateOverspendResult {
  const t = resolveThresholds(thresholds);
  const {
    budgetLevel,
    objectKind,
    dailyBudgetMinor,
    spendTodayMinor,
    currency,
    capCurrency,
    capMinor,
  } = input;

  if (objectKind === 'adset') {
    if (budgetLevel === 'campaign' || dailyBudgetMinor === null) {
      return {
        alarm: false,
        severity: 'none',
        reason: 'cbo_not_applicable',
      };
    }
    if (spendTodayMinor === null) {
      return { alarm: false, severity: 'none', reason: 'data_missing' };
    }
    if (spendTodayMinor > dailyBudgetMinor * t.overspendFactor) {
      // First version: adset overspend is yellow only, never red, never a todo.
      return { alarm: true, severity: 'yellow', reason: 'adset_overspend' };
    }
    return { alarm: false, severity: 'none', reason: 'within_budget' };
  }

  // objectKind === 'account'
  if (capMinor === null || capMinor === undefined) {
    return { alarm: false, severity: 'none', reason: 'data_missing' };
  }
  if (spendTodayMinor === null) {
    return { alarm: false, severity: 'none', reason: 'data_missing' };
  }
  if (capCurrency === null || capCurrency === undefined) {
    return { alarm: false, severity: 'none', reason: 'data_missing' };
  }
  if (currency !== capCurrency) {
    return { alarm: false, severity: 'none', reason: 'currency_mismatch' };
  }
  if (spendTodayMinor > capMinor) {
    return { alarm: true, severity: 'red', reason: 'account_overspend' };
  }
  return { alarm: false, severity: 'none', reason: 'within_cap' };
}

// ---------------------------------------------------------------------------
// E) diffStatus
// ---------------------------------------------------------------------------

function isOverPendingReview(
  sample: StatusSample,
  nowIso: string,
  maxHours: number,
): boolean {
  if (sample.effectiveStatus !== 'PENDING_REVIEW') return false;
  if (!sample.pendingReviewSinceIso) return false;
  const hours = hoursBetween(sample.pendingReviewSinceIso, nowIso);
  return hours > maxHours;
}

export function diffStatus(
  prev: StatusSample | null,
  next: StatusSample,
  nowIso: string,
  thresholds?: HeartbeatThresholds,
): StatusChange[] {
  if (prev === null) return [];

  const t = resolveThresholds(thresholds);
  const changes: StatusChange[] = [];

  const prevStatus = prev.effectiveStatus;
  const nextStatus = next.effectiveStatus;

  if (prevStatus !== nextStatus) {
    if (nextStatus === 'DISAPPROVED') {
      changes.push({
        type: 'disapproved',
        from: prevStatus,
        to: nextStatus,
      });
    } else if (nextStatus === 'WITH_ISSUES') {
      changes.push({
        type: 'with_issues',
        from: prevStatus,
        to: nextStatus,
      });
    }
  }

  // pending_review_over_24h: report once when it first crosses.
  const prevOver = isOverPendingReview(prev, nowIso, t.pendingReviewMaxHours);
  const nextOver = isOverPendingReview(next, nowIso, t.pendingReviewMaxHours);
  if (!prevOver && nextOver) {
    changes.push({
      type: 'pending_review_over_24h',
      from: prevStatus,
      to: nextStatus,
    });
  }

  const prevAccount = prev.accountStatus ?? null;
  const nextAccount = next.accountStatus ?? null;
  if (
    prevAccount !== null &&
    nextAccount !== null &&
    prevAccount !== nextAccount
  ) {
    changes.push({
      type: 'account_status_changed',
      from: String(prevAccount),
      to: String(nextAccount),
    });
  }

  return changes;
}

// ---------------------------------------------------------------------------
// F) dedupeKey
// ---------------------------------------------------------------------------

const ACCOUNT_LEVEL_TYPES = new Set([
  'zero_spend',
  'account_status',
  'read_failed',
  'heartbeat_stalled',
]);

export function dedupeKey(input: DedupeKeyInput): string {
  const { clientId, accountId, objectId, type, timezone, now } = input;
  const day = accountDayKey(timezone, now);
  if (ACCOUNT_LEVEL_TYPES.has(type)) {
    return `${clientId}|${accountId}|${type}|${day}`;
  }
  return `${clientId}|${accountId}|${objectId ?? ''}|${type}|${day}`;
}

// ---------------------------------------------------------------------------
// G) capAlarms
// ---------------------------------------------------------------------------

export function capAlarms<T extends AlarmLike>(
  alarms: T[],
  accountId: string,
  thresholds?: HeartbeatThresholds,
): CapAlarmsResult<T> {
  const t = resolveThresholds(thresholds);
  const limit = t.maxAlarmsPerAccountPerDay;

  if (alarms.length <= limit) {
    return { kept: alarms.slice(), mergedSummary: null };
  }

  // Stable sort: red first, preserving original order within each severity.
  const reds = alarms.filter((a) => a.severity === 'red');
  const yellows = alarms.filter((a) => a.severity === 'yellow');
  const ordered = [...reds, ...yellows];

  const kept = ordered.slice(0, limit);
  const mergedCount = ordered.length - limit;
  const mergedSummary = `账户 ${accountId} 另有 ${mergedCount} 个问题`;

  return { kept, mergedSummary };
}
