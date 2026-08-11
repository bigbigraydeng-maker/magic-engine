/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 运行时类型（Issue #874 / WP04）
 *
 * 🔴 **这个模块只证明一件事**：`explicit frozen plan → budget preflight →
 *    bounded fake-provider execution → WP02 validation → atomic fake-store
 *    persistence → honest completed/partial/failed result`。
 *    没有 Kernel、没有真实 provider、没有生产 Supabase、没有 cron/route、
 *    没有 UI（Build Control Room 2026-08-11 WP04 实施授权裁定）。
 *
 * 🔴 类型直接 import WP02 契约与 WP03 行形状，不重写一份平行定义 ——
 *    「运行时结果」必须是「契约认可的观测/证据」，不是另一套自说自话的形状。
 */

import type { GeoCoverageDescriptor, GeoEvidence, GeoMaybeUnknown, GeoObservation } from '@/lib/geo-measurement'
import type { GeoBatchRow, GeoEvidenceRow, GeoObservationRow } from '@/lib/geo-measurement-store/types'

// ── 显式冻结的计划（无隐藏默认值） ───────────────────────────────────────────

/** 一个批次 = 一个显式 cohort（GEO契约要求的 7 项身份中的 4 项固定不变）。 */
export interface GeoRuntimeCohort {
  readonly engineFamily: string
  readonly modelVersion: string
  readonly locale: string
  readonly market: string
}

export interface GeoRuntimeQuery {
  readonly queryKey: string
  readonly questionText: string
}

/** 显式样本计划 —— 没有隐藏默认值，调用方必须给出打算问几次。 */
export interface GeoRuntimeSamplePlan {
  readonly plannedCount: number
}

/**
 * 冻结的批次执行计划。每一项都必须显式提供，任何一项缺失都在
 * {@link validateGeoRuntimePlan} 阶段 fail closed，不补默认值
 * （Build Control Room 2026-08-11 WP04 裁定第2条）。
 */
export interface GeoRuntimePlan {
  readonly clientId: string
  /** `geo_query_sets.id`（WP03 行的主键）—— 与 `querySetVersion` 是两件事，不许混用。 */
  readonly querySetId: string
  readonly querySetVersion: string
  readonly cohort: GeoRuntimeCohort
  readonly queries: readonly GeoRuntimeQuery[]
  readonly samplePlan: GeoRuntimeSamplePlan
  readonly parserVersion: string
  readonly metricRulesVersion: string
  readonly triggeredBy: string
  /**
   * 调用方声明的本批次观测数上限。必须 ≥ 实际展开的 `queries.length × samplePlan.plannedCount`，
   * 且不能超过 {@link RUNTIME_MAX_BATCH_OBSERVATIONS} 这个硬顶 —— 一个批次不许装下整个查询集
   * （Build Control Room 2026-08-11 WP04 裁定第3条：不建通用 workflow engine，用确定性上限代替）。
   */
  readonly maxPlannedObservations: number
}

// ── 预算 ──────────────────────────────────────────────────────────────────────

/** 授权额度。调用前的整批余量与每次可能收费尝试前的余量都从这里算。 */
export interface GeoRuntimeBudget {
  readonly authorizedUsd: number
}

export type GeoBudgetPreflightResult =
  | { readonly ok: true; readonly remainingUsd: number }
  | { readonly ok: false; readonly reason: string }

// ── Provider 端口（本 WP 只有 fake 实现） ────────────────────────────────────

export interface GeoRuntimeProviderCallInput {
  readonly cohort: GeoRuntimeCohort
  readonly query: GeoRuntimeQuery
  readonly sampleIndex: number
}

export interface GeoRuntimeCitationInput {
  readonly url: string
  readonly domain: string
  readonly ownedDomain: GeoMaybeUnknown<boolean>
}

/**
 * provider 调用的结果类别。`success` 之外的每一种都必须变成失败观测，
 * 绝不允许被汇总成功（Build Control Room 2026-08-11 WP04 裁定第7条）。
 */
export type GeoRuntimeProviderOutcome =
  | {
      readonly kind: 'success'
      readonly rawResponse: string
      readonly citations: readonly GeoRuntimeCitationInput[]
      readonly confidence: number
      readonly costUsd: number
    }
  | { readonly kind: 'provider_failure'; readonly errorCode: string; readonly errorMessage: string | null; readonly costUsd: number }
  | { readonly kind: 'timeout'; readonly costUsd: number }
  | { readonly kind: 'rate_limited'; readonly errorCode: string; readonly costUsd: number }
  /**
   * 网络/超时导致的「不知道 provider 那边到底成没成」，且 provider 不保证幂等 ——
   * 诚实地记未知，绝不自动重放（Build Control Room 2026-08-11 WP04 裁定第4条）。
   */
  | { readonly kind: 'ambiguous'; readonly reason: string; readonly costUsd: number }

/**
 * provider 的幂等能力声明。`supported: false` 时运行时**不得**自动重放
 * ambiguous 结果 —— 内部 run/store 幂等不等于 provider exactly-once。
 */
export interface GeoRuntimeProviderIdempotency {
  readonly supported: boolean
  readonly note: string
}

export interface GeoRuntimeProvider {
  /** 每次调用声明的成本上界。preflight 用它跟剩余预算比较，不猜测。 */
  readonly costCeilingUsdPerCall: number
  readonly idempotency: GeoRuntimeProviderIdempotency
  call(input: GeoRuntimeProviderCallInput): Promise<GeoRuntimeProviderOutcome>
}

// ── Store 端口（本 WP 只有 fake / in-memory 实现） ───────────────────────────

export type GeoRuntimePersistOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export interface GeoRuntimeCommitInput {
  readonly batch: GeoBatchRow
  readonly observations: readonly GeoObservationRow[]
  readonly evidence: readonly GeoEvidenceRow[]
}

/**
 * 最窄的原子 fake-store 边界：一次 `commitBatchResult` 要么整批（batch +
 * 全部 observations + 全部 evidence）一起生效，要么一行都不落地。
 * 没有「批次已存在部分观测」这种中间态可读（Build Control Room 2026-08-11
 * WP04 裁定第5条）。
 */
export interface GeoRuntimeStore {
  commitBatchResult(input: GeoRuntimeCommitInput): GeoRuntimePersistOutcome
  getBatch(batchId: string): GeoBatchRow | undefined
  getObservations(batchId: string): readonly GeoObservationRow[]
  getEvidence(observationId: string): GeoEvidenceRow | undefined
}

// ── 运行结果 ──────────────────────────────────────────────────────────────────

export type GeoRuntimeStopReason =
  | 'plan_exhausted'
  | 'budget_refused_before_first_attempt'
  | 'budget_exhausted_mid_run'

/**
 * 一次运行的诚实产物。**刻意拆开** `measurement`（这一轮到底测到了什么）
 * 与 `persistence`（这一轮到底存住了没有）—— 任何一边失败都不许悄悄折成成功
 * （Build Control Room 2026-08-11 WP04 裁定第5条 + GEO契约验收条款）。
 */
export interface GeoRuntimeBatchResult {
  readonly batchId: string
  readonly status: 'completed' | 'partial' | 'failed'
  readonly plannedCoverage: GeoCoverageDescriptor
  readonly actualCoverage: GeoCoverageDescriptor
  readonly costUsd: number
  readonly stopReason: GeoRuntimeStopReason
  readonly observations: readonly GeoObservation[]
  readonly evidence: readonly GeoEvidence[]
  readonly persistence: GeoRuntimePersistOutcome
}
