/**
 * flywheel_outcomes identity — Issue #859 (Attribution Correctness)
 *
 * One business outcome = "what did action A do to metric M over a W-day window".
 * That triple is the natural key; it is enforced by the
 * `flywheel_outcomes_natural_key` UNIQUE constraint (migration
 * 20260808000001_flywheel_outcomes_identity_expand.sql).
 *
 * `evaluator_key` is deliberately *not* part of the key. Two evaluators that
 * answer the same (action, metric, window) question are producing competing
 * answers to one fact, not two facts.
 *
 * That decision only holds up if a natural key can never be produced by two
 * evaluators, because otherwise "which answer is true" degrades into "which
 * writer ran last" — and a stable row id whose verdict flips with the cron
 * schedule is worse than an unstable one, since downstream memory would read
 * scheduling noise as a business reversal.
 *
 * So ownership is assigned per metric family, below: exactly one evaluator is
 * authoritative for any given metric_key, and a non-owner declines to write
 * rather than competing. Execution order cannot decide truth because only one
 * writer ever produces the row. The same rule is enforced in the database by
 * `flywheel_outcomes_evaluator_owns_metric`.
 */

import { SEO_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import { resolveGscAttributionScope } from './gsc-page-scope'

/** The fields the GSC bridge's scope decision reads off an action. */
export interface GscScopeInput {
  action_type: string
  expected_metric: string | null
  payload: Record<string, unknown> | null
}

/** Which attribution pipeline produced a row. Mirrors the DB CHECK constraint. */
export const OUTCOME_EVALUATOR = {
  /** attribution/job.ts — reads flywheel_metrics */
  FLYWHEEL_METRICS: 'flywheel_metrics',
  /** attribution/gsc-bridge.ts — reads gsc_performance_snapshots */
  GSC_SNAPSHOTS: 'gsc_snapshots',
} as const

export type OutcomeEvaluatorKey =
  (typeof OUTCOME_EVALUATOR)[keyof typeof OUTCOME_EVALUATOR]

/**
 * `onConflict` target for every flywheel_outcomes upsert. Must stay in sync
 * with the UNIQUE constraint; the column order is the constraint's order.
 */
export const OUTCOME_CONFLICT_TARGET = 'action_id,metric_key,window_days'

/**
 * Every metric_key the GSC evaluator can emit — domain scope and page scope.
 * Used to work out which of *its own* rows an action no longer has, so they can
 * be retired without touching any other evaluator's rows.
 */
export const GSC_EVALUATOR_METRIC_KEYS: readonly string[] = [
  SEO_METRIC_KEY.GSC_CLICKS,
  SEO_METRIC_KEY.GSC_IMPRESSIONS,
  SEO_METRIC_KEY.GSC_AVG_POSITION,
  SEO_METRIC_KEY.GSC_PAGE_CLICKS,
  SEO_METRIC_KEY.GSC_PAGE_IMPRESSIONS,
  SEO_METRIC_KEY.GSC_PAGE_AVG_POSITION,
]

/**
 * The domain-scope subset. Once an action is known to be about one specific
 * page, these keys are wrong for it regardless of whether page-level numbers
 * can be produced this run — the scope is the refutation, not the data.
 */
export const GSC_DOMAIN_METRIC_KEYS: readonly string[] = [
  SEO_METRIC_KEY.GSC_CLICKS,
  SEO_METRIC_KEY.GSC_IMPRESSIONS,
  SEO_METRIC_KEY.GSC_AVG_POSITION,
]

/** The page-scope subset — produced only for a live page-upgrade action. */
export const GSC_PAGE_METRIC_KEYS: readonly string[] = [
  SEO_METRIC_KEY.GSC_PAGE_CLICKS,
  SEO_METRIC_KEY.GSC_PAGE_IMPRESSIONS,
  SEO_METRIC_KEY.GSC_PAGE_AVG_POSITION,
]

/**
 * The metric keys the GSC evaluator will actually produce for this action.
 *
 * Loading an action is not the same as answering its question: the bridge's
 * scope decides which half of its vocabulary it emits. A domain-scope action
 * only ever gets the three domain keys, a page-scope one only the three page
 * keys, and a `skip` one nothing at all. An action promising a key outside that
 * set is stranded exactly as surely as one on a flywheel the bridge cannot
 * load, so routing has to ask this too.
 */
export function gscProducedMetricKeys(action: GscScopeInput): readonly string[] {
  const scope = resolveGscAttributionScope(action)
  if (scope.kind === 'page') return GSC_PAGE_METRIC_KEYS
  if (scope.kind === 'domain') return GSC_DOMAIN_METRIC_KEYS
  return []
}

/**
 * Metric families whose authoritative evaluator is not the default.
 *
 * `seo.gsc.*` belongs to the GSC bridge: it reads `gsc_performance_snapshots`,
 * which is Search Console's own account of those numbers, with a baseline and
 * an after snapshot chosen for the window. `job.ts` can also reach those keys
 * — `flywheel_metrics` carries `seo.gsc.clicks` / `impressions` /
 * `avg_position` (99 rows each in production) — but only as a daily-pulled
 * copy, so its answer is the derivative one.
 *
 * Longest matching prefix wins, so a narrower family can be carved out later
 * without disturbing the ones above it.
 */
const METRIC_FAMILY_OWNERS: ReadonlyArray<{
  prefix: string
  evaluator: OutcomeEvaluatorKey
}> = [{ prefix: 'seo.gsc.', evaluator: OUTCOME_EVALUATOR.GSC_SNAPSHOTS }]

/** Every metric family not claimed above is the flywheel_metrics evaluator's. */
const DEFAULT_METRIC_OWNER: OutcomeEvaluatorKey = OUTCOME_EVALUATOR.FLYWHEEL_METRICS

/**
 * The one evaluator allowed to write outcomes for this metric. Total function:
 * every metric_key has exactly one owner, so no natural key is ever contested.
 */
export function resolveAuthoritativeEvaluator(metricKey: string): OutcomeEvaluatorKey {
  let owner = DEFAULT_METRIC_OWNER
  let matched = -1

  for (const family of METRIC_FAMILY_OWNERS) {
    if (metricKey.startsWith(family.prefix) && family.prefix.length > matched) {
      owner = family.evaluator
      matched = family.prefix.length
    }
  }

  return owner
}

/**
 * Metric-family prefixes belonging to evaluators OTHER than this one.
 *
 * Used to claim rows by exclusion: a NULL-evaluator row whose metric_key falls
 * outside every foreign prefix can only have been written by this evaluator,
 * because no other evaluator is allowed to write that namespace. That makes the
 * claim provable rather than inferred — the distinction round 17 turned on.
 *
 * Derived from the ownership table rather than hardcoded, so carving out a new
 * family later cannot leave a writer claiming rows that stopped being its own.
 */
export function foreignMetricPrefixes(
  evaluator: OutcomeEvaluatorKey,
): readonly string[] {
  return METRIC_FAMILY_OWNERS
    .filter(family => family.evaluator !== evaluator)
    .map(family => family.prefix)
}

/** Whether `evaluator` is the authoritative writer for `metricKey`. */
export function ownsMetric(evaluator: OutcomeEvaluatorKey, metricKey: string): boolean {
  return resolveAuthoritativeEvaluator(metricKey) === evaluator
}

/**
 * Which `flywheel_actions.flywheel` values each evaluator can actually load.
 *
 * Owning a metric is not the same as being able to reach the action that
 * promised it. The GSC bridge queries `flywheel = 'seo'`, so a GEO or Social
 * action carrying a `seo.gsc.*` expected_metric is owned by an evaluator that
 * will never see it. Declaring the reachable set here — rather than letting
 * each side assume — is what keeps "who owns this" and "who can load this"
 * from drifting apart. `null` means "any flywheel": the flywheel_metrics
 * evaluator loads every action with an expected_metric, without a filter.
 *
 * ⚠️ Widening an evaluator's scope means widening its query too. `gsc-bridge`
 * derives its filter from this map, and a test asserts it.
 */
const EVALUATOR_LOADABLE_FLYWHEELS: Readonly<
  Record<OutcomeEvaluatorKey, readonly string[] | null>
> = {
  [OUTCOME_EVALUATOR.FLYWHEEL_METRICS]: null,
  [OUTCOME_EVALUATOR.GSC_SNAPSHOTS]: ['seo'],
}

/** The flywheels this evaluator loads actions for, or null for "all of them". */
export function evaluatorLoadableFlywheels(
  evaluator: OutcomeEvaluatorKey,
): readonly string[] | null {
  return EVALUATOR_LOADABLE_FLYWHEELS[evaluator]
}

/** Whether `evaluator` would ever load an action on this flywheel. */
export function evaluatorCanLoad(evaluator: OutcomeEvaluatorKey, flywheel: string): boolean {
  const scope = EVALUATOR_LOADABLE_FLYWHEELS[evaluator]
  return scope === null || scope.includes(flywheel)
}

/**
 * What the flywheel_metrics evaluator should do with an action.
 *
 *   own            — this evaluator owns the metric; attribute it here.
 *   defer          — another evaluator owns it AND can load this action.
 *   unattributable — another evaluator owns it but cannot load this action, so
 *                    nobody will ever answer. Deferring here would manufacture
 *                    a permanent hole; writing it here is forbidden by the
 *                    `flywheel_outcomes_evaluator_owns_metric` CHECK. The only
 *                    honest option is to report it.
 *
 * The third case is the same failure shape `metric-registry.ts` exists to
 * prevent — an action promising a metric nothing will measure — caught at the
 * one point attribution can see it rather than left to fail silently.
 */
export type AttributionRouting = 'own' | 'defer' | 'unattributable'

/**
 * Why nobody can attribute an action. The three have different fixes, so the
 * handoff to a human is only actionable if it knows which one it is.
 */
export type UnattributableReason =
  /** The owning evaluator does not load this flywheel at all. */
  | 'cross_flywheel'
  /** It loads the action, but its scope emits a different set of keys. */
  | 'scope_mismatch'
  /** It would skip the action entirely — nothing is produced at any key. */
  | 'scope_skip'

export type AttributionRoutingResult =
  | { routing: 'own' }
  | { routing: 'defer' }
  | {
      routing: 'unattributable'
      reason: UnattributableReason
      /** The key the owner WOULD produce for this action, when there is one. */
      suggestedMetric: string | null
    }

export interface AttributionRoutingInput {
  flywheel: string | null | undefined
  expected_metric: string
  /** Needed to work out which keys the GSC evaluator would emit for this action. */
  action_type?: string | null
  payload?: Record<string, unknown> | null
}

export function resolveAttributionRouting(
  action: AttributionRoutingInput,
): AttributionRouting {
  return resolveAttributionRoutingDetailed(action).routing
}

/**
 * Routing, plus why an action is stranded and what would fix it.
 *
 * The reason matters because the fixes differ: a metric on the wrong flywheel
 * needs a different metric (or a different flywheel), while a scope mismatch
 * inside the SEO flywheel needs the domain/page counterpart of the same
 * measurement. A handoff that names the wrong cause sends someone looking in
 * the wrong place, which is the same as not reporting it.
 */
/**
 * Can the GSC evaluator actually PRODUCE the key this action asks for?
 *
 * Loading the action is necessary but not sufficient. That evaluator emits
 * domain keys for a domain-scope action and page keys for a page-scope one, so
 * an action promising `seo.gsc.page_clicks` from a plain `seo.publish_blog`
 * would be deferred to a writer that will only ever produce the domain three —
 * and the adapters accept that combination today. Deferring it would be the
 * same silent hole as deferring across flywheels.
 */
function gscScopeVerdict(
  action: AttributionRoutingInput,
): AttributionRoutingResult | null {
  const produced = gscProducedMetricKeys({
    action_type: action.action_type ?? '',
    expected_metric: action.expected_metric,
    payload: action.payload ?? null,
  })

  if (produced.length === 0) {
    return { routing: 'unattributable', reason: 'scope_skip', suggestedMetric: null }
  }
  if (produced.includes(action.expected_metric)) return null

  // Only suggest a key this action would actually get — a suggestion the owner
  // still would not produce is worse than no suggestion.
  const counterpart = counterpartMetricKey(action.expected_metric)
  return {
    routing: 'unattributable',
    reason: 'scope_mismatch',
    suggestedMetric: counterpart && produced.includes(counterpart) ? counterpart : null,
  }
}

export function resolveAttributionRoutingDetailed(
  action: AttributionRoutingInput,
): AttributionRoutingResult {
  // `undefined` means the caller's query did not select the column — a coding
  // mistake, not a business fact. Coercing it to "unreachable" would route every
  // GSC-owned action to `unattributable` and rebuild the exact permanent hole
  // this function exists to prevent, with no error anywhere. Checked before the
  // ownership short-circuit so the mistake surfaces on the first action.
  if (action.flywheel === undefined) {
    throw new Error(
      'resolveAttributionRouting: action.flywheel is undefined — the query must ' +
        'select the flywheel column. Routing cannot be decided without it.',
    )
  }

  if (ownsMetric(OUTCOME_EVALUATOR.FLYWHEEL_METRICS, action.expected_metric)) {
    return { routing: 'own' }
  }

  const owner = resolveAuthoritativeEvaluator(action.expected_metric)
  // NULL is not reachable (the column is NOT NULL in the database) but is
  // handled as unreachable rather than assumed to be 'seo': guessing would
  // defer into a hole, reporting will not.
  if (!evaluatorCanLoad(owner, action.flywheel ?? '')) {
    return { routing: 'unattributable', reason: 'cross_flywheel', suggestedMetric: null }
  }

  if (owner === OUTCOME_EVALUATOR.GSC_SNAPSHOTS) {
    const scopeVerdict = gscScopeVerdict(action)
    if (scopeVerdict) return scopeVerdict
  }

  return { routing: 'defer' }
}

/**
 * The same measurement at the other scope — `seo.gsc.page_clicks` ⇄
 * `seo.gsc.clicks`. The two key lists are parallel by construction, so the
 * counterpart is the entry at the same index.
 */
function counterpartMetricKey(metricKey: string): string | null {
  const domainIndex = GSC_DOMAIN_METRIC_KEYS.indexOf(metricKey)
  if (domainIndex >= 0) return GSC_PAGE_METRIC_KEYS[domainIndex] ?? null

  const pageIndex = GSC_PAGE_METRIC_KEYS.indexOf(metricKey)
  if (pageIndex >= 0) return GSC_DOMAIN_METRIC_KEYS[pageIndex] ?? null

  return null
}

/**
 * Guard for a writer about to persist a batch: every metric in it must belong
 * to the writer. Throws rather than filtering, because a writer producing a row
 * it does not own is a coding mistake, and dropping it quietly would hide the
 * moment the last-writer-wins race reopened.
 *
 * Unreachable with today's metric families — the GSC bridge only ever builds
 * `seo.gsc.*` keys. It exists so that adding a key to its row builders fails
 * with a legible message instead of a Postgres constraint violation.
 */
export function assertEvaluatorOwnsAll(
  evaluator: OutcomeEvaluatorKey,
  metricKeys: readonly string[],
): void {
  const trespass = metricKeys.filter(key => !ownsMetric(evaluator, key))
  if (trespass.length > 0) {
    throw new Error(
      `${evaluator} is not the authoritative evaluator for: ${trespass.join(', ')}`,
    )
  }
}

/** The columns needed to decide whether two outcome rows are one measurement. */
export interface OutcomeMeasurementRow {
  action_id: string
  metric_key: string
  window_days: number | null
}

/**
 * Collapse an outcome set to one row per (action, metric) — the unit any
 * consumer counting evidence should use.
 *
 * The natural key includes `window_days` because a 14-day and a 28-day answer
 * are different facts, and both are legitimately stored. But they are not two
 * pieces of evidence about whether the action worked: since deferred actions
 * are computed at the bridge's cadence AND at pass 1's window, counting rows
 * makes one action look like two. That inflates `industry_benchmarks` sample
 * sizes past their minimum threshold on half the real evidence, and doubles the
 * "client cases" behind Huatuo's success rates.
 *
 * The longest window wins: it is the most mature observation of the same
 * action, and picking deterministically keeps the count stable across runs
 * rather than depending on row order.
 */
export function keepOneMeasurementPerAction<T extends OutcomeMeasurementRow>(
  rows: readonly T[],
): T[] {
  const best = new Map<string, T>()

  for (const row of rows) {
    const key = `${row.action_id}::${row.metric_key}`
    const held = best.get(key)
    if (!held || (row.window_days ?? -1) > (held.window_days ?? -1)) {
      best.set(key, row)
    }
  }

  return Array.from(best.values())
}

/** An outcome row plus the promise its action made, for case counting. */
export interface OutcomeCaseRow extends OutcomeMeasurementRow {
  /** `flywheel_actions.expected_metric` — the metric the action promised to move. */
  expected_metric?: string | null
}

/**
 * Collapse an outcome set to one row per ACTION — the unit for "how often does
 * this kind of action work".
 *
 * `keepOneMeasurementPerAction` folds the windows; this folds the metrics too.
 * A GSC action yields clicks, impressions and avg_position from one snapshot
 * pair: three readings of a single event, not three independent results. Left
 * per-metric they let one action cross a sample threshold on its own and pull a
 * success rate around by three votes.
 *
 * The representative reading is the action's own `expected_metric` — the thing
 * it promised to move. When that reading is absent (the promise was never
 * measured), the longest window of whatever was measured stands in, so the
 * evidence is not thrown away entirely.
 */
export function keepOneCasePerAction<T extends OutcomeCaseRow>(rows: readonly T[]): T[] {
  const best = new Map<string, T>()

  for (const row of keepOneMeasurementPerAction(rows)) {
    const held = best.get(row.action_id)
    if (!held || outranks(row, held)) best.set(row.action_id, row)
  }

  return Array.from(best.values())
}

/**
 * Which metric best stands for an action when its promised one is missing.
 *
 * Lower rank wins. The list is a BUSINESS order, not an alphabetical one:
 * lexicographic ordering picked `seo.gsc.avg_position` over `seo.gsc.clicks`
 * purely because "a" sorts before "c", so an action whose clicks confirmed but
 * whose ranking slipped was reported as a reversal to the aggregate page, the
 * confidence readers and the execution board alike. `benchmark-accumulator.ts`
 * already treats clicks as the SEO representative and leaves avg_position out
 * as an intermediate signal; this makes the two agree instead of one of them
 * deciding by spelling. (Codex P2, round 30 on PR #862.)
 *
 * Anything unlisted ranks below everything listed, and ties fall back to
 * `metric_key` so the choice is still deterministic rather than row-ordered.
 */
const REPRESENTATIVE_METRIC_ORDER: readonly string[] = [
  'seo.gsc.clicks',
  'seo.gsc.page_clicks',
  'geo.query.mention_rate',
  'seo.gsc.impressions',
  'seo.gsc.page_impressions',
  // avg_position last on purpose: a ranking move is a means, not the outcome.
  'seo.gsc.avg_position',
  'seo.gsc.page_position',
]

function representativeRank(metricKey: string): number {
  const i = REPRESENTATIVE_METRIC_ORDER.indexOf(metricKey)
  return i === -1 ? REPRESENTATIVE_METRIC_ORDER.length : i
}

function outranks<T extends OutcomeCaseRow>(candidate: T, held: T): boolean {
  const candidateIsPromise = candidate.expected_metric === candidate.metric_key
  const heldIsPromise = held.expected_metric === held.metric_key
  if (candidateIsPromise !== heldIsPromise) return candidateIsPromise

  // Neither (or both) is the promised metric — prefer the metric that actually
  // represents the business result, then the most mature window, then
  // metric_key so the choice never depends on row order.
  const byBusiness = representativeRank(candidate.metric_key) - representativeRank(held.metric_key)
  if (byBusiness !== 0) return byBusiness < 0

  const byWindow = (candidate.window_days ?? -1) - (held.window_days ?? -1)
  if (byWindow !== 0) return byWindow > 0
  return candidate.metric_key < held.metric_key
}

/**
 * The canonical handle for an outcome's natural key. Mirrors the `outcome_key`
 * generated column so application code and SQL agree on one spelling.
 */
export function buildOutcomeKey(
  actionId: string,
  metricKey: string,
  windowDays: number,
): string {
  return `${actionId}:${metricKey}:${windowDays}`
}

/**
 * Given the metric keys an evaluator just wrote for an action, return the keys
 * it owns but did not produce this run — i.e. the rows that are no longer true
 * and should be retired.
 *
 * Returns [] when `writtenKeys` is empty: producing nothing is not evidence
 * that the previous answer was wrong, so a barren run must never retire
 * anything (fail closed).
 */
export function resolveStaleEvaluatorKeys(
  ownedKeys: readonly string[],
  writtenKeys: readonly string[],
): string[] {
  if (writtenKeys.length === 0) return []
  const written = new Set(writtenKeys)
  return ownedKeys.filter(key => !written.has(key))
}
