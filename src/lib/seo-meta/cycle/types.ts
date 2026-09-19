/**
 * SEO Meta-Cycle v1 — shared types for the six-step IMPACT chain
 * (docs/specs/2026-09-20-seo-meta-cycle-v1-spec.md).
 *
 * Client-agnostic on purpose (Domain Semantics Gate / 换客户测试): nothing
 * here names CTS. Client-specific behaviour (repo path, meta file format,
 * brand voice) lives behind the `ApplyAdapter` interface, implemented per
 * client in cycle/apply-adapter.ts.
 *
 * PM 2026-09-20 精简拍板: real usage is ≤3 pages/week for one client, and the
 * two review-round bugs both came from the "auto-revert" machinery — so
 * auto-revert, oscillation, cross-client budget breaking, orphan-PR
 * pagination, and 4 of the 6 action types are cut. A regressed page becomes
 * ONE manual kanban item pointing at the GitHub PR's own Revert button —
 * zero new code for the revert mechanism itself.
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

/** GSC only — patrol was dropped (复审 2026-09-20: unit mismatch + wrong-page risk, see candidates.ts). */
export type MetaCycleCandidateSource = 'gsc'

/** One page/keyword pair the cycle is considering acting on, pre-enrichment. */
export interface MetaCycleCandidate {
  /** Normalised (trailing slash + case) so patrol/GSC sources dedupe correctly. */
  pageUrl: string | null
  slug: string | null
  keyword: string
  source: MetaCycleCandidateSource
  position: number | null
  impressions: number | null
  /** GSC CTR at discovery time, 0-1 decimal fraction (matches gsc_performance_snapshots.top_pages.ctr's real scale — NOT a 0-100 percentage). Carried through to seo_meta_log.baseline_ctr at apply time — without this, the Check step's outcome classifier can never compute a baseline and permanently returns insufficient_data. */
  ctr: number | null
  searchVolume: number | null
  keywordDifficulty: number | null
}

/** Only two outcomes now: PM cut content_refresh/new_page/internal_link (seo-patrol already routes those to 诸葛亮's kanban — running them through this cycle too would double the manual to-do) and index_request (owned by the merged-PR webhook, issue #1794). */
export type MetaCycleActionType = 'title_rewrite' | 'skip'

export interface MetaCyclePrescription {
  candidate: MetaCycleCandidate
  actionType: MetaCycleActionType
  auto: boolean
  reason: string
}

export type MetaCycleOutcome = 'improved' | 'flat' | 'regressed' | 'insufficient_data'

export interface MetaCycleBaseline {
  /** 0-1 decimal fraction, same scale as MetaCycleCandidate.ctr. */
  ctr: number | null
  position: number | null
  impressions: number | null
}

export interface MetaCycleObserved {
  /** 0-1 decimal fraction. */
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

export interface ApplyAdapter {
  readonly channel: 'pr' | 'wp_plugin'
  /** Apply a new title/desc for one candidate. Must be a no-op (no network/DB writes) when dryRun is true. `applied: true` means the change is actually MERGED and live — a PR that opened but failed to merge must return applied:false with skipReason:'pr_opened_but_not_merged' so the caller routes it to the manual board instead of logging a change that never happened. */
  apply(input: {
    candidate: MetaCycleCandidate
    newTitle: string
    newDesc: string
    weekKey: string
    dryRun: boolean
  }): Promise<ApplyAdapterResult>
}
