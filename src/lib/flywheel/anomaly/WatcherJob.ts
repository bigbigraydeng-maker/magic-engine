/**
 * WatcherJob — the I/O shell around the three standing watchers.
 *
 * Design split, on purpose:
 *   watchers/*.ts  pure judgement, no database, fully testable
 *   WatcherJob.ts  fetch → hand to the pure rules → persist
 *
 * Thresholds are the whole product here, so they must be testable without a
 * database, and replayable over real history. `runWatchersOverSnapshot` is the
 * pure core; `runClientWatchers` is the same thing with the fetching attached.
 */

import { supabaseAdmin } from '../../supabase'
import { fetchServicedClients, type RosterClient } from './roster'
import { inspectAdEntity } from './watchers/adDeliveryWatcher'
import { detectContentDrought } from './watchers/contentSupplyWatcher'
import { detectUncheckedPageHandover } from './watchers/pageHandoverWatcher'
import type { AdEntityHistory, WatchSignal } from './watchers/types'

/**
 * Ad data lags roughly a day behind real time, so every judgement is anchored
 * to the newest insight_date we actually hold rather than to "today".
 * Conflating the two silently shifts every "how many days" number by one.
 */
export interface ClientSnapshot {
  client: RosterClient
  /** Campaign-level delivery history, oldest first. */
  adHistories: AdEntityHistory[]
  /** Newest insight_date held for this client, or null when they run no ads. */
  observedThrough: string | null
  /** Newest content production date across all content tables. */
  lastContentAt: string | null
  /** Whether we run a content line for this client at all — see below. */
  contentExpected: boolean
  /** Average daily spend over the client's last 7 spending days. */
  recentDailyAdSpendAud: number
  /**
   * First date ad spend was ever recorded for this client — the clock the page
   * handover check runs on. Null when they have never spent.
   */
  firstAdSpendDate: string | null
  /** True when page-automation-unverified has already fired for this client. */
  pageAlreadyChecked: boolean
}

export interface WatcherRunResult {
  scannedClients: number
  signalsDetected: number
  signalsPersisted: number
  excludedClients: { id: string; name: string; clientStatus: string }[]
  errors: string[]
}

const AD_HISTORY_DAYS = 45

// ── Pure core ─────────────────────────────────────────────────────────────────

/**
 * Decide whether a client is on a content line.
 *
 * v1 rule: they are, if anything has ever been produced for them.
 *
 * This is evidence, not taxonomy, and it is a deliberate stand-in. ME has no
 * field that records "Type A (six pillars) vs Type B (one property, leads
 * only)". Inventing one needs both a migration and a Settings control, so it is
 * proposed to the PM rather than smuggled in here.
 *
 * The stand-in is correct for every client on the books today: 30 Kiteroa,
 * Parkhomes and Magic Engine have never had content produced, so they are never
 * flagged for its absence; CTS, Oztop, Magic Lab and Magic Lab Class have, so
 * they are watched. Its known weakness is that one stray draft for a Type B
 * client would enrol them — which is exactly what the proposed
 * `clients.client_type` column fixes.
 */
export function resolveContentExpectation(lastContentAt: string | null): boolean {
  return lastContentAt !== null
}

/**
 * Run all three watchers over one already-fetched snapshot.
 *
 * Pure: no database, no clock. `today` is injected so both the tests and the
 * historical replay can place themselves at any date.
 */
export function runWatchersOverSnapshot(
  snapshot: ClientSnapshot,
  today: string
): WatchSignal[] {
  const { client } = snapshot
  const attach = (
    partial: Omit<WatchSignal, 'clientId' | 'clientName'>
  ): WatchSignal => ({ ...partial, clientId: client.id, clientName: client.name })

  const out: WatchSignal[] = []

  // Hand 1 — ad delivery. Each rule relates the run date to its own data: the
  // performance rules refuse to judge stale rows, the blackout rule measures
  // the gap from the last spending day to now.
  for (const history of snapshot.adHistories) {
    for (const signal of inspectAdEntity(history, today)) {
      out.push(attach(signal))
    }
  }

  // Hand 2 — content supply.
  const drought = detectContentDrought(
    {
      clientId: client.id,
      clientName: client.name,
      clientCreatedAt: client.createdAt,
      lastActivityDate: snapshot.lastContentAt,
      recentDailyAdSpendAud: snapshot.recentDailyAdSpendAud,
      contentExpected: snapshot.contentExpected,
    },
    today
  )
  if (drought) out.push(attach(drought))

  // Hand 3 — newly adopted Page health.
  const handover = detectUncheckedPageHandover(
    {
      clientId: client.id,
      clientName: client.name,
      clientCreatedAt: client.createdAt,
      facebookPageId: client.facebookPageId,
      metaAdAccountId: client.metaAdAccountId,
      firstAdSpendDate: snapshot.firstAdSpendDate,
      recentDailyAdSpendAud: snapshot.recentDailyAdSpendAud,
      alreadyChecked: snapshot.pageAlreadyChecked,
    },
    today
  )
  if (handover) out.push(attach(handover))

  return out
}

// ── Fetching ──────────────────────────────────────────────────────────────────

interface AdRow {
  entity_id: string | null
  entity_name: string | null
  insight_date: string
  spend: number | string | null
  results: number | null
  leads: number | null
  impressions: number | null
}

function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Group raw campaign rows into per-entity histories, oldest first.
 *
 * Campaign level only. ad_daily_insights stores campaign AND ad rows for the
 * same delivery, so including both would double-count spend and fire the same
 * anomaly twice under two names.
 */
export function groupAdHistories(rows: AdRow[]): AdEntityHistory[] {
  const byEntity = new Map<string, AdEntityHistory>()

  for (const row of rows) {
    const entityId = row.entity_id ?? row.entity_name ?? 'unknown'
    let history = byEntity.get(entityId)
    if (!history) {
      history = {
        entityId,
        entityName: row.entity_name ?? entityId,
        days: [],
      }
      byEntity.set(entityId, history)
    }
    history.days.push({
      insightDate: row.insight_date.slice(0, 10),
      spend: num(row.spend),
      results: num(row.results),
      leads: num(row.leads),
      impressions: num(row.impressions),
    })
  }

  // Array.from rather than spreading/iterating the Map directly: tsconfig sets
  // no `target`, so TS defaults to ES5 and rejects Map iterators without
  // --downlevelIteration.
  const histories = Array.from(byEntity.values())
  for (const history of histories) {
    history.days.sort((a, b) => a.insightDate.localeCompare(b.insightDate))
  }

  return histories
}

/** Average daily spend across the last 7 days that actually spent. */
export function averageRecentDailySpend(histories: AdEntityHistory[]): number {
  const byDate = new Map<string, number>()
  for (const history of histories) {
    for (const day of history.days) {
      if (day.spend <= 0) continue
      byDate.set(day.insightDate, (byDate.get(day.insightDate) ?? 0) + day.spend)
    }
  }
  const recent = Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-7)
    .map(([, spend]) => spend)

  if (recent.length === 0) return 0
  const total = recent.reduce((sum, value) => sum + value, 0)
  return Math.round((total / recent.length) * 100) / 100
}

async function fetchAdHistories(
  clientId: string,
  since: string
): Promise<{ histories: AdEntityHistory[]; observedThrough: string | null }> {
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('entity_id, entity_name, insight_date, spend, results, leads, impressions')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .gte('insight_date', since)
    .order('insight_date', { ascending: true })

  if (error) throw new Error(`ad_daily_insights: ${error.message}`)

  const rows = (data ?? []) as AdRow[]
  const histories = groupAdHistories(rows)
  const observedThrough = rows.length
    ? rows.map(r => r.insight_date.slice(0, 10)).sort().slice(-1)[0]
    : null

  return { histories, observedThrough }
}

/** Newest production date across every table that counts as "we did work". */
async function fetchLastContentAt(clientId: string): Promise<string | null> {
  const tables = ['flywheel_actions', 'reels_drafts', 'content_posts'] as const
  let latest: string | null = null

  for (const table of tables) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)

    // A missing/renamed content table must not silently read as "in drought".
    if (error) throw new Error(`${table}: ${error.message}`)

    const at = (data ?? [])[0]?.created_at
    if (at && (!latest || at > latest)) latest = at
  }

  return latest ? latest.slice(0, 10) : null
}

/**
 * The all-time first day this client recorded ad spend.
 *
 * Deliberately NOT limited to the rolling history window: the page handover
 * check needs to know whether traffic started 3 days ago or 3 months ago, and a
 * windowed query would make every long-running client look brand new.
 */
async function fetchFirstAdSpendDate(clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select('insight_date')
    .eq('client_id', clientId)
    .eq('level', 'campaign')
    .gt('spend', 0)
    .order('insight_date', { ascending: true })
    .limit(1)

  if (error) throw new Error(`ad_daily_insights first spend: ${error.message}`)

  const first = (data ?? [])[0]?.insight_date
  return first ? first.slice(0, 10) : null
}

async function fetchPageAlreadyChecked(clientId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('anomaly_signals')
    .select('id')
    .eq('client_id', clientId)
    .eq('rule_id', 'page-automation-unverified')
    .limit(1)

  if (error) throw new Error(`anomaly_signals lookup: ${error.message}`)
  return (data ?? []).length > 0
}

/** Assemble everything the pure rules need for one client. */
export async function buildClientSnapshot(
  client: RosterClient,
  today: string
): Promise<ClientSnapshot> {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - AD_HISTORY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const [{ histories, observedThrough }, lastContentAt, firstAdSpendDate, pageAlreadyChecked] =
    await Promise.all([
      fetchAdHistories(client.id, since),
      fetchLastContentAt(client.id),
      fetchFirstAdSpendDate(client.id),
      fetchPageAlreadyChecked(client.id),
    ])

  return {
    client,
    adHistories: histories,
    observedThrough,
    lastContentAt,
    contentExpected: resolveContentExpectation(lastContentAt),
    recentDailyAdSpendAud: averageRecentDailySpend(histories),
    firstAdSpendDate,
    pageAlreadyChecked,
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Run the standing watchers across every serviced client.
 *
 * Throws if the roster cannot be built — a detector that cannot name its
 * clients has not "found nothing", it is blind, and the caller must record a
 * failure. Per-client errors are collected rather than thrown so one broken
 * client does not blind the other seven.
 */
export async function runWatchers(today?: string): Promise<WatcherRunResult> {
  const runDate = today ?? new Date().toISOString().slice(0, 10)
  const { clients, excluded } = await fetchServicedClients()

  const errors: string[] = []
  let signalsDetected = 0
  let signalsPersisted = 0

  for (const client of clients) {
    try {
      const snapshot = await buildClientSnapshot(client, runDate)
      const signals = runWatchersOverSnapshot(snapshot, runDate)
      signalsDetected += signals.length
      signalsPersisted += await persistWatchSignals(signals, errors)
    } catch (err) {
      errors.push(
        `client ${client.name} (${client.id}): ` +
          `${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return {
    scannedClients: clients.length,
    signalsDetected,
    signalsPersisted,
    excludedClients: excluded,
    errors,
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

/**
 * Map a WatchSignal onto an anomaly_signals row.
 *
 * anomaly_signals was built for the value-threshold engine: it has
 * current_value / reference_value / delta_pct and nothing for the three facts a
 * watcher produces (what changed / how much money / how long). The columns that
 * carry those are proposed in
 * supabase/migrations/20260802120000_anomaly_signals_watcher_fields.sql, which
 * is NOT applied — migrations are the PM's call.
 *
 * So the row is written in two halves. The legacy half always goes in, with the
 * full human-readable finding packed into `description` so no fact is lost
 * before the migration lands. The watcher half is added on top and dropped
 * automatically if the columns are not there yet (see persistWatchSignals).
 */
export function toLegacyRow(signal: WatchSignal): Record<string, unknown> {
  return {
    client_id: signal.clientId,
    flywheel: signal.flywheel,
    metric_key: `watcher.${signal.watcherId}`,
    rule_id: signal.ruleId,
    severity: signal.severity,
    // Legacy numeric triplet. The watcher's real payload is money and days, so
    // money goes in current_value and the numbers are honest about their unit
    // via description rather than pretending to be a metric delta.
    current_value: signal.moneyImpactAud,
    reference_value: 0,
    delta_pct: 0,
    description:
      `${signal.whatChanged} | 影响金额 A$${signal.moneyImpactAud} ` +
      `(${signal.moneyBasis}) | 已持续 ${signal.daysOngoing} 天 | ` +
      `处置: ${signal.disposition === 'auto' ? '可自动' : '需人工批准'} — ` +
      `${signal.dispositionReason}` +
      (signal.requiresManualVerification ? ' | ⚠️ 未经系统验证，需人工确认一次' : ''),
    status: 'fresh' as const,
  }
}

/** The forward-compatible half — only written once the migration is applied. */
export function toWatcherFields(signal: WatchSignal): Record<string, unknown> {
  return {
    watcher_id: signal.watcherId,
    entity_id: signal.entityId,
    entity_name: signal.entityName,
    what_changed: signal.whatChanged,
    money_impact_aud: signal.moneyImpactAud,
    money_basis: signal.moneyBasis,
    days_ongoing: signal.daysOngoing,
    disposition: signal.disposition,
    disposition_reason: signal.dispositionReason,
    observed_through: signal.observedThrough,
    requires_manual_verification: signal.requiresManualVerification ?? false,
  }
}

/** Postgres/PostgREST signalling "that column isn't there". */
function isUnknownColumnError(message: string): boolean {
  return /column .* does not exist|could not find the .* column/i.test(message)
}

/**
 * Insert new signals, skipping ones already recorded today.
 *
 * Dedup key is (client_id, rule_id, entity_id) for the current day: the same
 * campaign going dark should be one standing item, not a new alert every run,
 * but two different campaigns going dark are two findings.
 */
export async function persistWatchSignals(
  signals: WatchSignal[],
  errors: string[]
): Promise<number> {
  if (signals.length === 0) return 0

  const today = new Date().toISOString().slice(0, 10)
  const clientId = signals[0].clientId

  const { data: existing, error: readError } = await supabaseAdmin
    .from('anomaly_signals')
    .select('rule_id, description')
    .eq('client_id', clientId)
    .eq('status', 'fresh')
    .gte('detected_at', `${today}T00:00:00Z`)

  if (readError) {
    errors.push(`persistWatchSignals dedupe (${clientId}): ${readError.message}`)
    return 0
  }

  // Entity is not a legacy column, so identity is matched on rule + entity name
  // as it appears in the description. Once the migration lands this becomes a
  // plain (rule_id, entity_id) comparison.
  const seen = new Set(
    (existing ?? []).map(
      row => `${row.rule_id}::${extractEntityTag(row.description as string | null)}`
    )
  )

  const fresh = signals.filter(
    signal => !seen.has(`${signal.ruleId}::${signal.entityName ?? ''}`)
  )
  if (fresh.length === 0) return 0

  const full = fresh.map(signal => ({ ...toLegacyRow(signal), ...toWatcherFields(signal) }))
  const { error } = await supabaseAdmin.from('anomaly_signals').insert(full)
  if (!error) return fresh.length

  // Migration not applied yet — fall back to the legacy columns. Nothing is
  // lost: description already carries the full finding in plain language.
  if (isUnknownColumnError(error.message)) {
    const legacy = fresh.map(toLegacyRow)
    const { error: legacyError } = await supabaseAdmin.from('anomaly_signals').insert(legacy)
    if (legacyError) {
      errors.push(`persistWatchSignals (${clientId}): ${legacyError.message}`)
      return 0
    }
    return fresh.length
  }

  errors.push(`persistWatchSignals (${clientId}): ${error.message}`)
  return 0
}

/** Pull the quoted entity name back out of a legacy description string. */
export function extractEntityTag(description: string | null): string {
  if (!description) return ''
  const match = description.match(/"([^"]+)"/)
  return match ? match[1] : ''
}
