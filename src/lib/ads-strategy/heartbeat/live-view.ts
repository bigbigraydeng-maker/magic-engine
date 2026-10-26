/**
 * "今日实时" view of the OFFICIAL ad account(s), built from one heartbeat read (readHeartbeatAccount).
 * Read-only. A value that could not be read is null, never 0: the page says "读不到".
 * Hidden accounts are not read here (their money risk stays with the tracking check, see ledger).
 */
import { readHeartbeatAccount, type HeartbeatAccountRead, type HeartbeatAdsetSample } from './read';

export const LIVE_CACHE_TTL_MS = 60_000;
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP']);
/** Statuses that count as "running today" for the main list. */
const LIVE_STATUSES = new Set(['ACTIVE']);

export interface LiveAdset {
  adsetId: string;
  name: string | null;
  status: string | null;
  /** Account currency, major units. null = could not be read. */
  spendToday: number | null;
  impressionsToday: number | null;
  /** null when the budget sits on the campaign (CBO) or was not returned. */
  dailyBudget: number | null;
  budgetLevel: 'adset' | 'campaign';
  createdToday: boolean;
  adCount: number;
}

export interface LiveAccountView {
  adAccountId: string;
  /** ok = fully read; partial = some reads failed (numbers may be missing); unreadable = nothing usable. */
  readState: 'ok' | 'partial' | 'unreadable';
  reason: string | null;
  currency: string | null;
  accountDay: string | null;
  /** Account day-start based "created or started today". */
  active: LiveAdset[];
  newToday: LiveAdset[];
}

export interface LiveTodayView {
  readAtIso: string;
  accounts: LiveAccountView[];
}

function toMajor(minor: number | null, currency: string | null): number | null {
  if (minor === null) return null;
  const cur = currency ? currency.trim().toUpperCase() : null;
  const factor = cur !== null && ZERO_DECIMAL_CURRENCIES.has(cur) ? 1 : 100;
  return minor / factor;
}

/** "Today" in the account's own day: compare the date part in the account timezone. */
function isToday(iso: string | null, accountDay: string | null, timezone: string | null): boolean {
  if (iso === null || accountDay === null || timezone === null) return false;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
  return day === accountDay;
}

function toLiveAdset(
  a: HeartbeatAdsetSample,
  read: HeartbeatAccountRead,
  adCount: number,
): LiveAdset {
  return {
    adsetId: a.adsetId,
    name: a.name,
    status: a.effectiveStatus,
    spendToday: toMajor(a.spendTodayMinor, read.currency),
    impressionsToday: a.impressionsToday,
    dailyBudget: a.budgetLevel === 'adset' ? toMajor(a.dailyBudgetMinor, read.currency) : null,
    budgetLevel: a.budgetLevel,
    createdToday:
      isToday(a.createdTime, read.accountDay, read.timezone) ||
      isToday(a.startTime, read.accountDay, read.timezone),
    adCount,
  };
}

function reasonOf(read: HeartbeatAccountRead): string | null {
  const bad = read.outcomes.filter(
    (o) => o.verdict === 'read_failed' || o.verdict === 'token_expired' || o.verdict === 'rate_limited',
  );
  if (bad.length === 0 && read.abortedBy === null) return null;
  if (read.abortedBy === 'token_expired') return 'Meta 授权过期，读不到';
  if (read.abortedBy === 'rate_limited') return 'Meta 限流，稍后再试';
  return `这些读取失败：${bad.map((o) => o.kind).join('、')}`;
}

/** Pure: shape one account read for the page. */
export function buildLiveAccountView(read: HeartbeatAccountRead): LiveAccountView {
  const adCounts = new Map<string, number>();
  for (const ad of read.ads) {
    if (ad.adsetId) adCounts.set(ad.adsetId, (adCounts.get(ad.adsetId) ?? 0) + 1);
  }
  const all = read.adsets.map((a) => toLiveAdset(a, read, adCounts.get(a.adsetId) ?? 0));
  const adsetsOk = !read.outcomes.some(
    (o) =>
      o.kind === 'adsets' &&
      o.verdict !== 'ok' &&
      o.verdict !== 'empty_but_ok' &&
      o.verdict !== 'skipped',
  );
  const readState: LiveAccountView['readState'] =
    read.abortedBy !== null || !adsetsOk ? 'unreadable' : read.anyFailure ? 'partial' : 'ok';
  return {
    adAccountId: read.adAccountId,
    readState,
    reason: reasonOf(read),
    currency: read.currency,
    accountDay: read.accountDay,
    active: all.filter((a) => a.status !== null && LIVE_STATUSES.has(a.status)),
    newToday: all.filter((a) => a.createdToday),
  };
}

export function unreadableAccountView(adAccountId: string, reason: string): LiveAccountView {
  return {
    adAccountId,
    readState: 'unreadable',
    reason,
    currency: null,
    accountDay: null,
    active: [],
    newToday: [],
  };
}

// ---------------------------------------------------------------------------
// 60-second in-memory cache, per client.
// Acceptable because: each Render instance keeps its own map (no sharing across instances or
// restarts), so the worst case is one Meta read set (<= 4 calls per account) per instance per
// 60s per client no matter how many people refresh the page. It is a read-only staff page.
// ---------------------------------------------------------------------------

interface CacheEntry {
  at: number;
  value: LiveTodayView;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<LiveTodayView>>();

export function clearLiveCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

export interface LiveDeps {
  listOfficialAccountIds(clientId: string): Promise<string[]>;
  getToken(clientId: string): Promise<string | null>;
  read: typeof readHeartbeatAccount;
  now(): Date;
}

async function buildFresh(clientId: string, deps: LiveDeps): Promise<LiveTodayView> {
  const now = deps.now();
  const ids = await deps.listOfficialAccountIds(clientId);
  const token = await deps.getToken(clientId);
  const accounts: LiveAccountView[] = [];
  for (const id of ids) {
    if (token === null) {
      accounts.push(unreadableAccountView(id, '没有可用的 Meta 授权，读不到'));
      continue;
    }
    try {
      const read = await deps.read({
        adAccountId: id,
        accessToken: token,
        now,
        accountHasActiveCampaigns: true,
      });
      accounts.push(buildLiveAccountView(read));
    } catch {
      accounts.push(unreadableAccountView(id, '读取出错，读不到'));
    }
  }
  return { readAtIso: now.toISOString(), accounts };
}

export async function getLiveToday(clientId: string, deps: LiveDeps): Promise<LiveTodayView> {
  const nowMs = deps.now().getTime();
  const hit = cache.get(clientId);
  if (hit && nowMs - hit.at < LIVE_CACHE_TTL_MS) return hit.value;
  const pending = inflight.get(clientId);
  if (pending) return pending;
  const p = buildFresh(clientId, deps)
    .then((value) => {
      cache.set(clientId, { at: nowMs, value });
      return value;
    })
    .finally(() => inflight.delete(clientId));
  inflight.set(clientId, p);
  return p;
}
