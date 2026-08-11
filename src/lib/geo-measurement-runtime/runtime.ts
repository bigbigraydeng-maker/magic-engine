/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 批次编排（Issue #874 / WP04）
 *
 * `explicit frozen plan → budget preflight → bounded fake-provider execution →
 *  WP02 validation → atomic fake-store persistence → honest completed/partial/failed result`
 *
 * 🔴 每一步都 fail closed；没有一步允许把失败/超时/限流/parser 失败悄悄折成成功
 *    （Build Control Room 2026-08-11 WP04 裁定）。
 */

import {
  validateGeoEvidence,
  validateGeoObservation,
  type GeoAcquisitionIdentity,
  type GeoCoverageDescriptor,
  type GeoEvidence,
  type GeoInterpretationIdentity,
  type GeoObservation,
} from '@/lib/geo-measurement'
import type { GeoBatchRow, GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'
import { preflightGeoBudget } from './budget'
import { expandGeoRuntimePlan, validateGeoRuntimePlan, type GeoPlannedObservationSlot } from './plan'
import type {
  GeoRuntimeBatchResult,
  GeoRuntimeBudget,
  GeoRuntimeCitationInput,
  GeoRuntimePlan,
  GeoRuntimeProvider,
  GeoRuntimeProviderOutcome,
  GeoRuntimeStopReason,
  GeoRuntimeStore,
} from './types'

export interface RunGeoBatchInput {
  readonly plan: GeoRuntimePlan
  readonly provider: GeoRuntimeProvider
  readonly store: GeoRuntimeStore
  readonly budget: GeoRuntimeBudget
  /** 供测试注入确定性 id / 时间；默认用 `crypto.randomUUID()` / `Date`。 */
  readonly idGenerator?: () => string
  readonly clock?: () => string
}

interface ClassifiedAttempt {
  readonly observation: GeoObservation
  readonly evidence: GeoEvidence | null
}

interface CoverageCounts {
  attempted: number
  succeeded: number
  failed: number
}

// ── 身份构造 ──────────────────────────────────────────────────────────────────

function buildAcquisitionIdentity(plan: GeoRuntimePlan, slot: GeoPlannedObservationSlot): GeoAcquisitionIdentity {
  return {
    querySetVersion: { known: true, value: plan.querySetVersion },
    queryKey: { known: true, value: slot.query.queryKey },
    engineFamily: { known: true, value: plan.cohort.engineFamily },
    modelVersion: { known: true, value: plan.cohort.modelVersion },
    locale: { known: true, value: plan.cohort.locale },
    market: { known: true, value: plan.cohort.market },
    sample: {
      samplePlan: { known: true, value: { plannedCount: plan.samplePlan.plannedCount } },
      sampleIndex: { known: true, value: slot.sampleIndex },
      samplingParameters: { known: false, reason: 'not_recorded_by_source' },
    },
  }
}

function buildInterpretationIdentity(plan: GeoRuntimePlan): GeoInterpretationIdentity {
  return {
    parserVersion: { known: true, value: plan.parserVersion },
    metricRulesVersion: { known: true, value: plan.metricRulesVersion },
  }
}

function toGeoCitation(input: GeoRuntimeCitationInput): GeoEvidence['citations'][number] {
  return {
    url: input.url,
    domain: input.domain,
    ownedDomain: input.ownedDomain,
    ownedPage: { status: 'not_computable', reason: 'WP04 runtime does not implement an owned-page ledger' },
  }
}

// ── provider 结果分类：success 之外的每一种都必须变成失败观测 ───────────────────

function classifySuccessOutcome(
  outcome: Extract<GeoRuntimeProviderOutcome, { kind: 'success' }>,
  identity: { readonly acquisition: GeoAcquisitionIdentity; readonly interpretation: GeoInterpretationIdentity },
  ids: { readonly observationId: string; readonly evidenceId: string; readonly observedAt: string },
): ClassifiedAttempt {
  const evidenceCandidate: GeoEvidence = {
    evidenceId: ids.evidenceId,
    observationId: ids.observationId,
    rawResponseLocator: { known: true, value: `fake-store://${ids.observationId}` },
    citations: outcome.citations.map(toGeoCitation),
  }
  const evidenceValidation = validateGeoEvidence(evidenceCandidate)

  const observation: GeoObservation = {
    observationId: ids.observationId,
    batchId: '', // 由调用方在展开阶段填充真实 batchId 之后再校验一次
    acquisition: identity.acquisition,
    interpretation: identity.interpretation,
    confidence: { known: true, value: outcome.confidence },
    observedAt: ids.observedAt,
    outcome: evidenceValidation.ok
      ? { ok: true, evidenceId: ids.evidenceId }
      : { ok: false, errorCode: 'parser_validation_failed', errorMessage: { known: true, value: evidenceValidation.reason } },
  }

  return { observation, evidence: evidenceValidation.ok ? evidenceCandidate : null }
}

/** provider 失败/超时/限流/模糊结果 → 失败观测的 errorCode/errorMessage 分类。 */
function toFailureErrorCode(outcome: Exclude<GeoRuntimeProviderOutcome, { kind: 'success' }>): string {
  if (outcome.kind === 'timeout') return 'timeout'
  if (outcome.kind === 'rate_limited') return outcome.errorCode
  if (outcome.kind === 'ambiguous') return 'provider_outcome_unknown_no_replay'
  return outcome.errorCode
}

function toFailureErrorMessage(outcome: Exclude<GeoRuntimeProviderOutcome, { kind: 'success' }>): string | null {
  if (outcome.kind === 'provider_failure') return outcome.errorMessage
  if (outcome.kind === 'ambiguous') return outcome.reason
  return null
}

function classifyFailureOutcome(
  outcome: Exclude<GeoRuntimeProviderOutcome, { kind: 'success' }>,
  identity: { readonly acquisition: GeoAcquisitionIdentity; readonly interpretation: GeoInterpretationIdentity },
  ids: { readonly observationId: string; readonly observedAt: string },
): ClassifiedAttempt {
  const errorCode = toFailureErrorCode(outcome)
  const message = toFailureErrorMessage(outcome)
  return {
    observation: {
      observationId: ids.observationId,
      batchId: '',
      acquisition: identity.acquisition,
      interpretation: identity.interpretation,
      confidence: { known: false, reason: 'not_applicable' },
      observedAt: ids.observedAt,
      outcome: {
        ok: false,
        errorCode,
        errorMessage: message !== null ? { known: true, value: message } : { known: false, reason: 'not_recorded_by_source' },
      },
    },
    evidence: null,
  }
}

function classifyOutcome(
  plan: GeoRuntimePlan,
  slot: GeoPlannedObservationSlot,
  outcome: GeoRuntimeProviderOutcome,
  observationId: string,
  evidenceId: string,
  observedAt: string,
): ClassifiedAttempt {
  const identity = { acquisition: buildAcquisitionIdentity(plan, slot), interpretation: buildInterpretationIdentity(plan) }
  return outcome.kind === 'success'
    ? classifySuccessOutcome(outcome, identity, { observationId, evidenceId, observedAt })
    : classifyFailureOutcome(outcome, identity, { observationId, observedAt })
}

// ── 观测循环：每次可能收费的尝试前都重新 preflight ───────────────────────────────

type SlotAttempt = { readonly kind: 'stopped'; readonly reason: GeoRuntimeStopReason } | { readonly kind: 'attempted'; readonly observation: GeoObservation; readonly evidence: GeoEvidence | null; readonly costDelta: number }

async function executeOneSlot(
  plan: GeoRuntimePlan,
  slot: GeoPlannedObservationSlot,
  batchId: string,
  provider: GeoRuntimeProvider,
  budget: GeoRuntimeBudget,
  spentSoFarUsd: number,
  isFirstAttempt: boolean,
  idGenerator: () => string,
  clock: () => string,
): Promise<SlotAttempt> {
  const preflight = preflightGeoBudget(budget, spentSoFarUsd, provider.costCeilingUsdPerCall)
  if (!preflight.ok) {
    return { kind: 'stopped', reason: isFirstAttempt ? 'budget_refused_before_first_attempt' : 'budget_exhausted_mid_run' }
  }

  const outcome = await provider.call({ cohort: plan.cohort, query: slot.query, sampleIndex: slot.sampleIndex })
  const costDelta = Number.isFinite(outcome.costUsd) && outcome.costUsd >= 0 ? outcome.costUsd : provider.costCeilingUsdPerCall

  const observationId = idGenerator()
  const classified = classifyOutcome(plan, slot, outcome, observationId, idGenerator(), clock())
  const observationWithBatch: GeoObservation = { ...classified.observation, batchId }

  const observationValidation = validateGeoObservation(observationWithBatch)
  const finalObservation: GeoObservation = observationValidation.ok
    ? observationWithBatch
    : {
        ...observationWithBatch,
        confidence: { known: false, reason: 'not_applicable' },
        outcome: { ok: false, errorCode: 'observation_shape_invalid', errorMessage: { known: true, value: observationValidation.reason } },
      }

  return {
    kind: 'attempted',
    observation: finalObservation,
    evidence: finalObservation.outcome.ok ? classified.evidence : null,
    costDelta,
  }
}

interface ObservationLoopResult {
  readonly observations: readonly GeoObservation[]
  readonly evidenceList: readonly GeoEvidence[]
  readonly counts: CoverageCounts
  readonly costUsd: number
  readonly stopReason: GeoRuntimeStopReason
}

async function runObservationLoop(
  plan: GeoRuntimePlan,
  slots: readonly GeoPlannedObservationSlot[],
  batchId: string,
  provider: GeoRuntimeProvider,
  budget: GeoRuntimeBudget,
  idGenerator: () => string,
  clock: () => string,
): Promise<ObservationLoopResult> {
  const observations: GeoObservation[] = []
  const evidenceList: GeoEvidence[] = []
  const counts: CoverageCounts = { attempted: 0, succeeded: 0, failed: 0 }
  let costUsd = 0
  let stopReason: GeoRuntimeStopReason = 'plan_exhausted'

  for (const [index, slot] of slots.entries()) {
    const attempt = await executeOneSlot(plan, slot, batchId, provider, budget, costUsd, index === 0, idGenerator, clock)
    if (attempt.kind === 'stopped') {
      stopReason = attempt.reason
      break
    }

    costUsd += attempt.costDelta
    observations.push(attempt.observation)
    counts.attempted += 1
    if (attempt.observation.outcome.ok) {
      counts.succeeded += 1
      if (attempt.evidence) evidenceList.push(attempt.evidence)
    } else {
      counts.failed += 1
    }
  }

  return { observations, evidenceList, counts, costUsd, stopReason }
}

// ── 覆盖率 / 终态 / 行映射 ────────────────────────────────────────────────────

function computeStatus(counts: CoverageCounts, plannedTotal: number): GeoRuntimeBatchResult['status'] {
  if (counts.succeeded === plannedTotal && counts.attempted === plannedTotal) return 'completed'
  return counts.succeeded > 0 ? 'partial' : 'failed'
}

function buildPlannedCoverage(plan: GeoRuntimePlan, plannedTotal: number): GeoCoverageDescriptor {
  return {
    engines: [plan.cohort.engineFamily],
    models: [plan.cohort.modelVersion],
    locales: [plan.cohort.locale],
    markets: [plan.cohort.market],
    queryKeys: plan.queries.map((q) => q.queryKey),
    attempted: plannedTotal,
    succeeded: 0,
    failed: 0,
  }
}

function buildActualCoverage(plan: GeoRuntimePlan, counts: CoverageCounts, observations: readonly GeoObservation[]): GeoCoverageDescriptor {
  const queryKeys = Array.from(new Set(observations.map((o) => (o.acquisition.queryKey.known ? o.acquisition.queryKey.value : '∅'))))
  return {
    engines: counts.attempted > 0 ? [plan.cohort.engineFamily] : [],
    models: counts.attempted > 0 ? [plan.cohort.modelVersion] : [],
    locales: counts.attempted > 0 ? [plan.cohort.locale] : [],
    markets: counts.attempted > 0 ? [plan.cohort.market] : [],
    queryKeys,
    attempted: counts.attempted,
    succeeded: counts.succeeded,
    failed: counts.failed,
  }
}

function buildBatchRow(
  plan: GeoRuntimePlan,
  batchId: string,
  status: GeoRuntimeBatchResult['status'],
  coverage: { readonly planned: GeoCoverageDescriptor; readonly actual: GeoCoverageDescriptor },
  costUsd: number,
  timing: { readonly startedAt: string; readonly completedAt: string },
): GeoBatchRow {
  return {
    id: batchId,
    client_id: plan.clientId,
    query_set_id: plan.querySetId,
    started_at: timing.startedAt,
    completed_at: timing.completedAt,
    completed_at_unknown_reason: null,
    status,
    planned_coverage: { ...coverage.planned },
    actual_coverage: { ...coverage.actual },
    cost_usd: costUsd,
    cost_usd_unknown_reason: null,
    triggered_by: plan.triggeredBy,
    triggered_by_unknown_reason: null,
    created_at: timing.completedAt,
  }
}

function toObservationRow(clientId: string, batchId: string, observation: GeoObservation): GeoObservationRow {
  const a = observation.acquisition
  const i = observation.interpretation
  const outcome = observation.outcome
  return {
    id: observation.observationId,
    client_id: clientId,
    batch_id: batchId,
    query_set_version: a.querySetVersion.known ? a.querySetVersion.value : null,
    query_set_version_unknown_reason: a.querySetVersion.known ? null : a.querySetVersion.reason,
    query_key: a.queryKey.known ? a.queryKey.value : null,
    query_key_unknown_reason: a.queryKey.known ? null : a.queryKey.reason,
    engine_family: a.engineFamily.known ? a.engineFamily.value : null,
    engine_family_unknown_reason: a.engineFamily.known ? null : a.engineFamily.reason,
    model_version: a.modelVersion.known ? a.modelVersion.value : null,
    model_version_unknown_reason: a.modelVersion.known ? null : a.modelVersion.reason,
    locale: a.locale.known ? a.locale.value : null,
    locale_unknown_reason: a.locale.known ? null : a.locale.reason,
    market: a.market.known ? a.market.value : null,
    market_unknown_reason: a.market.known ? null : a.market.reason,
    sample_planned_count: a.sample.samplePlan.known ? a.sample.samplePlan.value.plannedCount : null,
    sample_planned_count_unknown_reason: a.sample.samplePlan.known ? null : a.sample.samplePlan.reason,
    sample_index: a.sample.sampleIndex.known ? a.sample.sampleIndex.value : null,
    sample_index_unknown_reason: a.sample.sampleIndex.known ? null : a.sample.sampleIndex.reason,
    sampling_parameters: a.sample.samplingParameters.known ? { ...a.sample.samplingParameters.value } : null,
    sampling_parameters_unknown_reason: a.sample.samplingParameters.known ? null : a.sample.samplingParameters.reason,
    parser_version: i.parserVersion.known ? i.parserVersion.value : null,
    parser_version_unknown_reason: i.parserVersion.known ? null : i.parserVersion.reason,
    metric_rules_version: i.metricRulesVersion.known ? i.metricRulesVersion.value : null,
    metric_rules_version_unknown_reason: i.metricRulesVersion.known ? null : i.metricRulesVersion.reason,
    confidence: observation.confidence.known ? observation.confidence.value : null,
    confidence_unknown_reason: observation.confidence.known ? null : observation.confidence.reason,
    observed_at: observation.observedAt,
    outcome_ok: outcome.ok,
    error_code: outcome.ok ? null : outcome.errorCode,
    error_message: outcome.ok ? null : outcome.errorMessage.known ? outcome.errorMessage.value : null,
    error_message_unknown_reason: outcome.ok ? null : outcome.errorMessage.known ? null : outcome.errorMessage.reason,
    source_observation_id: null,
    created_at: observation.observedAt,
  }
}

function toEvidenceRow(clientId: string, evidence: GeoEvidence, createdAt: string): GeoEvidenceRow {
  return {
    id: evidence.evidenceId,
    client_id: clientId,
    observation_id: evidence.observationId,
    raw_response: evidence.rawResponseLocator.known ? evidence.rawResponseLocator.value : null,
    raw_response_unknown_reason: evidence.rawResponseLocator.known ? null : evidence.rawResponseLocator.reason,
    raw_response_locator: evidence.rawResponseLocator.known ? evidence.rawResponseLocator.value : null,
    citations: evidence.citations,
    created_at: createdAt,
  }
}

// ── 顶层编排 ──────────────────────────────────────────────────────────────────

export async function runGeoBatch(input: RunGeoBatchInput): Promise<GeoRuntimeBatchResult> {
  const { plan, provider, store, budget } = input
  const idGenerator = input.idGenerator ?? (() => crypto.randomUUID())
  const clock = input.clock ?? (() => new Date().toISOString())

  const planValidation = validateGeoRuntimePlan(plan)
  if (!planValidation.ok) {
    throw new Error(`invalid GEO runtime plan: ${planValidation.reason}`)
  }

  const slots = expandGeoRuntimePlan(plan)
  const batchId = idGenerator()

  const loopResult = await runObservationLoop(plan, slots, batchId, provider, budget, idGenerator, clock)
  const status = computeStatus(loopResult.counts, slots.length)
  const plannedCoverage = buildPlannedCoverage(plan, slots.length)
  const actualCoverage = buildActualCoverage(plan, loopResult.counts, loopResult.observations)

  const completedAt = clock()
  const batchRow = buildBatchRow(plan, batchId, status, { planned: plannedCoverage, actual: actualCoverage }, loopResult.costUsd, {
    startedAt: loopResult.observations[0]?.observedAt ?? completedAt,
    completedAt,
  })
  const observationRows = loopResult.observations.map((o) => toObservationRow(plan.clientId, batchId, o))
  const evidenceRows = loopResult.evidenceList.map((e) => toEvidenceRow(plan.clientId, e, completedAt))

  const persistence = store.commitBatchResult({ batch: batchRow, observations: observationRows, evidence: evidenceRows })

  return {
    batchId,
    status,
    plannedCoverage,
    actualCoverage,
    costUsd: loopResult.costUsd,
    stopReason: loopResult.stopReason,
    observations: loopResult.observations,
    evidence: loopResult.evidenceList,
    persistence,
  }
}
