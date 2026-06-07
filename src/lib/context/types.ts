/**
 * Phase B — Unified Client Context Layer
 *
 * ClientContext is the single source of truth loaded once per request,
 * shared across all agents in the orchestration chain.
 *
 * Design principles:
 *   - Loaded once, passed everywhere — no agent queries client data independently
 *   - snapshotAt records when data was fetched — used by synthesizer to resolve conflicts
 *   - All fields optional with sane defaults so loading never blocks on partial failure
 *
 * Reference: ROADMAP.md Phase B (柔性 Agent 架构)
 */

import type { MemoryContext } from '@/lib/memory/types'

// ─── Core client shape (subset of DB row we actually need) ──────────────────

export interface ClientSummary {
  id: string
  name: string
  domain: string
  primary_keywords: string[] | null
  brand_aliases: string[] | null
  competitor_domains: string[] | null
  industry: string | null
  market: 'AU' | 'NZ' | string
  semrush_db: string
}

export interface MasterBriefSummary {
  brand_name: string | null
  core_proposition: string | null
  target_audience: string | null
  content_pillars: string[] | null
  keyword_seeds: string[] | null
}

export interface RecentOutcomeSummary {
  action_type: string
  flywheel: string
  verdict: 'confirmed' | 'reversed' | 'inconclusive'
  metric_key: string
  delta_pct: number | null
  computed_at: string
}

// ─── The unified context object ──────────────────────────────────────────────

export interface ClientContext {
  client: ClientSummary
  masterBrief: MasterBriefSummary | null
  memory: MemoryContext
  recentOutcomes: RecentOutcomeSummary[]
  /** ISO timestamp of when this context was loaded — used for conflict resolution */
  snapshotAt: string
}

// ─── Agent output metadata (added to every agent response) ──────────────────

export interface AgentOutputMeta {
  agent: 'zhangqian' | 'huatuo' | 'zhuge' | 'luban' | 'libai' | 'maliang'
  client_id: string
  context_snapshot_at: string
  confidence?: number
}

// ─── Capability registry types ───────────────────────────────────────────────

export type GrowthCapabilityKey =
  | 'collect'
  | 'diagnose'
  | 'plan'
  | 'execute'
  | 'write_seo'
  | 'write_geo'

/** Keys for devops/internal capabilities — not used in growth orchestration */
export type DevopsCapabilityKey =
  | 'review_code'
  | 'review_ux'
  | 'qa_test'

export type CapabilityKey = GrowthCapabilityKey | DevopsCapabilityKey

export interface CapabilityDefinition<TInput, TOutput> {
  /** Human-readable label */
  label: string
  /** Adapter: maps ClientContext + prior runtime outputs → agent-specific args */
  adapter: (ctx: ClientContext, runtime: RuntimeOutputs) => Promise<TOutput> | TOutput
  /** Which runtime output keys must exist before this capability can run */
  needs_runtime: (keyof RuntimeOutputs)[]
  /** Which key in RuntimeOutputs this capability writes to */
  output_key: keyof RuntimeOutputs
}

// ─── Runtime outputs (accumulated during orchestration) ─────────────────────

export interface RuntimeOutputs {
  discovery?: import('@/lib/zhangqian/types').DiscoveryReport
  prescription?: import('@/lib/huatuo/types').HuatuoPrescriptionResult
  plan?: import('@/lib/zhuge/types').ZhugeOutput
  execution?: unknown
}

// ─── Execution plan (returned by ZiyaRouter) ────────────────────────────────

export interface ExecutionPlan {
  task_type: string
  /** Ordered list of growth capabilities to run */
  capabilities: GrowthCapabilityKey[]
  /** Capabilities that can run in parallel (subset of capabilities) */
  parallel: GrowthCapabilityKey[]
  /** Capabilities that must run sequentially, in order */
  sequential: GrowthCapabilityKey[]
  /** Which ClientContext fields are needed (for lazy loading optimisation) */
  context_needs: (keyof ClientContext)[]
}
