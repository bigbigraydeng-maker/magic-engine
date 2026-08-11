/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— in-memory fake store（Issue #874 / WP04）
 *
 * 🔴 本 WP 唯一授权的 store 实现。**不连接生产 Supabase，不 import
 *    `@/lib/supabase` 或 `@supabase/supabase-js`**（Build Control Room
 *    2026-08-11 WP04 裁定：不查询或修改生产数据库）。
 *
 * 🔴 在内存里复现 WP03 migration 的关键 CHECK 约束（`num_nonnulls(...)=1`、
 *    outcome_ok 与 error_code 的耦合、`geo_evidence` 与成功观测一一对应），
 *    而不是简单地把行塞进数组 —— 否则这个 fake store 证明不了原子持久化的
 *    「incomplete success state 必须 fail closed」这条验收条款。
 *
 * 🔴 「最窄的原子边界」= 一次 `commitBatchResult`：batch + 全部 observations +
 *    全部 evidence 一起校验、一起生效，一个校验不过整批都不落地
 *    （Build Control Room 2026-08-11 WP04 裁定第5条）。
 */

import type { GeoBatchRow, GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'
import type { GeoRuntimeCommitInput, GeoRuntimePersistOutcome, GeoRuntimeStore } from './types'

function countNonNull(...values: readonly unknown[]): number {
  return values.filter((v) => v !== null && v !== undefined).length
}

/** 复现 migration 里 `num_nonnulls(<field>, <field>_unknown_reason) = 1` 这一类约束。 */
function checkKnownUnknownPair(label: string, value: unknown, unknownReason: unknown): string | null {
  const count = countNonNull(value, unknownReason)
  if (count !== 1) {
    return `${label}: exactly one of value/unknown_reason must be set (got ${count})`
  }
  return null
}

function validateObservationRowInvariants(row: GeoObservationRow): string | null {
  const pairs: readonly [string, unknown, unknown][] = [
    ['query_set_version', row.query_set_version, row.query_set_version_unknown_reason],
    ['query_key', row.query_key, row.query_key_unknown_reason],
    ['engine_family', row.engine_family, row.engine_family_unknown_reason],
    ['model_version', row.model_version, row.model_version_unknown_reason],
    ['locale', row.locale, row.locale_unknown_reason],
    ['market', row.market, row.market_unknown_reason],
    ['sample_planned_count', row.sample_planned_count, row.sample_planned_count_unknown_reason],
    ['sample_index', row.sample_index, row.sample_index_unknown_reason],
    ['sampling_parameters', row.sampling_parameters, row.sampling_parameters_unknown_reason],
    ['parser_version', row.parser_version, row.parser_version_unknown_reason],
    ['metric_rules_version', row.metric_rules_version, row.metric_rules_version_unknown_reason],
    ['confidence', row.confidence, row.confidence_unknown_reason],
  ]
  for (const [label, value, unknownReason] of pairs) {
    const error = checkKnownUnknownPair(label, value, unknownReason)
    if (error) return `observation ${row.id}: ${error}`
  }

  if (row.outcome_ok) {
    if (row.error_code !== null) return `observation ${row.id}: outcome_ok=true must not carry error_code`
    if (row.error_message !== null) return `observation ${row.id}: outcome_ok=true must not carry error_message`
  } else {
    if (row.error_code === null) return `observation ${row.id}: outcome_ok=false requires error_code`
    const error = checkKnownUnknownPair('error_message', row.error_message, row.error_message_unknown_reason)
    if (error) return `observation ${row.id}: ${error}`
  }

  return null
}

function dedupeKeyOf(row: GeoObservationRow): string {
  return [
    row.batch_id,
    row.query_key ?? '∅',
    row.engine_family ?? '∅',
    row.model_version ?? '∅',
    row.locale ?? '∅',
    row.market ?? '∅',
    row.sample_index ?? '∅',
  ].join('|')
}

function validateCommit(input: GeoRuntimeCommitInput, existingBatchIds: ReadonlySet<string>): string | null {
  if (existingBatchIds.has(input.batch.id)) {
    return `batch ${input.batch.id} is already persisted — this is an internal store dedupe guard, not provider exactly-once`
  }

  const dedupeKeys = new Set<string>()
  for (const observation of input.observations) {
    if (observation.batch_id !== input.batch.id) {
      return `observation ${observation.id} does not belong to batch ${input.batch.id}`
    }
    const invariantError = validateObservationRowInvariants(observation)
    if (invariantError) return invariantError

    const key = dedupeKeyOf(observation)
    if (dedupeKeys.has(key)) return `duplicate observation dedupe key within batch: ${key}`
    dedupeKeys.add(key)
  }

  const evidenceByObservationId = new Map<string, GeoEvidenceRow>()
  for (const evidence of input.evidence) {
    if (evidenceByObservationId.has(evidence.observation_id)) {
      return `observation ${evidence.observation_id} has more than one evidence row (at most one is allowed)`
    }
    evidenceByObservationId.set(evidence.observation_id, evidence)
  }

  const observationById = new Map(input.observations.map((o) => [o.id, o] as const))
  for (const evidence of input.evidence) {
    const observation = observationById.get(evidence.observation_id)
    if (!observation) {
      return `evidence ${evidence.id} references observation ${evidence.observation_id} which is not in this commit`
    }
    if (!observation.outcome_ok) {
      return `observation ${observation.id} is a failed observation and must not have evidence`
    }
  }

  for (const observation of input.observations) {
    if (observation.outcome_ok && !evidenceByObservationId.has(observation.id)) {
      return `observation ${observation.id} succeeded but has no evidence — incomplete success state must fail closed`
    }
  }

  return null
}

export function createInMemoryGeoStore(): GeoRuntimeStore {
  const batches = new Map<string, GeoBatchRow>()
  const observationsByBatch = new Map<string, GeoObservationRow[]>()
  const evidenceByObservationId = new Map<string, GeoEvidenceRow>()

  return {
    commitBatchResult(input: GeoRuntimeCommitInput): GeoRuntimePersistOutcome {
      const error = validateCommit(input, new Set(batches.keys()))
      if (error) return { ok: false, reason: error }

      // 到这里全部校验通过 —— 一次性生效，不存在「只提交了一半」的中间态。
      batches.set(input.batch.id, input.batch)
      observationsByBatch.set(input.batch.id, [...input.observations])
      for (const evidence of input.evidence) {
        evidenceByObservationId.set(evidence.observation_id, evidence)
      }
      return { ok: true }
    },

    getBatch(batchId: string): GeoBatchRow | undefined {
      return batches.get(batchId)
    },

    getObservations(batchId: string): readonly GeoObservationRow[] {
      return observationsByBatch.get(batchId) ?? []
    },

    getEvidence(observationId: string): GeoEvidenceRow | undefined {
      return evidenceByObservationId.get(observationId)
    },
  }
}
