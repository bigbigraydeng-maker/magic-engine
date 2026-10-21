// Orchestrator for the ad heartbeat.
// Reads via readHeartbeatAccount, decides via evaluateAccountRound,
// persists via HeartbeatStore. Never throws for a single account failure.
// English code/comments; short Chinese reason strings only.

import { readHeartbeatAccount } from './read';
import { evaluateAccountRound, type AlarmCandidate, type EvaluateContext, type HeartbeatState } from './evaluate';
import {
  HeartbeatTableMissingError,
  isTableMissingError,
  type BoundAccount,
  type HeartbeatStore,
  type OpenAlarm,
} from './store';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AD_HEARTBEAT_JOB = 'ad-heartbeat';
export const AD_HEARTBEAT_EVENT = 'ad.heartbeat.sampled';
export const AD_HEARTBEAT_PURGE_DAYS = 7;

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP']);
const MAX_ERROR_LEN = 300;

// ---------------------------------------------------------------------------
// Mode / client parsing
// ---------------------------------------------------------------------------

export type HeartbeatMode = 'off' | 'dry' | 'live';

export function resolveHeartbeatMode(raw: string | undefined): HeartbeatMode {
  if (raw === undefined) return 'dry';
  const v = raw.trim().toLowerCase();
  if (v === '') return 'dry';
  if (v === 'off' || v === 'dry' || v === 'live') return v;
  return 'off';
}

export function parseHeartbeatClientIds(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Receipt types
// ---------------------------------------------------------------------------

export type AccountRoundStatus =
  | 'ok'
  | 'read_failed'
  | 'aborted'
  | 'skipped_hidden'
  | 'no_token'
  | 'table_missing'
  | 'error';

export interface AccountRoundReceipt {
  ad_account_id: string;
  status: AccountRoundStatus;
  call_count: number;
  alarms: Array<{
    type: string;
    severity: string;
    key: string;
    object_id: string | null;
  }>;
  observations: Array<{
    type: string;
    reason: string;
    object_id: string | null;
  }>;
  wrote_state: boolean;
  alarms_inserted: number;
  alarms_updated: number;
  alarms_resolved: number;
  merged_summary: string | null;
  skipped_reason: string | null;
  error?: string;
}

export interface HeartbeatReceipt {
  request_id: string;
  job: string;
  mode: HeartbeatMode;
  started_at: string;
  finished_at: string;
  cost_usd: 0;
  no_publish: true;
  clients_checked: number;
  accounts_checked: number;
  table_missing: boolean;
  rounds: Array<{ client_id: string; accounts: AccountRoundReceipt[] }>;
  purged: number;
}

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface HeartbeatDeps {
  store: HeartbeatStore;
  getToken(clientId: string): Promise<string | null>;
  read: typeof readHeartbeatAccount;
  now(): Date;
  newRequestId(): string;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function truncate(msg: string): string {
  return msg.length > MAX_ERROR_LEN ? msg.slice(0, MAX_ERROR_LEN) : msg;
}

function emptyReceipt(
  requestId: string,
  mode: HeartbeatMode,
  startedAt: string,
  finishedAt: string,
): HeartbeatReceipt {
  return {
    request_id: requestId,
    job: AD_HEARTBEAT_JOB,
    mode,
    started_at: startedAt,
    finished_at: finishedAt,
    cost_usd: 0,
    no_publish: true,
    clients_checked: 0,
    accounts_checked: 0,
    table_missing: false,
    rounds: [],
    purged: 0,
  };
}

function baseAccountReceipt(
  adAccountId: string,
  status: AccountRoundStatus,
): AccountRoundReceipt {
  return {
    ad_account_id: adAccountId,
    status,
    call_count: 0,
    alarms: [],
    observations: [],
    wrote_state: false,
    alarms_inserted: 0,
    alarms_updated: 0,
    alarms_resolved: 0,
    merged_summary: null,
    skipped_reason: null,
  };
}

function errorReceipt(
  adAccountId: string,
  err: unknown,
): AccountRoundReceipt {
  const r = baseAccountReceipt(adAccountId, 'error');
  r.error = truncate(err instanceof Error ? err.message : String(err));
  return r;
}

function tableMissingReceipt(adAccountId: string): AccountRoundReceipt {
  return baseAccountReceipt(adAccountId, 'table_missing');
}

function isTableMissing(err: unknown): boolean {
  if (err instanceof HeartbeatTableMissingError) return true;
  if (err instanceof Error) {
    return isTableMissingError({ message: err.message });
  }
  return false;
}

function toAlarmReceipt(a: AlarmCandidate): AccountRoundReceipt['alarms'][number] {
  return {
    type: a.type,
    severity: a.severity,
    key: a.key,
    object_id: a.objectId,
  };
}

function toObservationReceipt(
  o: { type: string; reason: string; objectId: string | null },
): AccountRoundReceipt['observations'][number] {
  return { type: o.type, reason: o.reason, object_id: o.objectId };
}

function expectedCpmMinor(
  cpmMajor: number | null,
  currency: string | null,
): number | null {
  if (cpmMajor === null) return null;
  const cur = currency ? currency.trim().toUpperCase() : null;
  const factor = cur !== null && ZERO_DECIMAL_CURRENCIES.has(cur) ? 1 : 100;
  return cpmMajor * factor;
}

function statusFromRead(read: {
  abortedBy: string | null;
  anyFailure: boolean;
}): AccountRoundStatus {
  if (read.abortedBy !== null) return 'aborted';
  if (read.anyFailure) return 'read_failed';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface PersistArgs {
  store: HeartbeatStore;
  clientId: string;
  adAccountId: string;
  mode: HeartbeatMode;
  now: Date;
  state: HeartbeatState;
  alarms: AlarmCandidate[];
  observations: Array<{ type: string; reason: string; objectId: string | null }>;
  callCount: number;
  anyFailure: boolean;
}

interface PersistResult {
  wroteState: boolean;
  inserted: number;
  updated: number;
  resolved: number;
}

async function persistState(
  args: PersistArgs,
): Promise<boolean> {
  await args.store.upsertState(
    args.clientId,
    args.adAccountId,
    args.state,
    {
      observations: args.observations,
      call_count: args.callCount,
      mode: args.mode,
    },
    args.now,
  );
  return true;
}

async function persistAlarms(
  args: PersistArgs,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const alarm of args.alarms) {
    const outcome = await args.store.upsertAlarm(
      args.clientId,
      args.adAccountId,
      alarm,
      args.now,
    );
    if (outcome === 'inserted') inserted += 1;
    else updated += 1;
  }
  return { inserted, updated };
}

function keysToResolve(
  open: OpenAlarm[],
  currentKeys: Set<string>,
): string[] {
  const out: string[] = [];
  for (const o of open) {
    if (!currentKeys.has(o.key)) out.push(o.key);
  }
  return out;
}

async function persistRound(args: PersistArgs): Promise<PersistResult> {
  const wroteState = await persistState(args);
  if (args.mode !== 'live') {
    return { wroteState, inserted: 0, updated: 0, resolved: 0 };
  }

  const { inserted, updated } = await persistAlarms(args);

  let resolved = 0;
  if (!args.anyFailure) {
    const open = await args.store.listOpenAlarms(
      args.clientId,
      args.adAccountId,
    );
    const currentKeys = new Set(args.alarms.map((a) => a.key));
    const toResolve = keysToResolve(open, currentKeys);
    if (toResolve.length > 0) {
      resolved = await args.store.resolveAlarms(
        args.clientId,
        toResolve,
        args.now,
      );
    }
  }

  return { wroteState, inserted, updated, resolved };
}

// ---------------------------------------------------------------------------
// Per-account processing
// ---------------------------------------------------------------------------

interface AccountContext {
  deps: HeartbeatDeps;
  clientId: string;
  account: BoundAccount;
  token: string | null;
  mode: HeartbeatMode;
  now: Date;
}

async function readAndEvaluate(
  ctx: AccountContext,
): Promise<{
  read: Awaited<ReturnType<typeof readHeartbeatAccount>>;
  result: ReturnType<typeof evaluateAccountRound>;
}> {
  const { deps, clientId, account, token, now } = ctx;
  const accessToken = token as string;

  const active = await deps.store.hasActiveCampaigns(
    clientId,
    account.adAccountId,
  );
  const accountHasActiveCampaigns = active === null ? true : active;

  const cpmMajor = await deps.store.cpmMajor14d(
    clientId,
    account.adAccountId,
    now,
  );
  const prev = await deps.store.getState(clientId, account.adAccountId);

  const read = await deps.read({
    adAccountId: account.adAccountId,
    accessToken,
    now,
    accountHasActiveCampaigns,
    fetchers: undefined,
  });

  const evalCtx: EvaluateContext = {
    clientId,
    now,
    expectedCpmMinor: expectedCpmMinor(cpmMajor, read.currency),
    accountCapMinor: account.dailyCapCents,
    accountCapCurrency: read.currency,
    prev,
  };

  const result = evaluateAccountRound(read, evalCtx);
  return { read, result };
}

async function processAccount(
  ctx: AccountContext,
): Promise<AccountRoundReceipt> {
  if (ctx.account.hidden) {
    return baseAccountReceipt(ctx.account.adAccountId, 'skipped_hidden');
  }
  if (ctx.token === null) {
    return baseAccountReceipt(ctx.account.adAccountId, 'no_token');
  }

  try {
    const { read, result } = await readAndEvaluate(ctx);
    const receipt = baseAccountReceipt(
      ctx.account.adAccountId,
      statusFromRead(read),
    );
    receipt.call_count = read.callCount;
    receipt.alarms = result.alarms.map(toAlarmReceipt);
    receipt.observations = result.observations.map(toObservationReceipt);
    receipt.merged_summary = result.mergedSummary;
    receipt.skipped_reason = result.skippedReason;

    const persisted = await persistRound({
      store: ctx.deps.store,
      clientId: ctx.clientId,
      adAccountId: ctx.account.adAccountId,
      mode: ctx.mode,
      now: ctx.now,
      state: result.nextState,
      alarms: result.alarms,
      observations: result.observations,
      callCount: read.callCount,
      anyFailure: read.anyFailure,
    });
    receipt.wrote_state = persisted.wroteState;
    receipt.alarms_inserted = persisted.inserted;
    receipt.alarms_updated = persisted.updated;
    receipt.alarms_resolved = persisted.resolved;
    return receipt;
  } catch (err) {
    if (isTableMissing(err)) {
      return tableMissingReceipt(ctx.account.adAccountId);
    }
    return errorReceipt(ctx.account.adAccountId, err);
  }
}

// ---------------------------------------------------------------------------
// Per-client processing
// ---------------------------------------------------------------------------

interface ClientRound {
  client_id: string;
  accounts: AccountRoundReceipt[];
}

async function processClient(
  deps: HeartbeatDeps,
  clientId: string,
  mode: HeartbeatMode,
  now: Date,
): Promise<ClientRound> {
  let accounts: BoundAccount[];
  try {
    accounts = await deps.store.listAccounts(clientId);
  } catch (err) {
    if (isTableMissing(err)) {
      return { client_id: clientId, accounts: [tableMissingReceipt('*')] };
    }
    return { client_id: clientId, accounts: [errorReceipt('*', err)] };
  }

  let token: string | null = null;
  try {
    token = await deps.getToken(clientId);
  } catch (err) {
    return {
      client_id: clientId,
      accounts: accounts.map((a) => errorReceipt(a.adAccountId, err)),
    };
  }

  const out: AccountRoundReceipt[] = [];
  for (const account of accounts) {
    const receipt = await processAccount({
      deps,
      clientId,
      account,
      token,
      mode,
      now,
    });
    out.push(receipt);
  }
  return { client_id: clientId, accounts: out };
}

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

async function purgeIfLive(
  deps: HeartbeatDeps,
  mode: HeartbeatMode,
  now: Date,
): Promise<{ purged: number; tableMissing: boolean }> {
  if (mode !== 'live') return { purged: 0, tableMissing: false };
  try {
    const purged = await deps.store.purgeResolved(now, AD_HEARTBEAT_PURGE_DAYS);
    return { purged, tableMissing: false };
  } catch (err) {
    if (isTableMissing(err)) return { purged: 0, tableMissing: true };
    return { purged: 0, tableMissing: false };
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function countAccounts(rounds: ClientRound[]): number {
  let n = 0;
  for (const r of rounds) n += r.accounts.length;
  return n;
}

function anyTableMissing(rounds: ClientRound[]): boolean {
  for (const r of rounds) {
    for (const a of r.accounts) {
      if (a.status === 'table_missing') return true;
    }
  }
  return false;
}

export async function runAdHeartbeat(
  deps: HeartbeatDeps,
  opts: { mode: HeartbeatMode; clientIds: string[] },
): Promise<HeartbeatReceipt> {
  const requestId = deps.newRequestId();
  const startedAt = deps.now().toISOString();

  if (opts.mode === 'off' || opts.clientIds.length === 0) {
    return emptyReceipt(
      requestId,
      opts.mode,
      startedAt,
      deps.now().toISOString(),
    );
  }

  const now = deps.now();
  const rounds: ClientRound[] = [];
  for (const clientId of opts.clientIds) {
    const round = await processClient(deps, clientId, opts.mode, now);
    rounds.push(round);
  }

  const purge = await purgeIfLive(deps, opts.mode, now);

  return {
    request_id: requestId,
    job: AD_HEARTBEAT_JOB,
    mode: opts.mode,
    started_at: startedAt,
    finished_at: deps.now().toISOString(),
    cost_usd: 0,
    no_publish: true,
    clients_checked: rounds.length,
    accounts_checked: countAccounts(rounds),
    table_missing: anyTableMissing(rounds) || purge.tableMissing,
    rounds,
    purged: purge.purged,
  };
}
