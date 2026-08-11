/**
 * Magic Engine 2.0 · GEO Measurement Runtime —— 对外门面（Issue #874 / WP04）
 *
 * `explicit frozen plan → budget preflight → bounded fake-provider execution →
 *  WP02 validation → atomic fake-store persistence → honest completed/partial/failed result`
 *
 * 🔴 只有 fake provider / fake in-memory store —— 没有真实 provider adapter，
 *    没有生产 Supabase 客户端（Build Control Room 2026-08-11 WP04 实施授权裁定）。
 */

export type {
  GeoRuntimeCohort,
  GeoRuntimeQuery,
  GeoRuntimeSamplePlan,
  GeoRuntimePlan,
  GeoRuntimeBudget,
  GeoBudgetPreflightResult,
  GeoRuntimeProviderCallInput,
  GeoRuntimeCitationInput,
  GeoRuntimeProviderOutcome,
  GeoRuntimeProviderIdempotency,
  GeoRuntimeProvider,
  GeoRuntimePersistOutcome,
  GeoRuntimeCommitInput,
  GeoRuntimeStore,
  GeoRuntimeStopReason,
  GeoRuntimeBatchResult,
} from './types'

export { RUNTIME_MAX_BATCH_OBSERVATIONS, validateGeoRuntimePlan, expandGeoRuntimePlan, type GeoRuntimePlanValidation, type GeoPlannedObservationSlot } from './plan'

export { preflightGeoBudget } from './budget'

export {
  createFakeGeoProvider,
  createAlwaysSucceedsFakeProvider,
  type CreateFakeGeoProviderOptions,
  type GeoFakeProviderScriptEntry,
  type GeoFakeGeoProvider,
} from './fake-provider'

export { createInMemoryGeoStore } from './store'

export { runGeoBatch, type RunGeoBatchInput } from './runtime'

export { computeGeoBatchQuality, toGeoComparabilityCohortInput } from './comparability-handoff'
