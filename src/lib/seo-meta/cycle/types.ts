/**
 * SEO Meta-Cycle v1 — shared types for the six-step IMPACT chain
 * (docs/specs/2026-09-20-seo-meta-cycle-v1-spec.md).
 *
 * Client-agnostic on purpose (Domain Semantics Gate / 换客户测试): nothing
 * here names CTS. Client-specific behaviour (repo path, meta file format,
 * brand voice) lives behind the `ApplyAdapter` interface, implemented per
 * client in cycle/apply-adapter.ts.
 */

/** L4 client configuration read from clients.seo_config->meta_cycle_*. */
export interface MetaCycleClientConfig {
  clientId: string
  domain: string
  semrushDb: string | null
  maxPagesPerRun: number
  cooldownDays: number
  brandVoice: string
}

export type MetaCycleCandidateSource = 'patrol' | 'gsc' | 'gap'

/** One page/keyword pair the cycle is considering acting on, pre-enrichment. */
export interface MetaCycleCandidate {
  /** Normalised (trailing slash + case) so patrol/GSC/gap sources dedupe correctly. */
  pageUrl: string | null
  slug: string | null
  keyword: string
  source: MetaCycleCandidateSource
  position: number | null
  impressions: number | null
  searchVolume: number | null
  keywordDifficulty: number | null
  discoveredNotIndexed: boolean
}

export type MetaCycleActionType =
  | 'title_rewrite'
  | 'index_request'
  | 'content_refresh'
  | 'new_page'
  | 'internal_link'
  | 'skip'

export interface MetaCyclePrescription {
  candidate: MetaCycleCandidate
  actionType: MetaCycleActionType
  auto: boolean
  reason: string
}

export type MetaCycleOutcome = 'improved' | 'flat' | 'regressed' | 'insufficient_data'

export interface MetaCycleBaseline {
  ctr: number | null
  position: number | null
  impressions: number | null
}

export interface MetaCycleObserved {
  ctr: number | null
  position: number | null
  impressions: number | null
  clicks: number | null
}

/** What a client-specific adapter must implement to plug into the generic runner (L3 Connector). */
export interface ApplyAdapterResult {
  applied: boolean
  prUrl?: string
  prNumber?: number
  branch?: string
  newTitle: string
  newDesc: string
  oldTitle: string
  oldDesc: string
  skipReason?: string
}

export interface ApplyAdapterRevertInput {
  slug: string
  lastWrittenTitle: string
  lastWrittenDesc: string
  revertToTitle: string
  revertToDesc: string
}

export interface ApplyAdapter {
  readonly channel: 'pr' | 'wp_plugin'
  /** Apply a new title/desc for one candidate. Must be a no-op (no network/DB writes) when dryRun is true. */
  apply(input: {
    candidate: MetaCycleCandidate
    newTitle: string
    newDesc: string
    weekKey: string
    dryRun: boolean
  }): Promise<ApplyAdapterResult>
  /**
   * True revert: write back the EXACT text we last wrote over, never a fresh
   * AI regeneration (魏征 finding #7). Must first confirm the live content
   * still matches lastWrittenTitle/lastWrittenDesc — if a human has hand-edited
   * the slug since our last write, return applied:false with skipReason set
   * instead of clobbering the human edit.
   */
  revert(input: ApplyAdapterRevertInput & { weekKey: string; dryRun: boolean }): Promise<ApplyAdapterResult>
}
