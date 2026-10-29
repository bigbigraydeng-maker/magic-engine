// Orchestrates one ad-breakdown capture run: read Meta, map, reconcile, upsert.
// Reads only — never calls a Meta write endpoint. English code/comments.

import type {
  GraphReadResult,
  GraphAccountDailySpendRow,
} from '@/lib/meta/entity-settings'
import type {
  AccountCaptureReceipt,
  BreakdownKey,
  BreakdownSpec,
  BreakdownStatRow,
  CaptureMode,
  CaptureReceipt,
  GraphBreakdownRow,
  SpendReconciliation,
} from './types'
import { accountYesterday } from '@/lib/ads-strategy/account-timezone'
import { BREAKDOWN_SPECS } from './specs'
import { mapBreakdownRows } from './map'
import { reconcileSpend } from './reconcile'
import {
  BreakdownTableMissingError,
  type BoundAccount,
  type BreakdownStore,
} from './store'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AD_BREAKDOWN_JOB = 'ad-breakdown-capture'
export const AD_BREAKDOWN_EVENT = 'ads.breakdown_stats.captured'

export const BACKFILL_DAYS = 120
export const STEADY_DAYS = 8
export const CHUNK_DAYS = 7
export const MAX_RECON_FAILURES_IN_RECEIPT = 20

/**
 * Stored history counts as deep enough when it starts within this many days of the account's first
 * spend day inside the backfill window. Small slack so an ad-level gap on the very first spend day
 * (e.g. an ad Meta no longer reports) cannot make every run re-pull the whole window.
 */
const BACKFILL_DEPTH_SLACK_DAYS = 2
const ERROR_TEXT_LIMIT = 300
const TABLE_MISSING = 'ad_breakdown_stats table missing (migration not applied)'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CaptureDeps {
  store: BreakdownStore
  getToken(clientId: string): Promise<string | null>
  resolveTimezone(adAccountId: string): Promise<string | null>
  fetchBreakdown(
    adAccountId: string,
    token: string,
    graphBreakdowns: string,
    since: string,
    until: string,
  ): Promise<GraphReadResult<GraphBreakdownRow>>
  fetchAccountDaily(
    adAccountId: string,
    token: string,
    since: string,
    until: string,
  ): Promise<GraphReadResult<GraphAccountDailySpendRow>>
  now(): Date
  newRequestId(): string
}

export interface CaptureOptions {
  mode: CaptureMode
  clientIds: readonly string[]
  specs?: readonly BreakdownSpec[]
  forceDays?: number
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function resolveCaptureMode(raw: string | undefined): CaptureMode {
  return raw?.trim() === 'live' ? 'live' : 'dry'
}

export function parseClientIds(raw: string | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Shift a 'YYYY-MM-DD' key by `delta` days on the UTC calendar. */
function shiftDay(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** Window ending yesterday in the account's timezone (same basis as daily-insights). */
export function captureWindow(
  days: number,
  timezone: string | null,
  now: Date,
): { since: string; until: string } {
  const until = accountYesterday(timezone, now)
  const since = shiftDay(until, -(days - 1))
  return { since, until }
}

export function chunkWindow(
  since: string,
  until: string,
  chunkDays: number,
): Array<{ since: string; until: string }> {
  const chunks: Array<{ since: string; until: string }> = []
  if (chunkDays <= 0) return chunks
  let cursor = since
  while (cursor <= until) {
    const end = shiftDay(cursor, chunkDays - 1)
    const chunkUntil = end > until ? until : end
    chunks.push({ since: cursor, until: chunkUntil })
    cursor = shiftDay(chunkUntil, 1)
  }
  return chunks
}

function toDailySpend(
  rows: readonly GraphAccountDailySpendRow[],
): Array<{ date: string; spend: number }> {
  const out: Array<{ date: string; spend: number }> = []
  for (const row of rows) {
    if (!row.date_start) continue
    const spend = parseFloat(row.spend ?? '')
    out.push({ date: row.date_start, spend: Number.isFinite(spend) ? spend : 0 })
  }
  return out
}

/** Earliest day with spend > 0, or null when the account spent nothing in the window. */
export function firstSpendDate(daily: ReadonlyArray<{ date: string; spend: number }>): string | null {
  let first: string | null = null
  for (const d of daily) {
    if (d.spend > 0 && (first === null || d.date < first)) first = d.date
  }
  return first
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function clip(text: string): string {
  return text.length > ERROR_TEXT_LIMIT ? text.slice(0, ERROR_TEXT_LIMIT) : text
}

// ---------------------------------------------------------------------------
// Per-spec read
// ---------------------------------------------------------------------------

interface SpecRead {
  key: BreakdownKey
  rows: BreakdownStatRow[]
  complete: boolean
  error: string | null
  skipped: number
  merged: number
}

interface AccountCtx {
  deps: CaptureDeps
  clientId: string
  adAccountId: string
  token: string
}

async function readSpec(
  ctx: AccountCtx,
  spec: BreakdownSpec,
  chunks: ReadonlyArray<{ since: string; until: string }>,
  fetchedAt: string,
): Promise<SpecRead> {
  const read: SpecRead = { key: spec.key, rows: [], complete: true, error: null, skipped: 0, merged: 0 }
  for (const chunk of chunks) {
    const result = await ctx.deps.fetchBreakdown(
      ctx.adAccountId, ctx.token, spec.graphBreakdowns, chunk.since, chunk.until,
    )
    if (result.complete !== true) {
      read.complete = false
      if (read.error === null) read.error = result.error ? result.error.message : 'incomplete read'
    }
    const mapped = mapBreakdownRows(result.rows ?? [], spec, {
      clientId: ctx.clientId,
      adAccountId: ctx.adAccountId,
      fetchedAt,
    })
    read.rows.push(...mapped.rows)
    read.skipped += mapped.skipped
    read.merged += mapped.merged
  }
  return read
}

// ---------------------------------------------------------------------------
// Backfill decision
// ---------------------------------------------------------------------------

interface DayPlan {
  days: number
  backfill: boolean
  note: string | null
}

/**
 * Live mode backfills a breakdown when its stored history does not reach back to the account's first
 * spend day in the backfill window. Comparing against first spend (not the window start) keeps young
 * accounts from re-pulling 120 days every run.
 */
async function resolveDays(
  ctx: AccountCtx,
  opts: CaptureOptions,
  specs: readonly BreakdownSpec[],
  timezone: string | null,
): Promise<DayPlan> {
  if (opts.forceDays !== undefined) return { days: opts.forceDays, backfill: false, note: null }
  if (opts.mode === 'dry') return { days: STEADY_DAYS, backfill: false, note: null }

  const window = captureWindow(BACKFILL_DAYS, timezone, ctx.deps.now())
  const daily = await ctx.deps.fetchAccountDaily(ctx.adAccountId, ctx.token, window.since, window.until)
  if (daily.complete !== true) {
    return { days: STEADY_DAYS, backfill: false, note: 'account daily spend read incomplete; backfill check skipped' }
  }
  const firstSpend = firstSpendDate(toDailySpend(daily.rows ?? []))
  if (firstSpend === null) return { days: STEADY_DAYS, backfill: false, note: null }

  const deepEnough = shiftDay(firstSpend, BACKFILL_DEPTH_SLACK_DAYS)
  for (const spec of specs) {
    const earliest = await ctx.deps.store.earliestStatDate(ctx.adAccountId, spec.key)
    if (earliest === null || earliest > deepEnough) {
      return { days: BACKFILL_DAYS, backfill: true, note: null }
    }
  }
  return { days: STEADY_DAYS, backfill: false, note: null }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

async function reconcile(
  ctx: AccountCtx,
  window: { since: string; until: string },
  rows: readonly BreakdownStatRow[],
  completeKeys: readonly BreakdownKey[],
): Promise<{ failures: SpendReconciliation[]; failedCount: number; note: string | null }> {
  const daily = await ctx.deps.fetchAccountDaily(ctx.adAccountId, ctx.token, window.since, window.until)
  if (daily.complete !== true) {
    return { failures: [], failedCount: 0, note: 'account daily spend read incomplete; reconciliation skipped' }
  }
  const failed = reconcileSpend(rows, toDailySpend(daily.rows ?? []), completeKeys).filter((r) => !r.ok)
  return { failures: failed.slice(0, MAX_RECON_FAILURES_IN_RECEIPT), failedCount: failed.length, note: null }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Data that did not reconcile (or could not be reconciled) is not trustworthy → partial, never ok.
 * A run where every read was complete but spend does not add up must not look green.
 */
export function pickStatus(
  reads: readonly SpecRead[],
  writeFailed: boolean,
  reconTrusted: boolean,
): AccountCaptureReceipt['status'] {
  if (writeFailed) return 'write_failed'
  const completeCount = reads.filter((r) => r.complete).length
  if (completeCount === 0) return 'read_failed'
  if (completeCount < reads.length || !reconTrusted) return 'partial'
  return 'ok'
}

// ---------------------------------------------------------------------------
// Per-account capture
// ---------------------------------------------------------------------------

function emptyReceipt(
  clientId: string,
  adAccountId: string,
  status: AccountCaptureReceipt['status'],
  error: string | null,
): AccountCaptureReceipt {
  return {
    client_id: clientId,
    ad_account_id: adAccountId,
    status,
    since: null,
    until: null,
    backfill: false,
    rows_by_key: {},
    rows_skipped: 0,
    rows_merged: 0,
    reconciliation_failures: [],
    error,
  }
}

/** Live writes only breakdowns whose whole window was read; a half-read window must not look like history. */
async function writeComplete(
  ctx: AccountCtx,
  reads: readonly SpecRead[],
): Promise<string | null> {
  const rows = reads.filter((r) => r.complete).flatMap((r) => r.rows)
  if (rows.length === 0) return null
  try {
    await ctx.deps.store.upsertRows(rows)
    return null
  } catch (err) {
    return err instanceof BreakdownTableMissingError ? TABLE_MISSING : errorText(err)
  }
}

async function captureAccount(
  ctx: AccountCtx,
  opts: CaptureOptions,
  specs: readonly BreakdownSpec[],
): Promise<AccountCaptureReceipt> {
  const timezone = await ctx.deps.resolveTimezone(ctx.adAccountId)
  let plan: DayPlan
  try {
    plan = await resolveDays(ctx, opts, specs, timezone)
  } catch (err) {
    if (err instanceof BreakdownTableMissingError) {
      return emptyReceipt(ctx.clientId, ctx.adAccountId, 'write_failed', TABLE_MISSING)
    }
    throw err
  }

  const window = captureWindow(plan.days, timezone, ctx.deps.now())
  const chunks = chunkWindow(window.since, window.until, CHUNK_DAYS)
  const fetchedAt = ctx.deps.now().toISOString()
  const reads: SpecRead[] = []
  for (const spec of specs) reads.push(await readSpec(ctx, spec, chunks, fetchedAt))

  const errorParts: string[] = plan.note ? [plan.note] : []
  for (const read of reads) {
    if (!read.complete && read.error) errorParts.push(`${read.key}: ${read.error}`)
  }
  const completeKeys = reads.filter((r) => r.complete).map((r) => r.key)
  const recon = await reconcile(ctx, window, reads.flatMap((r) => r.rows), completeKeys)
  if (recon.note) errorParts.push(recon.note)
  if (recon.failedCount > 0) errorParts.push(`spend reconciliation failed on ${recon.failedCount} day-breakdown pairs`)

  const writeError = opts.mode === 'live' ? await writeComplete(ctx, reads) : null
  if (writeError) errorParts.push(`write: ${writeError}`)

  return {
    client_id: ctx.clientId,
    ad_account_id: ctx.adAccountId,
    status: pickStatus(reads, writeError !== null, recon.note === null && recon.failedCount === 0),
    since: window.since,
    until: window.until,
    backfill: plan.backfill,
    rows_by_key: Object.fromEntries(reads.map((r) => [r.key, r.rows.length])),
    rows_skipped: reads.reduce((n, r) => n + r.skipped, 0),
    rows_merged: reads.reduce((n, r) => n + r.merged, 0),
    reconciliation_failures: recon.failures,
    error: errorParts.length > 0 ? clip(errorParts.join('; ')) : null,
  }
}

// ---------------------------------------------------------------------------
// Per-client capture
// ---------------------------------------------------------------------------

async function captureOne(
  deps: CaptureDeps,
  clientId: string,
  account: BoundAccount,
  opts: CaptureOptions,
  specs: readonly BreakdownSpec[],
): Promise<AccountCaptureReceipt> {
  if (account.hidden) return emptyReceipt(clientId, account.adAccountId, 'skipped', 'hidden_from_ad_health')
  try {
    const token = await deps.getToken(clientId)
    if (token === null) return emptyReceipt(clientId, account.adAccountId, 'no_token', null)
    return await captureAccount({ deps, clientId, adAccountId: account.adAccountId, token }, opts, specs)
  } catch (err) {
    return emptyReceipt(clientId, account.adAccountId, 'error', clip(errorText(err)))
  }
}

async function captureClient(
  deps: CaptureDeps,
  clientId: string,
  opts: CaptureOptions,
  specs: readonly BreakdownSpec[],
): Promise<{ receipts: AccountCaptureReceipt[]; problem: string | null }> {
  let accounts: BoundAccount[]
  try {
    accounts = await deps.store.listAccounts(clientId)
  } catch (err) {
    return { receipts: [emptyReceipt(clientId, '', 'error', clip(errorText(err)))], problem: null }
  }
  // A mistyped client id or an unbound client must not pass as a silent green run.
  if (accounts.length === 0) return { receipts: [], problem: `client ${clientId} has no bound Meta ad accounts` }

  const receipts: AccountCaptureReceipt[] = []
  for (const account of accounts) receipts.push(await captureOne(deps, clientId, account, opts, specs))
  return { receipts, problem: null }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runBreakdownCapture(
  deps: CaptureDeps,
  opts: CaptureOptions,
): Promise<CaptureReceipt> {
  const specs = opts.specs ?? BREAKDOWN_SPECS
  const startedAt = deps.now().toISOString()
  const problems: string[] = []
  if (opts.clientIds.length === 0) {
    problems.push('no clients configured (AD_BREAKDOWN_CLIENT_IDS empty)')
  }

  const accounts: AccountCaptureReceipt[] = []
  for (const clientId of opts.clientIds) {
    const { receipts, problem } = await captureClient(deps, clientId, opts, specs)
    accounts.push(...receipts)
    if (problem) problems.push(problem)
  }

  return {
    request_id: deps.newRequestId(),
    mode: opts.mode,
    started_at: startedAt,
    finished_at: deps.now().toISOString(),
    clients_requested: opts.clientIds.length,
    accounts_checked: accounts.length,
    accounts,
    cost: 0,
    no_publish: true,
    problems,
  }
}
