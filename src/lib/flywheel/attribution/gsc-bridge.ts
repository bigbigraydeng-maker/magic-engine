/**
 * GSC Attribution Bridge — P17.A.4
 *
 * Computes flywheel attribution for SEO actions using Google Search Console
 * snapshot data as the signal source (instead of the generic flywheel_metrics).
 *
 * Algorithm per SEO action:
 *   baseline = most recent gsc_performance_snapshots where period_end <= executed_at
 *   after    = most recent gsc_performance_snapshots where period_end >= executed_at + window_days
 *
 * Writes three flywheel_outcomes rows per action:
 *   seo.gsc.clicks      → after.total_clicks - baseline.total_clicks
 *   seo.gsc.impressions → after.total_impressions - baseline.total_impressions
 *   seo.gsc.avg_position → baseline.avg_position - after.avg_position
 *                          (inverted: lower position number = better, so improvement = positive delta)
 *
 * Reference: ROADMAP.md P17.A.4
 */

import { supabaseAdmin } from '@/lib/supabase'
import { fetchAll } from '@/lib/supabase-paginate'
import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { dualWindowEnabled } from './dual-window-gate'
import { computeVerdict } from './job'
import {
  GSC_DOMAIN_METRIC_KEYS,
  GSC_EVALUATOR_METRIC_KEYS,
  OUTCOME_CONFLICT_TARGET,
  OUTCOME_EVALUATOR,
  assertEvaluatorOwnsAll,
  evaluatorLoadableFlywheels,
  resolveAttributionRouting,
  resolveStaleEvaluatorKeys,
} from './outcome-identity'
import {
  findGscPage,
  resolveGscAttributionScope,
  type GscPagePerformance,
} from './gsc-page-scope'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscSnapshotRow {
  period_end:        string
  total_clicks:      number
  total_impressions: number
  avg_position:      number
  top_pages:         GscPagePerformance[] | null
}

interface SeoActionRow {
  id:              string
  client_id:       string
  /**
   * Selected even though this evaluator only ever loads `seo`: the handoff
   * decision runs the SHARED routing rule, which refuses to decide without it
   * rather than assuming. Hardcoding `'seo'` here would be the same shortcut
   * `loadableFlywheelsOrThrow` exists to prevent.
   */
  flywheel:        string
  executed_at:     string
  action_type:     string
  expected_metric: string | null
  payload:         Record<string, unknown> | null
}

export interface GscAttributionResult {
  client_id:        string
  actions_found:    number
  outcomes_written: number
  skipped:          number
  errors:           string[]
  /**
   * Stale-row reconciliation failures that happened AFTER their outcomes were
   * already written. Counted separately because they do not undo the write:
   * `outcomes_written` still reports every row that landed. Folding these into
   * "nothing was written" is what made a successful run look like a total
   * failure (and return 502). (Codex P2 round 3 on PR #862.)
   */
  cleanup_errors:   number
  /**
   * Reconciliation failures from BEFORE any write this run — claiming rows an
   * older deployment left unsigned, or retiring a non-authoritative window.
   *
   * Deliberately NOT folded into `cleanup_errors`. That counter means "the rows
   * landed, tidying up afterwards failed", which is why the manual route treats
   * it as success. These errors mean the opposite: nothing has been made right,
   * the unsigned rows still block the contract migration, and a duplicated
   * window is still being counted twice by the memory consumers. They only
   * looked alike because reconciliation used to run after the write.
   * (Codex P2, round 18 on PR #862.)
   */
  reconcile_errors: number
}

/** One action's attribution: what landed, and whether tidying up afterwards failed. */
interface AttributeActionResult {
  /** Rows successfully upserted. Never reduced by a later cleanup failure. */
  written: number
  /** Message if retiring superseded rows failed, else null. */
  cleanupError: string | null
}

export interface GscAttributionOptions {
  /**
   * The window pass 1 (attribution/job.ts) ran at. Pass 1 defers actions whose
   * expected_metric this evaluator owns, so the answer at ITS window becomes
   * this evaluator's to produce — otherwise deferral silently changes which
   * question gets answered (Codex P2 on PR #862: a 14-day ask handed off to a
   * 28-day-only writer means the 14-day outcome never exists).
   *
   * When set and different from `windowDays`, deferred actions are additionally
   * computed at this window. Equal windows are computed once — one computation
   * answers both.
   */
  deferredWindowDays?: number
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** This evaluator's own cadence window for GSC snapshots. */
const GSC_DEFAULT_WINDOW_DAYS = 28

/**
 * The flywheels this evaluator's action query filters on.
 *
 * `null` in the shared declaration means "any flywheel" — but a PostgREST
 * `.in('flywheel', [])` means "no flywheel", the exact inversion. Widening this
 * evaluator to `null` without also removing the filter would silently select
 * nothing and report a clean, empty pass while routing every GSC-owned action
 * to it. Throwing makes that mistake impossible to ship quietly.
 */
function loadableFlywheelsOrThrow(): readonly string[] {
  const scope = evaluatorLoadableFlywheels(OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
  if (scope === null) {
    throw new Error(
      'gsc-bridge: this evaluator is declared loadable for every flywheel, but its ' +
        'action query filters on a list. Remove the .in() filter instead of passing ' +
        'an empty array, which would match nothing.',
    )
  }
  return scope
}

/**
 * Run GSC attribution for all SEO actions for a given client.
 *
 * @param clientId   Target client
 * @param windowDays Days after action to look for the "after" snapshot (default 28)
 * @param opts       See {@link GscAttributionOptions}
 */
/**
 * Load this evaluator's actions for one client, paginated.
 *
 * The flywheel filter comes from the shared declaration rather than a literal,
 * so pass 1's decision to defer to us and our decision to load cannot drift
 * apart — an action deferred here but excluded by this query would never be
 * attributed at all.
 *
 * Paginated for the same reason pass 1 and the audit are: PostgREST caps a
 * response at 1000 rows silently, and newest-first ordering means the rows
 * dropped are the OLDEST. Pass 1 defers every GSC-owned action it finds, but
 * `pass2ClientIds` carries only client ids — so a truncation here loses exactly
 * the deferred actions pass 1 promised we would answer, and nothing reports it.
 */
async function loadSeoActions(clientId: string): Promise<SeoActionRow[]> {
  return fetchAll<SeoActionRow>((from, to) =>
    supabaseAdmin
      .from('flywheel_actions')
      .select('id, client_id, flywheel, executed_at, action_type, expected_metric, payload')
      .eq('client_id', clientId)
      .in('flywheel', loadableFlywheelsOrThrow())
      .not('expected_metric', 'is', null)
      // `id` as a unique tiebreak — `executed_at` is not unique, and an
      // unstable sort repeats or drops rows at page boundaries.
      .order('executed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  )
}

/** One action's contribution to the run. */
interface ActionTally {
  written: number
  /** Post-write reconciliation failures — the rows landed regardless. */
  cleanupErrors: string[]
  /** A hard failure that stopped this action producing anything. */
  hardError: string | null
}

/**
 * Attribute one action at the cadence window, plus the handoff window when pass
 * 1 deferred it, and reconcile afterwards.
 *
 * `written` accumulates as each upsert lands, so a failure partway through does
 * not un-count rows already in the database: the cadence upsert can succeed and
 * the handoff one then fail, and the cron summary must still report what landed.
 */
async function attributeOneAction(
  action: SeoActionRow,
  windowDays: number,
  deferredWindowDays: number | undefined,
): Promise<ActionTally> {
  const tally: ActionTally = { written: 0, cleanupErrors: [], hardError: null }

  try {
    const cadence = await attributeAction(action, windowDays)
    tally.written = cadence.written
    if (cadence.cleanupError) tally.cleanupErrors.push(cadence.cleanupError)

    // Only now — the authoritative window is in the database, so dropping the
    // others cannot leave this action with nothing.
    if (cadence.written > 0) {
      const windowError = await retireExtraWindows(action, windowDays)
      if (windowError) tally.cleanupErrors.push(windowError)
    }

    const handoffWindow = resolveHandoffWindow(action, windowDays, deferredWindowDays)
    if (handoffWindow !== null) {
      const handoff = await attributeAction(action, handoffWindow)
      tally.written += handoff.written
      if (handoff.cleanupError) tally.cleanupErrors.push(handoff.cleanupError)
    }
  } catch (err) {
    tally.hardError = err instanceof Error ? err.message : String(err)
  }

  return tally
}

export async function runGscAttributionForClient(
  clientId: string,
  windowDays: number = GSC_DEFAULT_WINDOW_DAYS,
  opts: GscAttributionOptions = {},
): Promise<GscAttributionResult> {
  const result: GscAttributionResult = {
    client_id:        clientId,
    actions_found:    0,
    outcomes_written: 0,
    skipped:          0,
    errors:           [],
    cleanup_errors:   0,
    reconcile_errors: 0,
  }

  let actions: SeoActionRow[]
  try {
    actions = await loadSeoActions(clientId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    result.errors.push(`Failed to load SEO actions: ${message}`)
    return result
  }

  if (!actions.length) return result
  result.actions_found = actions.length

  for (const action of actions) {
    foldTally(result, action.id, await attributeOneAction(action, windowDays, opts.deferredWindowDays))
  }

  return result
}

/**
 * Fold one action's tally into the client-level result.
 *
 * A cleanup failure counts as `cleanup_errors` — the counter the manual route
 * forgives — only when THIS action landed something. The count used to be per
 * client, so an action that wrote nothing and failed to retire its stale domain
 * rows was forgiven on the strength of a DIFFERENT action's writes, leaving
 * those rows on the execution board and in the learning path inside a run
 * reported as successful. A zero-write cleanup failure is a hard error.
 * (Codex P2, round 32 on PR #862.)
 */
function foldTally(result: GscAttributionResult, actionId: string, tally: ActionTally): void {
  for (const msg of tally.cleanupErrors) {
    if (tally.written > 0) result.cleanup_errors++
    result.errors.push(`action ${actionId}: ${msg}`)
  }
  if (tally.hardError) result.errors.push(`action ${actionId}: ${tally.hardError}`)

  if (tally.written > 0) result.outcomes_written += tally.written
  else result.skipped++
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Which extra window, if any, this action must also be computed at because
 * pass 1 deferred it to us. Returns null when there is nothing to add:
 * no deferred window given, the windows coincide (one computation answers
 * both), or the action was never deferred in the first place — pass 1 only
 * defers metrics this evaluator owns, so an action whose expected_metric
 * belongs to pass 1 already has its answer at the pass-1 window.
 */
function resolveHandoffWindow(
  action: SeoActionRow,
  windowDays: number,
  deferredWindowDays: number | undefined,
): number | null {
  if (deferredWindowDays === undefined) return null
  // Fail-safe against a garbage window reaching this far (the cron route
  // sanitises, but this evaluator guards its own writes): NaN in particular
  // would slip the equality dedupe below — NaN === anything is false — and
  // turn every deferred action into an Invalid Date error.
  if (!Number.isInteger(deferredWindowDays) || deferredWindowDays <= 0) return null
  if (deferredWindowDays === windowDays) return null
  if (!action.expected_metric) return null

  // Ask the SHARED routing rule, not just "does this evaluator own the metric".
  //
  // Ownership is necessary but not sufficient, and the gap is a real shape:
  // a plain `seo.publish_blog` promising `seo.gsc.page_clicks` is owned by this
  // evaluator, so the ownership test says yes — but pass 1 routes it
  // `unattributable` (scope_mismatch), never `defer`. It was never handed over,
  // so there is no second question owed to anyone; computing one would give a
  // misconfigured action two windows' worth of rows and re-amplify exactly the
  // evidence the dual-window gate exists to hold down.
  // (Codex P2, round 33 on PR #862.)
  return resolveAttributionRouting({
    flywheel: action.flywheel,
    action_type: action.action_type,
    expected_metric: action.expected_metric,
    payload: action.payload,
  }) === 'defer'
    ? deferredWindowDays
    : null
}

/**
 * Compute and write one action's outcomes at one window.
 *
 * Order is write-then-retire. This used to be DELETE-then-INSERT, so a failed
 * insert left the action with no outcomes at all until the next successful run;
 * upserting on the natural key also keeps `flywheel_outcomes.id` stable across
 * re-runs. See Issue #859.
 *
 * Arbitration is enforced from the owning side: this evaluator may only write
 * metrics it is authoritative for (`assertEvaluatorOwnsAll`).
 *
 * Producing nothing is normally not a refutation of the previous answer, so
 * nothing is retired. Page scope is the exception: the action being about one
 * specific page makes its domain-level outcomes wrong *by scope*, not by this
 * run's data. Whether the page happens to appear in this snapshot's `top_pages`
 * is a separate question, and letting it decide would leave rows the old ungated
 * bridge wrote visible on the execution board — and feeding memory and
 * benchmarks — indefinitely.
 */
async function attributeAction(
  action: SeoActionRow,
  windowDays: number,
): Promise<AttributeActionResult> {
  const nothing: AttributeActionResult = { written: 0, cleanupError: null }

  const scope = resolveGscAttributionScope(action)
  if (scope.kind === 'skip') return nothing

  const executedAt = action.executed_at
  const [baseline, after] = await Promise.all([
    fetchGscSnapshot(action.client_id, 'before', executedAt),
    fetchGscSnapshot(action.client_id, 'after', addDays(executedAt, windowDays)),
  ])
  if (!baseline || !after) return nothing   // both snapshots required

  const rows =
    scope.kind === 'page'
      ? buildPageOutcomeRows(action, baseline, after, scope.pageUrl, windowDays)
      : buildOutcomeRows(action, baseline, after, windowDays)

  if (rows.length === 0) {
    if (scope.kind === 'page') {
      return {
        written: 0,
        cleanupError: await retireOwnKeys(action, GSC_DOMAIN_METRIC_KEYS),
      }
    }
    return nothing
  }

  const written = rows.map(row => row.metric_key as string)
  assertEvaluatorOwnsAll(OUTCOME_EVALUATOR.GSC_SNAPSHOTS, written)

  const { error } = await supabaseAdmin
    .from('flywheel_outcomes')
    .upsert(rows, { onConflict: OUTCOME_CONFLICT_TARGET })
  if (error) throw new Error(`upsert outcomes: ${error.message}`)

  const staleKeys = resolveStaleEvaluatorKeys(GSC_EVALUATOR_METRIC_KEYS, written)

  return {
    written: rows.length,
    cleanupError: await retireOwnKeys(action, staleKeys),
  }
}

/**
 * Bring one action's pre-#859 rows into line with what this deployment stands
 * behind. Two steps, in this order, both scoped to this action and this
 * evaluator's own metric vocabulary.
 *
 * WHY ANY OF THIS EXISTS. The expand migration backfills `evaluator_key` once,
 * at apply time, and the rollout then deliberately keeps the OLD code running
 * against the expanded table until #862 deploys. The old manual endpoint takes
 * any window from 1 to 90, so a 7-day run inside that gap writes a row the
 * finished backfill will never revisit — and nothing afterwards lands on that
 * natural key again, because the gate refuses custom windows and each writer
 * only recomputes its own cadence.
 *
 * [1] CLAIM — sign our own unsigned rows. Safe because the metric namespace
 *     decides ownership: `seo.gsc.*` has only ever been written by this
 *     evaluator, the same rule the backfill and the
 *     `flywheel_outcomes_evaluator_owns_metric` CHECK encode. Never overwrites
 *     an existing signature. Without it the contract migration's
 *     `NULL count = 0` precondition is permanently unsatisfiable.
 *
 * [2] RETIRE NON-AUTHORITATIVE WINDOWS — but only while dual-window is OFF.
 *     Signing a gap row is not enough on its own: it leaves the action holding
 *     BOTH a 7-day and a 28-day answer, and the memory consumers still count
 *     outcome ROWS, so that action's evidence is doubled — the exact harm
 *     `ATTRIBUTION_DUAL_WINDOW_ENABLED` exists to prevent. On main this could
 *     not happen, because every writer DELETEd by action before inserting, so
 *     an action never held more than one window. Removing that delete is right
 *     — it is what stopped the two writers destroying each other's rows — but
 *     it means "one window per action" has to be restored deliberately for as
 *     long as the gate is off. With the gate ON these rows are legitimate and
 *     nothing is retired. (Codex P1, round 16 on PR #862.)
 *
 * Order matters: the retire filters on our own `evaluator_key`, so it cannot
 * see a row that is still NULL. Claim first, then retire.
 *
 * Returns every error rather than the first: these are independent statements,
 * and reporting one while silently skipping the other is how a half-done
 * reconciliation reads as a clean run.
 */
/**
 * WHY THIS EVALUATOR DOES NOT CLAIM UNSIGNED ROWS.
 *
 * It used to (round 15): sign any `seo.gsc.*` row for an action that the expand
 * migration's backfill had left with a NULL `evaluator_key`, so the contract
 * migration's `evaluator_key IS NULL = 0` gate could be satisfied. That rested
 * on "the namespace proves the writer", and two rounds of review took the
 * proof apart:
 *
 *   · round 17 — old pass 1 had no ownership routing and attributed straight
 *     from `flywheel_metrics`, which already carries the three GSC keys. So an
 *     action whose `expected_metric` was a GSC key produced a
 *     flywheel_metrics-derived row AT that key. Narrowed: exclude the action's
 *     own expected_metric.
 *   · round 24 — that exclusion reads the CURRENT expected_metric, but the
 *     ambiguity was created by whatever it was AT THE TIME. Once the
 *     `action_unattributable` todo has a human correct A → B, the A row becomes
 *     claimable again and gets signed as ours.
 *
 * There is no third narrowing, because the missing fact is history: nothing in
 * the row says which metric the action promised when it was written, and no
 * query can recover it. Signing anyway would make the rollout gate pass while
 * the answer is wrong — downstream would read a flywheel_metrics-derived number
 * as an authoritative GSC measurement — and the claim runs before the maturity
 * check, so a client without snapshots would never have it recomputed and
 * corrected.
 *
 * So this evaluator signs only what it writes. An unsigned `seo.gsc.*` row is
 * left exactly as it is — not claimed, not retired (the retire filters on our
 * own evaluator_key, so it cannot see a NULL one) — and surfaces at rollout
 * step [2], where the expand migration's header carries the diagnostic query
 * and the two acceptable resolutions. A blocked gate a human can explain beats
 * an unblocked one built on a guess.
 *
 * Pass 1's claim is NOT symmetric with this and stays: it claims by excluding
 * every foreign namespace, and this evaluator has never written outside
 * `seo.gsc.*`, so a non-GSC unsigned row can only be pass 1's own. That one is
 * provable; this one is not.
 */

/**
 * Drop this evaluator's rows at any window other than the authoritative one —
 * only AFTER the authoritative window has actually been written.
 *
 * The ordering is the point. When I moved reconciliation ahead of the maturity
 * check in round 16, this delete came along with it, and that turned a
 * safeguard into data loss: with the gate off, an action holding only a 7-day
 * row from the deploy gap and not yet carrying a mature 28-day snapshot had its
 * one piece of evidence deleted, and then the recompute declined to run. The
 * action went from "some evidence" to none. (Codex P1, round 22 on PR #862.)
 *
 * Write-before-retire is the rule this whole Work Package established for the
 * upsert path; the window retire has to obey it too. Never delete the answer to
 * a question you still promise to answer until the replacement has landed.
 *
 * The cost is that an immature action can transiently hold two windows while
 * the gate is off — the harm the gate exists to prevent. That is the right
 * trade: a duplicate is recoverable and self-clears on the pass that finally
 * writes the authoritative window, whereas the deleted row is not recoverable
 * at all, because the very reason it was deleted is that we cannot recompute it.
 */
async function retireExtraWindows(
  action: SeoActionRow,
  authoritativeWindow: number,
): Promise<string | null> {
  if (dualWindowEnabled()) return null

  const { error } = await supabaseAdmin
    .from('flywheel_outcomes')
    .delete()
    .eq('action_id', action.id)
    .eq('evaluator_key', OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
    .neq('window_days', authoritativeWindow)

  return error ? `retire non-authoritative windows: ${error.message}` : null
}

/**
 * Delete outcome rows this evaluator owns for keys it no longer stands behind.
 *
 * Scoped to our own `evaluator_key`, so it can never remove the
 * flywheel_metrics evaluator's rows. Deliberately NOT scoped by window — see
 * the note on the delete below.
 *
 * Returns the error rather than throwing: by the time this runs the current
 * rows are already in the database, and throwing would discard that count and
 * report the run as having written nothing. A superseded row left behind is a
 * reconciliation debt for the next run, not a reason to disown a good write.
 */
async function retireOwnKeys(
  action: SeoActionRow,
  metricKeys: readonly string[],
): Promise<string | null> {
  if (metricKeys.length === 0) return null

  // Deliberately NOT filtered by window. These keys are retired because the
  // action's SCOPE rules them out — a page-scoped action's domain numbers are
  // wrong at every window, not just the one being recomputed. The manual
  // endpoint accepts any window from 1 to 90 while the cron only ever revisits
  // its cadence and pass 1's window, so a window-scoped delete would strand
  // rows written at, say, 7 days forever, still feeding the execution board and
  // the benchmarks. Scoped to this action and this evaluator, so it can never
  // touch the flywheel_metrics evaluator's rows.
  const { error } = await supabaseAdmin
    .from('flywheel_outcomes')
    .delete()
    .eq('action_id', action.id)
    .eq('evaluator_key', OUTCOME_EVALUATOR.GSC_SNAPSHOTS)
    .in('metric_key', metricKeys)

  return error ? `retire stale outcomes: ${error.message}` : null
}

async function fetchGscSnapshot(
  clientId: string,
  direction: 'before' | 'after',
  dateStr: string,
): Promise<GscSnapshotRow | null> {
  let query = supabaseAdmin
    .from('gsc_performance_snapshots')
    .select('period_end, total_clicks, total_impressions, avg_position, top_pages')
    .eq('client_id', clientId)

  if (direction === 'before') {
    // Most recent snapshot whose period_end is before or on the action date
    query = query.lte('period_end', dateStr).order('period_end', { ascending: false })
  } else {
    // Most recent snapshot whose period_end is at least window_days after the action
    query = query.gte('period_end', dateStr).order('period_end', { ascending: true })
  }

  const { data, error } = await query.limit(1).maybeSingle()

  // Throw rather than returning null: "the query failed" and "this client has no
  // snapshot on that side yet" both used to arrive here as null, and the caller
  // reads null as the latter — counting the action as `skipped` with an empty
  // `errors` array, so a transient PostgREST failure logged as a healthy run
  // that simply had nothing to do. That is the shape pass 1 no longer covers
  // for, since it defers these actions instead of attributing them. The caller
  // catches this per action, so one bad query does not abort the client.
  if (error) {
    throw new Error(`gsc snapshot query (${direction}): ${error.message}`)
  }

  return data as GscSnapshotRow | null
}

function buildOutcomeRows(
  action: SeoActionRow,
  baseline: GscSnapshotRow,
  after: GscSnapshotRow,
  windowDays: number,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString()

  const dimensions: Array<{
    metricKey: string
    baselineVal: number
    afterVal: number
    expectedDelta: number | null
  }> = [
    {
      metricKey:     SEO_METRIC_KEY.GSC_CLICKS,
      baselineVal:   baseline.total_clicks,
      afterVal:      after.total_clicks,
      expectedDelta: 1, // expect clicks to increase
    },
    {
      metricKey:     SEO_METRIC_KEY.GSC_IMPRESSIONS,
      baselineVal:   baseline.total_impressions,
      afterVal:      after.total_impressions,
      expectedDelta: 1, // expect impressions to increase
    },
    {
      // avg_position: lower number = better rank.
      // We flip the delta so positive delta = improvement:
      //   baseline_position=10, after_position=8 → delta = 10-8 = +2 (improvement)
      metricKey:     SEO_METRIC_KEY.GSC_AVG_POSITION,
      baselineVal:   baseline.avg_position,
      afterVal:      after.avg_position,
      expectedDelta: 1, // expect position to improve (numeric delta will be positive when it does)
    },
  ]

  return dimensions.map(dim => {
    // For position: delta = baseline - after (positive = rank improved)
    // For clicks/impressions: delta = after - baseline (positive = growth)
    const delta =
      dim.metricKey === SEO_METRIC_KEY.GSC_AVG_POSITION
        ? round2(dim.baselineVal - dim.afterVal)
        : round2(dim.afterVal - dim.baselineVal)

    const deltaPct =
      dim.baselineVal !== 0 ? round2((delta / Math.abs(dim.baselineVal)) * 100) : null

    const { verdict, confidence } = computeVerdict(delta, deltaPct, dim.expectedDelta)

    return {
      action_id:   action.id,
      client_id:   action.client_id,
      metric_key:  dim.metricKey,
      baseline:    dim.metricKey === SEO_METRIC_KEY.GSC_AVG_POSITION
                     ? dim.baselineVal
                     : dim.baselineVal,
      after_value: dim.afterVal,
      delta,
      delta_pct:   deltaPct,
      confidence,
      verdict,
      window_days: windowDays,
      evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
      computed_at: now,
    }
  })
}

function buildPageOutcomeRows(
  action: SeoActionRow,
  baseline: GscSnapshotRow,
  after: GscSnapshotRow,
  pageUrl: string,
  windowDays: number,
): Array<Record<string, unknown>> {
  const baselinePage = findGscPage(baseline.top_pages, pageUrl)
  const afterPage = findGscPage(after.top_pages, pageUrl)
  if (!baselinePage || !afterPage) return []

  const now = new Date().toISOString()
  const dimensions = [
    {
      metricKey: SEO_METRIC_KEY.GSC_PAGE_CLICKS,
      baselineVal: baselinePage.clicks,
      afterVal: afterPage.clicks,
      invertDelta: false,
    },
    {
      metricKey: SEO_METRIC_KEY.GSC_PAGE_IMPRESSIONS,
      baselineVal: baselinePage.impressions,
      afterVal: afterPage.impressions,
      invertDelta: false,
    },
    {
      metricKey: SEO_METRIC_KEY.GSC_PAGE_AVG_POSITION,
      baselineVal: baselinePage.position,
      afterVal: afterPage.position,
      invertDelta: true,
    },
  ]

  return dimensions.map((dim) => {
    const delta = round2(
      dim.invertDelta
        ? dim.baselineVal - dim.afterVal
        : dim.afterVal - dim.baselineVal,
    )
    const deltaPct =
      dim.baselineVal !== 0 ? round2((delta / Math.abs(dim.baselineVal)) * 100) : null
    const { verdict, confidence } = computeVerdict(delta, deltaPct, 1)

    return {
      action_id: action.id,
      client_id: action.client_id,
      metric_key: dim.metricKey,
      baseline: dim.baselineVal,
      after_value: dim.afterVal,
      delta,
      delta_pct: deltaPct,
      confidence,
      verdict,
      window_days: windowDays,
      evaluator_key: OUTCOME_EVALUATOR.GSC_SNAPSHOTS,
      computed_at: now,
    }
  })
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
