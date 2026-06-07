/**
 * Phase B — Unified Client Context Layer
 * Public exports
 */

export { loadClientContext } from './loader'
export { GROWTH_CAPABILITY_REGISTRY } from './registry'
export { runOrchestration } from './orchestrator'
export type {
  ClientContext,
  ClientSummary,
  MasterBriefSummary,
  RecentOutcomeSummary,
  AgentOutputMeta,
  GrowthCapabilityKey,
  DevopsCapabilityKey,
  ExecutionPlan,
  RuntimeOutputs,
} from './types'
