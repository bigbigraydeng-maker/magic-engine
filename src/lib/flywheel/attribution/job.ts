/**
 * Attribution Job — P12.A.8
 *
 * For every flywheel_action that has an expected_metric:
 *   1. Find the most recent flywheel_metrics row BEFORE the action (baseline).
 *   2. Find the most recent flywheel_metrics row AFTER the action and within
 *      window_days (after_value).
 *   3. Compute delta, delta_pct, verdict, and confidence.
 *   4. Upsert the outcome on its natural key (action_id, metric_key,
 *      window_days) so re-runs update one stable row instead of replacing it.
 *
 * Called by the attribution Cron route (P12.A.9).
 */

import { supabaseAdmin } from '../../supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import type { OutcomeVerdict } from '../adapters/types'
import { dualWindowEnabled } from './dual-window-gate'
import {
  OUTCOME_CONFLICT_TARGET,
  OUTCOME_EVALUATOR,
  foreignMetricPrefixes,
  resolveAttributionRouting,
} from './outcome-identity'

/**
 * Pass 1's default attribution window. Exported because the cron route must
 * forward the effective pass-1 window to the GSC bridge: actions this job
 * defers (expected_metric owned by the GSC evaluator) still need their answer
 * computed at THIS window, by the owner — otherwise deferral would silently
 * change which question gets answered. See Issue #859.
 */
export const DEFAULT_WINDOW_DAYS = 14

export interface AttributionJobOptions {
  /** Days after action.executed_at to look for an "after" metric. Default 14. */
  windowDays?: number
  /** Restrict to a single client (e.g. for manual reruns). */
  clientId?: string
}

export interface AttributionJobResult {
  processed: number
  written: number
  /**
   * Actions with nothing to attribute yet — no baseline, or no measurement
   * inside the window. Normal and expected; NOT a failure.
   */
  skipped: number
  /**
   * Actions whose attribution threw. Kept apart from `skipped` because the two
   * were indistinguishable before: a run in which every write failed (a missing
   * constraint, say) reported the same shape as a quiet day with no data, and
   * the cron logged it as completed with zero failures. See Issue #859.
   */
  failed: number
  /**
   * Actions whose expected_metric belongs to another evaluator's metric family.
   * Counted separately from `skipped` because nothing is wrong: the outcome is
   * another writer's to produce. Surfaced so "this metric is being handled
   * elsewhere" is visible in the cron summary instead of looking like a gap.
   */
  deferred: number
  /**
   * Clients pass 2 must visit because pass 1 did not fully handle them —
   * whether it deferred an action to the GSC evaluator or found one nobody can
   * attribute. The cron route runs pass 2 for every client listed here even if
   * their GSC connector is currently disconnected: the bridge reads historical
   * gsc_performance_snapshots, not the connector, so it can still answer (or
   * harmlessly skip). Without this, a client who disconnects GSC after their
   * actions matured would have outcomes deferred to a pass that never visits
   * them. Unattributable actions are included too — the bridge will not load
   * that particular action, but the client's other SEO actions are still its
   * to attribute, and dropping the client would take those with it.
   * (Codex P2 rounds 2 and 3 on PR #862.)
   */
  pass2ClientIds: string[]
  /**
   * Actions whose expected_metric belongs to an evaluator that cannot load
   * them — e.g. a GEO action promising `seo.gsc.clicks`, which the GSC bridge
   * (flywheel = 'seo' only) will never see. Nobody can attribute these: this
   * evaluator is forbidden to write them by the ownership CHECK, and the owner
   * cannot reach them. Counted and named rather than deferred, so the hole is
   * reported instead of manufactured. (Codex P2 round 3 on PR #862.)
   */
  unattributable: number
  /** First few unattributable action ids, for diagnosis. Bounded on purpose. */
  unattributableSamples: string[]
  /**
   * Reconciliation failures — claiming a row an older deployment left unsigned,
   * or retiring a non-authoritative window.
   *
   * Counted rather than logged because neither failure shows up anywhere else:
   * the action itself may still attribute perfectly, so `written` goes up,
   * `failed` stays 0, and the run reports healthy — while the unsigned row keeps
   * the contract migration blocked and the duplicated window keeps being counted
   * twice by the memory consumers. A finding that only reaches console.error is
   * the exact shape CLAUDE.md §3 forbids, and the GSC writer already reports its
   * equivalent. (Codex P1, round 18 on PR #862.)
   */
  reconcileErrors: number
  /** First few reconciliation error messages, for diagnosis. Bounded. */
  reconcileErrorSamples: string[]
}

/** How many reconciliation error messages to carry into the summary. */
const RECONCILE_ERROR_SAMPLE_LIMIT = 5

/** How many unattributable action ids to carry into the summary. */
const UNATTRIBUTABLE_SAMPLE_LIMIT = 10

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Load every action with an `expected_metric`, paginated.
 *
 * PostgREST caps one response at 1000 rows and reports no error. Truncation
 * here does not just skip work — `pass2ClientIds` is built from this set, so a
 * dropped `seo.gsc.*` action belonging to a GSC-disconnected client would leave
 * that client out of pass 2's list as well: pass 1 declines it on ownership,
 * pass 2 never visits, and the run still reports success.
 *
 * `flywheel`, `action_type` and `payload` are all routing inputs — owning a
 * metric is not the same as being able to load the action that promised it, and
 * loading it is not the same as producing the key it asked for.
 */
async function loadAttributableActions(
  options: AttributionJobOptions,
): Promise<ActionRow[]> {
  return fetchAll<ActionRow>((from, to) => {
    let query = supabaseAdmin
      .from('flywheel_actions')
      .select('id, client_id, flywheel, action_type, payload, expected_metric, expected_delta, executed_at')
      .not('expected_metric', 'is', null)
      // A stable, unique sort — `range` without one repeats or drops rows at
      // page boundaries.
      .order('id', { ascending: true })

    if (options.clientId) query = query.eq('client_id', options.clientId)

    return query.range(from, to)
  }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`runAttributionJob: failed to fetch actions — ${message}`)
  })
}

function emptyResult(): AttributionJobResult {
  return {
    processed: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
    pass2ClientIds: [],
    unattributable: 0,
    unattributableSamples: [],
    reconcileErrors: 0,
    reconcileErrorSamples: [],
  }
}

/**
 * What one action produced. Every branch of the loop returns one of these, so
 * counting happens in exactly one place and a new branch cannot forget to
 * report — which is how the deferral path went quiet until round 20.
 */
type ActionOutcome =
  | { kind: 'deferred' | 'unattributable' | 'written' | 'skipped'; reconcileErrors: string[] }
  | { kind: 'failed'; message: string }

/**
 * Arbitration plus attribution for a single action.
 *
 * An outcome belongs to whichever evaluator owns its metric family. Declining
 * here — rather than writing and letting the last writer win — is what keeps
 * execution order out of the answer. See Issue #859.
 *
 * Both declining branches still reconcile: declining means this evaluator
 * promises NOTHING for this action, which makes every row it already wrote
 * abandoned. Reachable through the correction this PR asks for — an SEO action
 * whose `expected_metric` moves from `seo.domain.organic_traffic` to
 * `seo.gsc.clicks`. Pass 1 hands it over, the bridge only ever retires keys in
 * its own vocabulary, so the old verdict used to be immortal.
 * (Codex P2, round 20 on PR #862.)
 */
async function attributeOne(
  action: ActionRow,
  windowDays: number,
): Promise<ActionOutcome> {
  const routing = resolveAttributionRouting(action)

  if (routing === 'defer') {
    return { kind: 'deferred', reconcileErrors: await reconcileLegacyWindows(action.id, null) }
  }

  if (routing === 'unattributable') {
    // Owned by an evaluator that cannot load this action. Deferring would
    // promise an answer nobody can give; writing it here is refused by the
    // ownership CHECK. Report it instead of quietly producing a hole.
    console.error(
      `Attribution job: action ${action.id} (flywheel=${action.flywheel}) promises ` +
        `"${action.expected_metric}", owned by an evaluator that does not load ` +
        `this flywheel — no evaluator can attribute it.`,
    )
    return { kind: 'unattributable', reconcileErrors: await reconcileLegacyWindows(action.id, null) }
  }

  try {
    const outcome = await processAction(action, windowDays)
    return {
      kind: outcome.wrote ? 'written' : 'skipped',
      reconcileErrors: outcome.reconcileErrors,
    }
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

export async function runAttributionJob(
  options: AttributionJobOptions = {}
): Promise<AttributionJobResult> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS
  const actions = await loadAttributableActions(options)
  if (!actions.length) return emptyResult()

  const r = emptyResult()
  const pass2Clients = new Set<string>()

  for (const action of actions) {
    const outcome = await attributeOne(action, windowDays)

    if (outcome.kind === 'failed') {
      console.error(`Attribution job: action ${action.id} — ${outcome.message}`)
      r.failed++
      continue
    }

    for (const msg of outcome.reconcileErrors) {
      r.reconcileErrors++
      if (r.reconcileErrorSamples.length < RECONCILE_ERROR_SAMPLE_LIMIT) {
        r.reconcileErrorSamples.push(`action ${action.id}: ${msg}`)
      }
      console.error(`Attribution job: action ${action.id} — ${msg}`)
    }

    if (outcome.kind === 'written') r.written++
    else if (outcome.kind === 'skipped') r.skipped++
    else {
      // Both declining kinds still need a pass-2 visit: the bridge cannot load
      // an unattributable action, but the client's other SEO actions are its to
      // attribute, and dropping the client would take those with it.
      if (outcome.kind === 'deferred') r.deferred++
      else {
        r.unattributable++
        if (r.unattributableSamples.length < UNATTRIBUTABLE_SAMPLE_LIMIT) {
          r.unattributableSamples.push(action.id)
        }
      }
      pass2Clients.add(action.client_id)
    }
  }

  r.processed = actions.length
  r.pass2ClientIds = Array.from(pass2Clients)
  return r
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface ActionRow {
  id: string
  client_id: string
  flywheel: string | null
  action_type: string | null
  payload: Record<string, unknown> | null
  expected_metric: string
  expected_delta: number | null
  executed_at: string
}

/** What one action's attribution produced, and what reconciliation could not do. */
interface ProcessActionResult {
  /** True when an outcome row was written. */
  wrote: boolean
  /** Reconciliation failures. Never suppresses the write; never counted as one. */
  reconcileErrors: string[]
}

/** Most recent `flywheel_metrics` value in a half-open window, or null. */
async function latestMetricValue(
  clientId: string,
  metricKey: string,
  bounds: { before?: string; from?: string; to?: string },
  label: string,
): Promise<number | null> {
  let query = supabaseAdmin
    .from('flywheel_metrics')
    .select('metric_value')
    .eq('client_id', clientId)
    .eq('metric_key', metricKey)

  if (bounds.before) query = query.lt('measured_at', bounds.before)
  if (bounds.from) query = query.gte('measured_at', bounds.from)
  if (bounds.to) query = query.lte('measured_at', bounds.to)

  const { data, error } = await query
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`${label} query: ${error.message}`)
  return data ? Number(data.metric_value) : null
}

/**
 * Write one outcome on its natural key.
 *
 * This used to be DELETE WHERE action_id = ? followed by INSERT, which did two
 * damaging things: it changed `flywheel_outcomes.id` on every 6-hourly run, so
 * nothing downstream could hold a stable reference to the same business
 * outcome; and because the delete was not scoped to this metric, it could wipe
 * the rows the GSC evaluator writes for the same action. See Issue #859.
 */
async function upsertOutcome(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('flywheel_outcomes')
    .upsert(row, { onConflict: OUTCOME_CONFLICT_TARGET })

  if (error) throw new Error(`outcome upsert: ${error.message}`)
}

/**
 * Attribute one action at one window.
 *
 * Reconciliation runs ahead of both metric lookups on purpose: an action with
 * no baseline, or no measurement yet, returns early below, and reconciling only
 * on the success path would leave a deploy-window row unsigned for as long as
 * the action stays immature. (Codex P2, round 16 on PR #862.)
 */
async function processAction(
  action: ActionRow,
  windowDays: number,
): Promise<ProcessActionResult> {
  const { id, client_id, expected_metric, expected_delta, executed_at } = action
  const executedAt = new Date(executed_at)
  const windowEnd = new Date(executedAt)
  windowEnd.setDate(windowEnd.getDate() + windowDays)

  const reconcileErrors = await reconcileLegacyWindows(id, expected_metric)

  const baseline = await latestMetricValue(
    client_id, expected_metric, { before: executedAt.toISOString() }, 'baseline',
  )
  if (baseline === null) return { wrote: false, reconcileErrors }

  const afterValue = await latestMetricValue(
    client_id,
    expected_metric,
    { from: executedAt.toISOString(), to: windowEnd.toISOString() },
    'after',
  )
  if (afterValue === null) return { wrote: false, reconcileErrors }  // too early

  const delta = afterValue - baseline
  const deltaPct = baseline !== 0 ? (delta / Math.abs(baseline)) * 100 : null
  const { verdict, confidence } = computeVerdict(delta, deltaPct, expected_delta)

  await upsertOutcome({
    action_id: id,
    client_id,
    metric_key: expected_metric,
    baseline,
    after_value: afterValue,
    delta,
    delta_pct: deltaPct,
    confidence,
    verdict,
    window_days: windowDays,
    evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
    computed_at: new Date().toISOString(),
  })

  // Only now: the authoritative row is in the database, so dropping the other
  // windows cannot leave this action with nothing.
  reconcileErrors.push(...await retireExtraWindows(id, expected_metric, windowDays))

  return { wrote: true, reconcileErrors }
}

/**
 * Bring one action's pre-#859 rows for this metric into line with what this
 * deployment stands behind. Mirror of the GSC evaluator's reconciliation; see
 * the long note on `reconcileLegacyWindows` in gsc-bridge.ts for why it exists.
 *
 * In short: the expand migration backfills `evaluator_key` once, at apply time,
 * while the old code keeps running against the expanded table until this PR
 * deploys — and the old cron accepted `?window_days=`. A row written at 21 days
 * inside that gap ends up unsigned, at a window this job will never recompute.
 *
 *   [1] CLAIM  — sign it, or the contract migration's `NULL count = 0`
 *                precondition can never be met.
 *   [2] RETIRE ABANDONED METRICS — drop our own rows for keys this action no
 *                longer promises. Ungated: a key it has stopped promising is
 *                wrong at every window.
 *   [3] RETIRE EXTRA WINDOWS — while dual-window is OFF, drop our own rows at any other
 *                window. Signing alone would leave the action holding two
 *                windows, which doubles its evidence for the memory consumers
 *                that still count rows — the harm the gate exists to prevent.
 *                On main this was impossible: every writer DELETEd by action
 *                before inserting. Removing that delete was necessary (it is
 *                what stopped the writers wiping each other), so single-window
 *                behaviour has to be restored deliberately while the gate is off.
 *
 * Runs BEFORE the baseline/after lookups, so an action with nothing to
 * attribute yet is still reconciled — otherwise a gap row would stay unsigned
 * for as long as its action stays immature. Scoped to this action, this metric,
 * and this evaluator; routing has already established we own `expected_metric`.
 *
 * Returned, never thrown: reconciliation debt must not be counted as a failed
 * attribution — the row this action writes is still correct — but it must not
 * vanish into a log either. The caller counts it into `reconcileErrors`, which
 * the cron run summary reports. (Codex P1, round 18 on PR #862.)
 */
async function reconcileLegacyWindows(
  actionId: string,
  metricKey: string | null,
): Promise<string[]> {
  return [
    ...await claimOwnUnsignedRows(actionId),
    ...await retireAbandonedMetrics(actionId, metricKey),
  ]
}

/**
 * Sign this evaluator's rows that an older deployment left unsigned.
 *
 * Claim by EXCLUSION of every foreign namespace, not by the current metric.
 * Claiming only `metric_key = expected_metric` leaves a hole the todo pipeline
 * itself opens: inside the expand→deploy gap the old writer produces an
 * unsigned row at metric A, then a human corrects the action to metric B —
 * which is what `action_unattributable` asks for. The A row is then claimed by
 * nobody (it is not the current metric) and deleted by nobody either, because
 * the abandoned-metric retire only matches rows already carrying this
 * evaluator's key. It would sit unsigned forever: still read as evidence, and
 * permanently blocking the contract migration's `evaluator_key IS NULL = 0`
 * gate. (Codex P2, round 21 on PR #862.)
 *
 * Excluding foreign prefixes rather than naming our own is what makes this
 * provable instead of inferred: no evaluator may write outside its own
 * namespace, so an unsigned row outside all of them can only be ours. The
 * reverse direction is deliberately NOT symmetric — the GSC evaluator claims
 * nothing, because a `seo.gsc.*` row could have come from either writer and no
 * query recovers which metric the action promised when it was written
 * (rounds 17 and 24).
 */
async function claimOwnUnsignedRows(actionId: string): Promise<string[]> {
  let claim = supabaseAdmin
    .from('flywheel_outcomes')
    .update({ evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS })
    .eq('action_id', actionId)
    .is('evaluator_key', null)

  for (const prefix of foreignMetricPrefixes(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)) {
    claim = claim.not('metric_key', 'like', `${prefix}%`)
  }

  const { error } = await claim
  return error ? [`claim unsigned outcomes: ${error.message}`] : []
}

/**
 * Withdraw this evaluator's rows for metrics the action no longer promises.
 * `metricKey === null` means it promises none of them — the deferral and
 * unattributable paths — so every row we own for it is abandoned.
 *
 * Not gated by the dual-window flag: a key the action has stopped promising is
 * wrong at EVERY window, not only the non-authoritative ones. This is the same
 * rule the GSC writer applies through `resolveStaleEvaluatorKeys`, and pass 1
 * lacked it because on main the action-wide DELETE took those rows out as a
 * side effect. Removing that delete was necessary; its one legitimate job has
 * to be done deliberately now — and it matters because the system actively asks
 * for `expected_metric` to be corrected.
 *
 * Scoped to our own `evaluator_key`, so it can never reach the GSC evaluator's
 * rows — including the three it legitimately writes for the same action at keys
 * that are not this action's expected_metric (135 such rows in production
 * today; correct output, not stale). (Codex P2, rounds 19 and 20 on PR #862.)
 */
async function retireAbandonedMetrics(
  actionId: string,
  metricKey: string | null,
): Promise<string[]> {
  const abandoned = supabaseAdmin
    .from('flywheel_outcomes')
    .delete()
    .eq('action_id', actionId)
    .eq('evaluator_key', OUTCOME_EVALUATOR.FLYWHEEL_METRICS)

  const { error } =
    metricKey === null ? await abandoned : await abandoned.neq('metric_key', metricKey)

  return error ? [`retire abandoned metric outcomes: ${error.message}`] : []
}

/**
 * Drop this evaluator's rows for `metricKey` at any window other than the
 * authoritative one — only AFTER the authoritative row has been written.
 *
 * Mirror of the GSC writer's `retireExtraWindows`, and moved here for the same
 * reason: run before the write, this deletes an action's only evidence in the
 * exact case where the replacement cannot be produced (no baseline yet, or no
 * measurement inside the window). Write-before-retire is the rule this Work
 * Package established for the upsert path, and the window retire has to obey it
 * too. (Codex P1, round 22 on PR #862.)
 */
async function retireExtraWindows(
  actionId: string,
  metricKey: string,
  authoritativeWindow: number,
): Promise<string[]> {
  if (dualWindowEnabled()) return []

  const { error } = await supabaseAdmin
    .from('flywheel_outcomes')
    .delete()
    .eq('action_id', actionId)
    .eq('metric_key', metricKey)
    .eq('evaluator_key', OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
    .neq('window_days', authoritativeWindow)

  return error ? [`retire non-authoritative windows: ${error.message}`] : []
}

// ── Verdict computation ───────────────────────────────────────────────────────

/**
 * Classify the outcome of an attribution window.
 *
 * Rules:
 *  - |delta_pct| < 3%   → inconclusive (noise floor)
 *  - expected_delta set → direction match = confirmed, mismatch = reversed
 *  - no expected_delta  → positive delta = confirmed, negative = reversed
 *  - confidence ∝ |delta_pct| / 20 (20 % change → full confidence, cap 0.95)
 */
export function computeVerdict(
  delta: number,
  deltaPct: number | null,
  expectedDelta: number | null
): { verdict: OutcomeVerdict; confidence: number } {
  const absPct = deltaPct !== null ? Math.abs(deltaPct) : 0

  if (absPct < 3) {
    return { verdict: 'inconclusive', confidence: 0.2 }
  }

  const confidence = round2(Math.min(0.95, absPct / 20))

  if (expectedDelta !== null && expectedDelta !== 0) {
    const expectedPositive = expectedDelta > 0
    const actualPositive = delta > 0

    if (expectedPositive === actualPositive) {
      return {
        verdict: confidence >= 0.35 ? 'confirmed' : 'inconclusive',
        confidence,
      }
    }
    return { verdict: 'reversed', confidence }
  }

  // No expected direction — use sign of actual delta
  return {
    verdict: delta > 0 ? 'confirmed' : 'reversed',
    confidence: round2(Math.min(0.7, absPct / 20)),
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
