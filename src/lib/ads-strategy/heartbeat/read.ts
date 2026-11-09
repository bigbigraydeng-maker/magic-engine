// Read orchestrator for the ad heartbeat.
// Read-only: no DB, no writes, no retries, no backoff.
// English code/comments; short Chinese reason strings only.

import { accountDayKey } from '@/lib/ads-strategy/account-timezone';
import {
  fetchHeartbeatAccount,
  fetchHeartbeatAdsets,
  fetchHeartbeatAds,
  fetchHeartbeatTodayInsights,
  type GraphHeartbeatAccount,
  type GraphHeartbeatAd,
  type GraphHeartbeatAdset,
  type GraphHeartbeatInsightRow,
  type GraphReadResult,
} from '@/lib/meta/entity-settings';
import { classifyRead } from './criteria';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HeartbeatReadKind = 'account' | 'adsets' | 'ads' | 'insights';

export type HeartbeatReadVerdict =
  | 'ok'
  | 'read_failed'
  | 'token_expired'
  | 'rate_limited'
  | 'skipped';

export interface HeartbeatReadOutcome {
  kind: HeartbeatReadKind;
  verdict: HeartbeatReadVerdict;
  reason: string;
  errorCode: number | null;
}

export interface HeartbeatAdsetSample {
  adsetId: string;
  campaignId: string | null;
  name: string | null;
  effectiveStatus: string | null;
  budgetLevel: 'adset' | 'campaign';
  dailyBudgetMinor: number | null;
  hasLifetimeBudget: boolean;
  createdTime: string | null;
  startTime: string | null;
  updatedTime: string | null;
  hasDeliverySchedule: boolean;
  isDynamicCreative: boolean;
  spendTodayMinor: number | null;
  impressionsToday: number | null;
}

export interface HeartbeatAdSample {
  adId: string;
  adsetId: string | null;
  effectiveStatus: string | null;
}

export interface HeartbeatAccountRead {
  adAccountId: string;
  sampledAtIso: string;
  accountDay: string | null;
  timezone: string | null;
  currency: string | null;
  accountStatus: number | null;
  disableReason: number | null;
  adsets: HeartbeatAdsetSample[];
  ads: HeartbeatAdSample[];
  outcomes: HeartbeatReadOutcome[];
  abortedBy: 'token_expired' | 'rate_limited' | null;
  callCount: number;
  anyFailure: boolean;
}

export interface HeartbeatFetchers {
  account: (
    adAccountId: string,
    accessToken: string,
  ) => Promise<GraphReadResult<GraphHeartbeatAccount>>;
  adsets: (
    adAccountId: string,
    accessToken: string,
  ) => Promise<GraphReadResult<GraphHeartbeatAdset>>;
  ads: (
    adAccountId: string,
    accessToken: string,
  ) => Promise<GraphReadResult<GraphHeartbeatAd>>;
  insights: (
    adAccountId: string,
    accessToken: string,
    day: string,
  ) => Promise<GraphReadResult<GraphHeartbeatInsightRow>>;
}

export const defaultFetchers: HeartbeatFetchers = {
  account: fetchHeartbeatAccount,
  adsets: fetchHeartbeatAdsets,
  ads: fetchHeartbeatAds,
  insights: fetchHeartbeatTodayInsights,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOUR_MS = 60 * 60 * 1000;

/** Currencies whose smallest unit is the whole unit (no minor subdivision). */
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP']);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Graph `daily_budget` is already in minor units ("7500"). */
export function parseBudgetMinor(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** Graph insights `spend` is in major units ("12.34"). */
export function toMinorUnits(
  amount: string | undefined,
  currency: string | null,
): number | null {
  if (amount === undefined || amount === null) return null;
  const trimmed = amount.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const cur = currency ? currency.trim().toUpperCase() : null;
  if (cur !== null && ZERO_DECIMAL_CURRENCIES.has(cur)) return Math.round(n);
  return Math.round(n * 100);
}

function parseImpressions(raw: string | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function normalizeCurrency(c: string | undefined | null): string | null {
  if (c === null || c === undefined) return null;
  const trimmed = c.trim().toUpperCase();
  return trimmed === '' ? null : trimmed;
}

function safeAccountDayKey(timezone: string | null, now: Date): string | null {
  try {
    return accountDayKey(timezone, now);
  } catch (err) {
    if (err instanceof RangeError) {
      try {
        return accountDayKey(null, now);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function errorCodeOf<T>(result: GraphReadResult<T>): number | null {
  if (result.error === null) return null;
  if (result.error.code !== null) return result.error.code;
  if (result.error.status === 429) return 429;
  return null;
}

function classify<T>(
  kind: HeartbeatReadKind,
  result: GraphReadResult<T>,
  accountHasActiveCampaigns: boolean,
): HeartbeatReadOutcome {
  const verdict = classifyRead({
    ok: result.error === null,
    complete: result.complete,
    errorCode: errorCodeOf(result),
    rowCount: result.rows.length,
    accountHasActiveCampaigns,
    kind,
  });
  return {
    kind,
    verdict: verdict.verdict,
    reason: verdict.reason,
    errorCode: errorCodeOf(result),
  };
}

function isAbortVerdict(v: HeartbeatReadVerdict): boolean {
  return v === 'token_expired' || v === 'rate_limited';
}

function skippedOutcome(
  kind: HeartbeatReadKind,
  reason: string,
): HeartbeatReadOutcome {
  return { kind, verdict: 'skipped', reason, errorCode: null };
}

// ---------------------------------------------------------------------------
// Sample builders
// ---------------------------------------------------------------------------

interface InsightLookup {
  spendMinor: number | null;
  impressions: number | null;
}

function buildInsightLookup(
  rows: GraphHeartbeatInsightRow[],
  currency: string | null,
): Map<string, InsightLookup> {
  const map = new Map<string, InsightLookup>();
  for (const row of rows) {
    if (!row.adset_id) continue;
    map.set(row.adset_id, {
      spendMinor: toMinorUnits(row.spend, currency),
      impressions: parseImpressions(row.impressions),
    });
  }
  return map;
}

function buildAdsetSample(
  adset: GraphHeartbeatAdset,
  currency: string | null,
  insightsOk: boolean,
  lookup: Map<string, InsightLookup>,
): HeartbeatAdsetSample {
  const dailyBudgetMinor = parseBudgetMinor(adset.daily_budget);
  const lifetimeMinor = parseBudgetMinor(adset.lifetime_budget);
  const hasLifetimeBudget = lifetimeMinor !== null;
  const budgetLevel: 'adset' | 'campaign' =
    dailyBudgetMinor !== null ? 'adset' : 'campaign';
  const hasDeliverySchedule =
    Array.isArray(adset.adset_schedule) && adset.adset_schedule.length > 0;

  let spendTodayMinor: number | null = null;
  let impressionsToday: number | null = null;
  if (insightsOk) {
    const hit = lookup.get(adset.id);
    // Insights omit rows with no delivery → absent means 0/0.
    spendTodayMinor = hit ? hit.spendMinor : 0;
    impressionsToday = hit ? hit.impressions : 0;
  }

  return {
    adsetId: adset.id,
    campaignId: adset.campaign_id ?? null,
    name: adset.name ?? null,
    effectiveStatus: adset.effective_status ?? null,
    budgetLevel,
    dailyBudgetMinor: hasLifetimeBudget ? null : dailyBudgetMinor,
    hasLifetimeBudget,
    createdTime: adset.created_time ?? null,
    startTime: adset.start_time ?? null,
    updatedTime: adset.updated_time ?? null,
    hasDeliverySchedule,
    isDynamicCreative: adset.is_dynamic_creative === true,
    spendTodayMinor,
    impressionsToday,
  };
}

function buildAdsetSamples(
  adsets: GraphHeartbeatAdset[],
  currency: string | null,
  insightsOk: boolean,
  insightRows: GraphHeartbeatInsightRow[],
): HeartbeatAdsetSample[] {
  const lookup = insightsOk
    ? buildInsightLookup(insightRows, currency)
    : new Map<string, InsightLookup>();
  return adsets.map((a) => buildAdsetSample(a, currency, insightsOk, lookup));
}

function buildAdSamples(ads: GraphHeartbeatAd[]): HeartbeatAdSample[] {
  return ads.map((ad) => ({
    adId: ad.id,
    adsetId: ad.adset_id ?? null,
    effectiveStatus: ad.effective_status ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface ReadHeartbeatAccountArgs {
  adAccountId: string;
  accessToken: string;
  now: Date;
  accountHasActiveCampaigns: boolean;
  fetchers?: HeartbeatFetchers;
}

interface AccountReadState {
  outcome: HeartbeatReadOutcome;
  account: GraphHeartbeatAccount | null;
}

async function runAccountRead(
  args: ReadHeartbeatAccountArgs,
  fetchers: HeartbeatFetchers,
): Promise<AccountReadState> {
  const result = await fetchers.account(args.adAccountId, args.accessToken);
  const outcome = classify(
    'account',
    result,
    args.accountHasActiveCampaigns,
  );
  const account = outcome.verdict === 'ok' ? result.rows[0] ?? null : null;
  return { outcome, account };
}

interface AdsetsReadState {
  outcome: HeartbeatReadOutcome;
  rows: GraphHeartbeatAdset[];
}

async function runAdsetsRead(
  args: ReadHeartbeatAccountArgs,
  fetchers: HeartbeatFetchers,
): Promise<AdsetsReadState> {
  const result = await fetchers.adsets(args.adAccountId, args.accessToken);
  const outcome = classify(
    'adsets',
    result,
    args.accountHasActiveCampaigns,
  );
  return { outcome, rows: result.rows };
}

interface AdsReadState {
  outcome: HeartbeatReadOutcome;
  rows: GraphHeartbeatAd[];
}

async function runAdsRead(
  args: ReadHeartbeatAccountArgs,
  fetchers: HeartbeatFetchers,
): Promise<AdsReadState> {
  const result = await fetchers.ads(args.adAccountId, args.accessToken);
  const outcome = classify('ads', result, args.accountHasActiveCampaigns);
  return { outcome, rows: result.rows };
}

interface InsightsReadState {
  outcome: HeartbeatReadOutcome;
  rows: GraphHeartbeatInsightRow[];
}

async function runInsightsRead(
  args: ReadHeartbeatAccountArgs,
  fetchers: HeartbeatFetchers,
  day: string,
): Promise<InsightsReadState> {
  const result = await fetchers.insights(
    args.adAccountId,
    args.accessToken,
    day,
  );
  const outcome = classify('insights', result, args.accountHasActiveCampaigns);
  return { outcome, rows: result.rows };
}

function anyFailureOf(outcomes: HeartbeatReadOutcome[]): boolean {
  return outcomes.some(
    (o) =>
      o.verdict === 'read_failed' ||
      o.verdict === 'token_expired' ||
      o.verdict === 'rate_limited',
  );
}

interface ReadState {
  outcomes: HeartbeatReadOutcome[];
  callCount: number;
  abortedBy: 'token_expired' | 'rate_limited' | null;
}

function recordOutcome(
  state: ReadState,
  outcome: HeartbeatReadOutcome,
): void {
  state.outcomes.push(outcome);
  if (outcome.verdict !== 'skipped') state.callCount += 1;
  if (isAbortVerdict(outcome.verdict)) {
    state.abortedBy = outcome.verdict as 'token_expired' | 'rate_limited';
  }
}

/**
 * Runs one read step unless a prior step aborted the sequence.
 * When aborted, records a skipped outcome with reason `aborted_by_<verdict>`.
 */
async function runStep<T>(
  state: ReadState,
  kind: HeartbeatReadKind,
  run: () => Promise<{ outcome: HeartbeatReadOutcome; rows: T[] }>,
): Promise<T[]> {
  if (state.abortedBy !== null) {
    state.outcomes.push(
      skippedOutcome(kind, `aborted_by_${state.abortedBy}`),
    );
    return [];
  }
  const result = await run();
  recordOutcome(state, result.outcome);
  return result.rows;
}

interface AccountFields {
  timezone: string | null;
  currency: string | null;
  accountStatus: number | null;
  disableReason: number | null;
  accountDay: string | null;
}

function deriveAccountFields(
  accountState: AccountReadState,
  now: Date,
): AccountFields {
  const account = accountState.account;
  const timezone = account?.timezone_name ?? null;
  const currency = normalizeCurrency(account?.currency ?? null);
  const accountStatus =
    typeof account?.account_status === 'number' ? account.account_status : null;
  const disableReason =
    typeof account?.disable_reason === 'number' ? account.disable_reason : null;
  const accountDay =
    accountState.outcome.verdict === 'ok' && timezone !== null
      ? safeAccountDayKey(timezone, now)
      : null;
  return { timezone, currency, accountStatus, disableReason, accountDay };
}

async function readInsightsStep(
  state: ReadState,
  args: ReadHeartbeatAccountArgs,
  fetchers: HeartbeatFetchers,
  accountDay: string | null,
): Promise<{ rows: GraphHeartbeatInsightRow[]; ok: boolean }> {
  if (state.abortedBy !== null) {
    state.outcomes.push(
      skippedOutcome('insights', `aborted_by_${state.abortedBy}`),
    );
    return { rows: [], ok: false };
  }
  if (accountDay === null) {
    // Account read failed → timezone unknown → never guess the day.
    state.outcomes.push(skippedOutcome('insights', 'no_timezone'));
    return { rows: [], ok: false };
  }
  const result = await runInsightsRead(args, fetchers, accountDay);
  recordOutcome(state, result.outcome);
  return { rows: result.rows, ok: result.outcome.verdict === 'ok' };
}

interface AssembleAccountReadArgs {
  args: ReadHeartbeatAccountArgs;
  sampledAtIso: string;
  fields: AccountFields;
  state: ReadState;
  adsetRows: GraphHeartbeatAdset[];
  adRows: GraphHeartbeatAd[];
  insights: { rows: GraphHeartbeatInsightRow[]; ok: boolean };
}

function assembleAccountRead(
  input: AssembleAccountReadArgs,
): HeartbeatAccountRead {
  const { args, sampledAtIso, fields, state, adsetRows, adRows, insights } =
    input;
  return assembleAccountRead({
    args,
    sampledAtIso,
    fields,
    state,
    adsetRows,
    adRows,
    insights,
  });
}

export async function readHeartbeatAccount(
  args: ReadHeartbeatAccountArgs,
): Promise<HeartbeatAccountRead> {
  const fetchers = args.fetchers ?? defaultFetchers;
  const sampledAtIso = args.now.toISOString();
  const state: ReadState = { outcomes: [], callCount: 0, abortedBy: null };

  // 1) account
  const accountState = await runAccountRead(args, fetchers);
  recordOutcome(state, accountState.outcome);
  const fields = deriveAccountFields(accountState, args.now);

  // 2) adsets
  const adsetRows = await runStep(state, 'adsets', () => runAdsetsRead(args, fetchers));

  // 3) ads
  const adRows = await runStep(state, 'ads', () => runAdsRead(args, fetchers));

  // 4) insights
  const insights = await readInsightsStep(state, args, fetchers, fields.accountDay);

  const adsets = buildAdsetSamples(adsetRows, fields.currency, insights.ok, insights.rows);
  const ads = buildAdSamples(adRows);

  return {
    adAccountId: args.adAccountId,
    sampledAtIso,
    accountDay: fields.accountDay,
    timezone: fields.timezone,
    currency: fields.currency,
    accountStatus: fields.accountStatus,
    disableReason: fields.disableReason,
    adsets,
    ads,
    outcomes: state.outcomes,
    abortedBy: state.abortedBy,
    callCount: state.callCount,
    anyFailure: anyFailureOf(state.outcomes),
  };
}
