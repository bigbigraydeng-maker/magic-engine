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

function isValidOverride(v: number | undefined): v is number {
  return v !== undefined && Number.isFinite(v) && v > 0;
}

function resolveThresholds(t?: HeartbeatThresholds): ResolvedThresholds {
  const pickMin = (v: number | undefined, def: number) =>
    isValidOverride(v) ? Math.max(v, def) : def;
  const pickMax = (v: number | undefined, def: number) =>
    isValidOverride(v) ? Math.min(v, def) : def;
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

export function parseIsoMs(iso: string): number | null {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function hoursBetween(fromIso: string, toIso: string): number | null {
  const from = parseIsoMs(fromIso);
  const to = parseIsoMs(toIso);
  if (from === null || to === null) return null;
  return (to - from) / HOUR_MS;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function zeroSpendResult(
  alarm: boolean,
  reason: string,
  code: EvaluateZeroSpendResult['code'],
): EvaluateZeroSpendResult {
  return { alarm, reason, code };
}

function passesTimingGates(
  input: EvaluateZeroSpendInput,
  t: ResolvedThresholds,
): EvaluateZeroSpendResult | null {
  const { effectiveStatus, deliverySubStatus, activeSinceIso, nowIso } = input;

  if (effectiveStatus !== 'ACTIVE') {
    return zeroSpendResult(false, 'not_active', 'not_active');
  }

  if (deliverySubStatus) {
    const upper = deliverySubStatus.toUpperCase();
    if (IN_REVIEW_SUBSTRINGS.some((s) => upper.includes(s))) {
      return zeroSpendResult(
        false,
        'in_review_or_learning',
        'in_review_or_learning',
      );
    }
  }

  if (activeSinceIso === null || parseIsoMs(activeSinceIso) === null) {
    return zeroSpendResult(false, 'activation_unknown', 'activation_unknown');
  }

  const hoursSinceActive = hoursBetween(activeSinceIso, nowIso);
  if (hoursSinceActive === null) {
    return zeroSpendResult(false, 'data_missing', 'data_missing');
  }

  if (hoursSinceActive < t.zeroSpendMinEffectiveHours) {
    return zeroSpendResult(false, 'too_fresh', 'too_fresh');
  }

  if (hoursSinceActive < t.zeroSpendMinEffectiveHours + t.reportLagHours) {
    return zeroSpendResult(false, 'report_lag', 'report_lag');
  }

  if (input.effectiveDeliveryHours < t.zeroSpendMinEffectiveHours) {
    return zeroSpendResult(
      false,
      'night_low_traffic_or_schedule',
      'night_low_traffic_or_schedule',
    );
  }

  return null;
}

function computeExpectedImpressions(
  dailyBudgetMinor: number,
  expectedCpmMinor: number,
  effectiveDeliveryHours: number,
): number {
  return (
    (dailyBudgetMinor / (expectedCpmMinor / 1000)) *
    (effectiveDeliveryHours / 24)
  );
}

export function evaluateZeroSpend(
  input: EvaluateZeroSpendInput,
  thresholds?: HeartbeatThresholds,
): EvaluateZeroSpendResult {
  const t = resolveThresholds(thresholds);

  const gate = passesTimingGates(input, t);
  if (gate) return gate;

  const {
    spendTodayMinor,
    impressionsToday,
    dailyBudgetMinor,
    expectedCpmMinor,
    effectiveDeliveryHours,
  } = input;

  if (
    !isFiniteNumber(spendTodayMinor) ||
    !isFiniteNumber(impressionsToday) ||
    !isFiniteNumber(dailyBudgetMinor) ||
    !isFiniteNumber(expectedCpmMinor) ||
    !isFiniteNumber(effectiveDeliveryHours) ||
    expectedCpmMinor <= 0
  ) {
    return zeroSpendResult(false, 'data_missing', 'data_missing');
  }

  const expectedImpressions = computeExpectedImpressions(
    dailyBudgetMinor,
    expectedCpmMinor,
    effectiveDeliveryHours,
  );

  if (expectedImpressions < 1) {
    return zeroSpendResult(false, 'micro_budget', 'micro_budget');
  }

  if (
    spendTodayMinor === 0 &&
    impressionsToday < t.zeroSpendImpressionFraction * expectedImpressions
  ) {
    return zeroSpendResult(true, 'zero_spend', 'alarm');
  }

  return zeroSpendResult(false, 'delivering', 'delivering');
}

// ---------------------------------------------------------------------------
// D) evaluateOverspend
// ---------------------------------------------------------------------------

function overspendResult(
  alarm: boolean,
  severity: EvaluateOverspendResult['severity'],
  reason: string,
): EvaluateOverspendResult {
  return { alarm, severity, reason };
}

function overspendForAdset(
  input: EvaluateOverspendInput,
  t: ResolvedThresholds,
): EvaluateOverspendResult {
  const { budgetLevel, dailyBudgetMinor, spendTodayMinor } = input;

  if (budgetLevel === 'campaign' || dailyBudgetMinor === null) {
    return overspendResult(false, 'none', 'cbo_not_applicable');
  }
  if (!isFiniteNumber(dailyBudgetMinor) || !isFiniteNumber(spendTodayMinor)) {
    return overspendResult(false, 'none', 'data_missing');
  }
  if (dailyBudgetMinor <= 0) {
    return overspendResult(false, 'none', 'not_applicable_zero_budget');
  }
  if (spendTodayMinor > dailyBudgetMinor * t.overspendFactor) {
    // First version: adset overspend is yellow only, never red, never a todo.
    return overspendResult(true, 'yellow', 'adset_overspend');
  }
  return overspendResult(false, 'none', 'within_budget');
}

function normalizeCurrency(c: string | null | undefined): string | null {
  if (c === null || c === undefined) return null;
  const trimmed = c.trim().toUpperCase();
  return trimmed === '' ? null : trimmed;
}

function overspendForAccount(
  input: EvaluateOverspendInput,
): EvaluateOverspendResult {
  const { spendTodayMinor, currency, capCurrency, capMinor } = input;

  if (!isFiniteNumber(capMinor) || !isFiniteNumber(spendTodayMinor)) {
    return overspendResult(false, 'none', 'data_missing');
  }
  if (capMinor <= 0) {
    return overspendResult(false, 'none', 'not_applicable_zero_cap');
  }
  const cur = normalizeCurrency(currency);
  const capCur = normalizeCurrency(capCurrency);
  if (cur === null || capCur === null) {
    return overspendResult(false, 'none', 'data_missing');
  }
  if (cur !== capCur) {
    // Visible but non-alarming: surfaced as yellow, never a todo.
    return overspendResult(false, 'yellow', 'currency_mismatch');
  }
  if (spendTodayMinor > capMinor) {
    return overspendResult(true, 'red', 'account_overspend');
  }
  return overspendResult(false, 'none', 'within_cap');
}

export function evaluateOverspend(
  input: EvaluateOverspendInput,
  thresholds?: HeartbeatThresholds,
): EvaluateOverspendResult {
  const t = resolveThresholds(thresholds);
  if (input.objectKind === 'adset') return overspendForAdset(input, t);
  return overspendForAccount(input);
}

// ---------------------------------------------------------------------------
// E) diffStatus
// ---------------------------------------------------------------------------

function isOverPendingReview(
  sample: StatusSample,
  referenceIso: string,
  maxHours: number,
): boolean {
  if (sample.effectiveStatus !== 'PENDING_REVIEW') return false;
  if (!sample.pendingReviewSinceIso) return false;
  const hours = hoursBetween(sample.pendingReviewSinceIso, referenceIso);
  // Unparsable times mean "not over 24h" (no event).
  if (hours === null) return false;
  return hours > maxHours;
}

function statusTransitionChange(
  prev: StatusSample,
  next: StatusSample,
): StatusChange | null {
  const prevStatus = prev.effectiveStatus;
  const nextStatus = next.effectiveStatus;

  if (prevStatus === nextStatus) return null;
  if (nextStatus === 'DISAPPROVED') {
    return { type: 'disapproved', from: prevStatus, to: nextStatus };
  }
  if (nextStatus === 'WITH_ISSUES') {
    return { type: 'with_issues', from: prevStatus, to: nextStatus };
  }
  return null;
}

// pending_review_over_24h: report once when it first crosses.
// prev is judged at ITS OWN sampled time, next at nowIso.
function pendingReviewChange(
  prev: StatusSample,
  next: StatusSample,
  nowIso: string,
  maxHours: number,
): StatusChange | null {
  const prevRef = prev.sampledAtIso ?? nowIso;
  const prevOver = isOverPendingReview(prev, prevRef, maxHours);
  const nextOver = isOverPendingReview(next, nowIso, maxHours);
  if (prevOver || !nextOver) return null;
  return {
    type: 'pending_review_over_24h',
    from: prev.effectiveStatus,
    to: next.effectiveStatus,
  };
}

// Any account status change is reported, including recovery (e.g. 3 → 1).
function accountStatusChange(
  prev: StatusSample,
  next: StatusSample,
): StatusChange | null {
  const prevAccount = prev.accountStatus ?? null;
  const nextAccount = next.accountStatus ?? null;
  if (prevAccount === null || nextAccount === null) return null;
  if (prevAccount === nextAccount) return null;
  return {
    type: 'account_status_changed',
    from: String(prevAccount),
    to: String(nextAccount),
  };
}

export function diffStatus(
  prev: StatusSample | null,
  next: StatusSample,
  nowIso: string,
  thresholds?: HeartbeatThresholds,
): StatusChange[] {
  if (prev === null) return [];

  const t = resolveThresholds(thresholds);
  const candidates = [
    statusTransitionChange(prev, next),
    pendingReviewChange(prev, next, nowIso, t.pendingReviewMaxHours),
    accountStatusChange(prev, next),
  ];

  return candidates.filter((c): c is StatusChange => c !== null);
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

function safeAccountDayKey(timezone: string | null, now: Date): string {
  try {
    return accountDayKey(timezone, now);
  } catch (err) {
    if (err instanceof RangeError) return accountDayKey(null, now);
    throw err;
  }
}

export function dedupeKey(input: DedupeKeyInput): string {
  const { clientId, accountId, objectId, type, timezone, now } = input;
  const day = safeAccountDayKey(timezone, now);
  const enc = encodeURIComponent;
  if (ACCOUNT_LEVEL_TYPES.has(type)) {
    return `${enc(clientId)}|${enc(accountId)}|${enc(type)}|${enc(day)}`;
  }
  return `${enc(clientId)}|${enc(accountId)}|${enc(objectId ?? '')}|${enc(type)}|${enc(day)}`;
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

  // NOTE: the "≤5 per account per day" limit only holds if the caller passes
  // the whole day's alarms for the account. Reds are never merged away.
  const reds = alarms.filter((a) => a.severity === 'red');
  const yellows = alarms.filter((a) => a.severity === 'yellow');

  if (alarms.length <= limit) {
    return { kept: [...reds, ...yellows], mergedSummary: null };
  }

  const remaining = Math.max(0, limit - reds.length);
  const keptYellows = yellows.slice(0, remaining);
  const mergedCount = yellows.length - keptYellows.length;
  const mergedSummary =
    mergedCount > 0 ? `账户 ${accountId} 另有 ${mergedCount} 个问题` : null;

  return { kept: [...reds, ...keptYellows], mergedSummary };
}
