// Pure glue for the ad heartbeat: turns one HeartbeatAccountRead + previous
// state into alarm candidates. No I/O, no Meta calls, no database access.
// English code/comments; short Chinese reason strings only.

import {
  capAlarms,
  dedupeKey,
  diffStatus,
  evaluateOverspend,
  evaluateZeroSpend,
  failuresBeforeAlarm,
  parseIsoMs,
} from './criteria';
import type { HeartbeatAccountRead, HeartbeatAdsetSample } from './read';
import type {
  AlarmLike,
  FailureCategory,
  HeartbeatThresholds,
  StatusChange,
  StatusSample,
} from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AlarmType =
  | 'zero_spend'
  | 'overspend'
  | 'status_change'
  | 'account_status'
  | 'read_failed'
  | 'heartbeat_stalled';

export interface HeartbeatState {
  sampledAtIso: string;
  accountStatus: number | null;
  consecutiveReadFailures: number;
  adsets: Record<
    string,
    {
      effectiveStatus: string | null;
      pendingReviewSinceIso: string | null;
    }
  >;
}

export interface AlarmCandidate {
  type: AlarmType;
  objectId: string | null;
  severity: 'yellow' | 'red';
  key: string;
  evidence: Record<string, unknown>;
}

export interface Observation {
  type: string;
  objectId: string | null;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface EvaluateContext {
  clientId: string;
  now: Date;
  expectedCpmMinor: number | null;
  accountCapMinor: number | null;
  accountCapCurrency: string | null;
  prev: HeartbeatState | null;
  thresholds?: HeartbeatThresholds;
}

export interface EvaluateResult {
  alarms: AlarmCandidate[];
  observations: Observation[];
  nextState: HeartbeatState;
  mergedSummary: string | null;
  skippedReason: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;
const IN_REVIEW_STATUSES = new Set([
  'IN_PROCESS',
  'PENDING_REVIEW',
  'PREAPPROVED',
]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function makeKey(
  ctx: EvaluateContext,
  read: HeartbeatAccountRead,
  type: AlarmType,
  objectId: string | null,
): string {
  return dedupeKey({
    clientId: ctx.clientId,
    accountId: read.adAccountId,
    objectId,
    type,
    timezone: read.timezone,
    now: ctx.now,
  });
}

function hoursSince(iso: string | null, now: Date): number | null {
  if (iso === null) return null;
  const ms = parseIsoMs(iso);
  if (ms === null) return null;
  return (now.getTime() - ms) / HOUR_MS;
}

function deliverySubStatusFor(effectiveStatus: string | null): string | null {
  if (effectiveStatus === null) return null;
  return IN_REVIEW_STATUSES.has(effectiveStatus) ? effectiveStatus : null;
}

function failedOutcomeKinds(read: HeartbeatAccountRead): Set<string> {
  const kinds = new Set<string>();
  for (const o of read.outcomes) {
    if (o.verdict === 'read_failed' || o.verdict === 'token_expired' || o.verdict === 'rate_limited') {
      kinds.add(o.kind);
    }
  }
  return kinds;
}

function outcomeVerdict(
  read: HeartbeatAccountRead,
  kind: string,
): string | null {
  const hit = read.outcomes.find((o) => o.kind === kind);
  return hit ? hit.verdict : null;
}

/**
 * Spend/impressions are only trustworthy when insights were actually read.
 * A failed or skipped insights read means "unknown", never "zero".
 */
function insightsKnown(read: HeartbeatAccountRead): boolean {
  const verdict = outcomeVerdict(read, 'insights');
  return verdict === 'ok' || verdict === 'skipped';
}

function knownSpend(a: HeartbeatAdsetSample, known: boolean): number | null {
  return known ? a.spendTodayMinor : null;
}

function knownImpressions(
  a: HeartbeatAdsetSample,
  known: boolean,
): number | null {
  return known ? a.impressionsToday : null;
}

// ---------------------------------------------------------------------------
// 1) nextState
// ---------------------------------------------------------------------------

function buildNextState(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
): HeartbeatState {
  const prev = ctx.prev;
  const consecutiveReadFailures = read.anyFailure
    ? (prev?.consecutiveReadFailures ?? 0) + 1
    : 0;

  const accountStatus =
    read.accountStatus === null && read.anyFailure
      ? prev?.accountStatus ?? null
      : read.accountStatus;

  const adsets: HeartbeatState['adsets'] = {};
  for (const a of read.adsets) {
    const prevAdset = prev?.adsets[a.adsetId];
    let pendingReviewSinceIso: string | null = null;
    if (a.effectiveStatus === 'PENDING_REVIEW') {
      pendingReviewSinceIso =
        prevAdset?.pendingReviewSinceIso ?? read.sampledAtIso;
    }
    adsets[a.adsetId] = {
      effectiveStatus: a.effectiveStatus,
      pendingReviewSinceIso,
    };
  }

  return {
    sampledAtIso: read.sampledAtIso,
    accountStatus,
    consecutiveReadFailures,
    adsets,
  };
}

// ---------------------------------------------------------------------------
// 2) read failures
// ---------------------------------------------------------------------------

function tokenExpiredAlarm(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
): AlarmCandidate {
  return {
    type: 'read_failed',
    objectId: null,
    severity: 'red',
    key: makeKey(ctx, read, 'read_failed', null),
    evidence: { reason: 'token_expired' },
  };
}

function failureCategory(read: HeartbeatAccountRead): FailureCategory {
  const kinds = failedOutcomeKinds(read);
  return kinds.has('account') || kinds.has('insights') ? 'money' : 'other';
}

function rateLimitedSkippedObservation(
  read: HeartbeatAccountRead,
  nextState: HeartbeatState,
  threshold: number,
  observations: Observation[],
): void {
  if (read.abortedBy !== 'rate_limited') return;
  observations.push({
    type: 'rate_limited_skipped',
    objectId: null,
    reason: 'rate_limited',
    evidence: {
      consecutiveReadFailures: nextState.consecutiveReadFailures,
      threshold,
    },
  });
}

function readFailureAlarm(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
  nextState: HeartbeatState,
  category: FailureCategory,
): AlarmCandidate {
  const severity: 'yellow' | 'red' =
    read.abortedBy === 'rate_limited' ? 'yellow' : 'red';
  return {
    type: 'read_failed',
    objectId: null,
    severity,
    key: makeKey(ctx, read, 'read_failed', null),
    evidence: {
      reason: read.abortedBy ?? 'read_failed',
      category,
      consecutiveReadFailures: nextState.consecutiveReadFailures,
    },
  };
}

function readFailureAlarms(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
  nextState: HeartbeatState,
  observations: Observation[],
): AlarmCandidate[] {
  if (!read.anyFailure) return [];
  if (read.abortedBy === 'token_expired') {
    return [tokenExpiredAlarm(read, ctx)];
  }

  const category = failureCategory(read);
  // A rate_limited abort is transient: always require 2 consecutive failures,
  // even when the failed kind is money-category (account/insights).
  const threshold =
    read.abortedBy === 'rate_limited' ? 2 : failuresBeforeAlarm(category);

  if (nextState.consecutiveReadFailures < threshold) {
    rateLimitedSkippedObservation(read, nextState, threshold, observations);
    return [];
  }

  return [readFailureAlarm(read, ctx, nextState, category)];
}

// ---------------------------------------------------------------------------
// 4) account status
// ---------------------------------------------------------------------------

function accountStatusAlarms(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
  nextState: HeartbeatState,
): AlarmCandidate[] {
  const prev = ctx.prev;
  if (prev === null) return [];
  if (prev.accountStatus === null || nextState.accountStatus === null) return [];

  const prevSample: StatusSample = {
    effectiveStatus: null,
    accountStatus: prev.accountStatus,
    sampledAtIso: prev.sampledAtIso,
  };
  const nextSample: StatusSample = {
    effectiveStatus: null,
    accountStatus: nextState.accountStatus,
    sampledAtIso: read.sampledAtIso,
  };

  const changes = diffStatus(prevSample, nextSample, ctx.now.toISOString(), ctx.thresholds);
  const out: AlarmCandidate[] = [];
  for (const c of changes) {
    if (c.type !== 'account_status_changed') continue;
    const recovered = nextState.accountStatus === 1;
    out.push({
      type: 'account_status',
      objectId: null,
      severity: recovered ? 'yellow' : 'red',
      key: makeKey(ctx, read, 'account_status', null),
      evidence: { from: c.from, to: c.to },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5a) adset status changes
// ---------------------------------------------------------------------------

function adsetStatusAlarms(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
): AlarmCandidate[] {
  const prev = ctx.prev;
  if (prev === null) return [];
  if (outcomeVerdict(read, 'adsets') !== 'ok') return [];

  const out: AlarmCandidate[] = [];
  for (const a of read.adsets) {
    const prevAdset = prev.adsets[a.adsetId];
    if (!prevAdset) continue;

    const prevSample: StatusSample = {
      effectiveStatus: prevAdset.effectiveStatus,
      pendingReviewSinceIso: prevAdset.pendingReviewSinceIso,
      sampledAtIso: prev.sampledAtIso,
    };
    const nextSample: StatusSample = {
      effectiveStatus: a.effectiveStatus,
      pendingReviewSinceIso:
        a.effectiveStatus === 'PENDING_REVIEW'
          ? prevAdset.pendingReviewSinceIso ?? read.sampledAtIso
          : null,
      sampledAtIso: read.sampledAtIso,
    };

    const changes = diffStatus(prevSample, nextSample, ctx.now.toISOString(), ctx.thresholds);
    for (const c of changes) {
      const mapped = mapStatusChange(c);
      if (mapped === null) continue;
      out.push({
        type: 'status_change',
        objectId: a.adsetId,
        severity: mapped.severity,
        key: makeKey(ctx, read, 'status_change', a.adsetId),
        evidence: { change: c.type, from: c.from, to: c.to },
      });
    }
  }
  return out;
}

function mapStatusChange(
  c: StatusChange,
): { severity: 'yellow' | 'red' } | null {
  if (c.type === 'disapproved' || c.type === 'with_issues') {
    return { severity: 'red' };
  }
  if (c.type === 'pending_review_over_24h') {
    return { severity: 'yellow' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5b) adset zero spend
// ---------------------------------------------------------------------------

function adsetZeroSpendAlarms(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
): AlarmCandidate[] {
  const known = insightsKnown(read);
  const out: AlarmCandidate[] = [];
  for (const a of read.adsets) {
    const spend = knownSpend(a, known);
    const impressions = knownImpressions(a, known);
    if (spend === null) continue;
    if (a.startTime === null) continue;
    const hours = hoursSince(a.startTime, ctx.now);
    if (hours === null) continue;

    const result = evaluateZeroSpend(
      {
        effectiveStatus: a.effectiveStatus,
        deliverySubStatus: deliverySubStatusFor(a.effectiveStatus),
        activeSinceIso: a.startTime,
        nowIso: ctx.now.toISOString(),
        effectiveDeliveryHours: Math.max(0, hours),
        spendTodayMinor: spend,
        impressionsToday: impressions,
        dailyBudgetMinor: a.dailyBudgetMinor,
        expectedCpmMinor: ctx.expectedCpmMinor,
        hasDeliverySchedule: a.hasDeliverySchedule,
      },
      ctx.thresholds,
    );

    if (!result.alarm) continue;
    out.push({
      type: 'zero_spend',
      objectId: a.adsetId,
      severity: 'red',
      key: makeKey(ctx, read, 'zero_spend', null),
      evidence: {
        code: result.code,
        adset_ids: [a.adsetId],
        spendTodayMinor: spend,
        impressionsToday: impressions,
        dailyBudgetMinor: a.dailyBudgetMinor,
        expectedCpmMinor: ctx.expectedCpmMinor,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5c) adset overspend (observation only)
// ---------------------------------------------------------------------------

function adsetOverspendObservations(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
  observations: Observation[],
): void {
  const known = insightsKnown(read);
  for (const a of read.adsets) {
    const spend = knownSpend(a, known);
    if (spend === null) continue;
    const result = evaluateOverspend(
      {
        objectKind: 'adset',
        budgetLevel: a.budgetLevel,
        dailyBudgetMinor: a.dailyBudgetMinor,
        spendTodayMinor: spend,
        currency: read.currency,
      },
      ctx.thresholds,
    );
    if (!result.alarm) continue;
    observations.push({
      type: 'adset_overspend',
      objectId: a.adsetId,
      reason: result.reason,
      evidence: {
        severity: result.severity,
        spendTodayMinor: spend,
        dailyBudgetMinor: a.dailyBudgetMinor,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// 6) account overspend
// ---------------------------------------------------------------------------

function totalAdsetSpend(read: HeartbeatAccountRead): number | null {
  const known = insightsKnown(read);
  let total = 0;
  for (const a of read.adsets) {
    const spend = knownSpend(a, known);
    if (spend === null) return null;
    total += spend;
  }
  return total;
}

function currencyMismatchObservation(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
  observations: Observation[],
): void {
  observations.push({
    type: 'currency_mismatch',
    objectId: null,
    reason: 'currency_mismatch',
    evidence: {
      currency: read.currency,
      capCurrency: ctx.accountCapCurrency,
    },
  });
}

function accountOverspendAlarm(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
  observations: Observation[],
): AlarmCandidate | null {
  if (outcomeVerdict(read, 'insights') !== 'ok') return null;

  const total = totalAdsetSpend(read);
  if (total === null) return null;

  const result = evaluateOverspend(
    {
      objectKind: 'account',
      budgetLevel: null,
      dailyBudgetMinor: null,
      spendTodayMinor: total,
      currency: read.currency,
      capCurrency: ctx.accountCapCurrency,
      capMinor: ctx.accountCapMinor,
    },
    ctx.thresholds,
  );

  if (result.reason === 'currency_mismatch') {
    currencyMismatchObservation(read, ctx, observations);
    return null;
  }

  if (!result.alarm) return null;
  return {
    type: 'overspend',
    objectId: read.adAccountId,
    severity: 'red',
    key: makeKey(ctx, read, 'overspend', read.adAccountId),
    evidence: {
      reason: result.reason,
      spendTodayMinor: total,
      capMinor: ctx.accountCapMinor,
      currency: read.currency,
    },
  };
}

// ---------------------------------------------------------------------------
// 7) dedupe
// ---------------------------------------------------------------------------

function dedupeAlarms(alarms: AlarmCandidate[]): AlarmCandidate[] {
  const byKey = new Map<string, AlarmCandidate>();
  for (const a of alarms) {
    const existing = byKey.get(a.key);
    if (!existing) {
      byKey.set(a.key, a);
      continue;
    }
    if (a.type === 'zero_spend' && a.objectId !== null) {
      const ids = (existing.evidence.adset_ids as string[] | undefined) ?? [];
      if (!ids.includes(a.objectId)) ids.push(a.objectId);
      existing.evidence = { ...existing.evidence, adset_ids: ids };
    }
  }
  return Array.from(byKey.values());
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function evaluateAccountRound(
  read: HeartbeatAccountRead,
  ctx: EvaluateContext,
): EvaluateResult {
  const nextState = buildNextState(read, ctx);
  const observations: Observation[] = [];

  const alarms: AlarmCandidate[] = [
    ...readFailureAlarms(read, ctx, nextState, observations),
    ...accountStatusAlarms(read, ctx, nextState),
    ...adsetStatusAlarms(read, ctx),
    ...adsetZeroSpendAlarms(read, ctx),
  ];

  adsetOverspendObservations(read, ctx, observations);

  const accountOverspend = accountOverspendAlarm(read, ctx, observations);
  if (accountOverspend) alarms.push(accountOverspend);

  const deduped = dedupeAlarms(alarms);
  const capped = capAlarms<AlarmCandidate & AlarmLike>(
    deduped,
    read.adAccountId,
    ctx.thresholds,
  );

  const skippedReason =
    read.abortedBy !== null && capped.kept.length === 0
      ? `aborted_by_${read.abortedBy}`
      : null;

  return {
    alarms: capped.kept,
    observations,
    nextState,
    mergedSummary: capped.mergedSummary,
    skippedReason,
  };
}
