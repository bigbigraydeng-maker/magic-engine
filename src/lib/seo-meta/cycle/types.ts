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

/**
 * One page the cycle is considering acting on, pre-gate.
 *
 * 事故 2026-09-20（W38 第一次上线）之后：`keyword` here is PROVISIONAL — a
 * slug-derived placeholder, never what actually gets written anywhere. The
 * gate (gate.ts) is the only thing allowed to assign a real target keyword,
 * because it does so by asking GSC what THIS page's own queries are
 * (fetchGscQueriesForPage), not by guessing from a site-wide query list.
 * searchVolume/keywordDifficulty are likewise always null here — the gate
 * fills them from a fresh keyword_snapshots read, never before.
 */
export interface MetaCycleCandidate {
  /** Normalised (trailing slash + case) so GSC rows dedupe correctly. */
  pageUrl: string | null
  slug: string | null
  /** Provisional (slug words) until the gate replaces it with a real, page-verified keyword. */
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

/**
 * The evidence trail the information-completeness gate collected for a
 * candidate that passed every check (gate.ts). PM 2026-09-20 (incident
 * follow-up) requires this be visible in both the PR description and
 * seo_meta_log — "PM 要能一眼核对" — not just used internally to decide.
 */
export interface MetaCycleGateEvidence {
  keyword: string
  searchVolume: number
  /** null when the only data available was a live DataForSEO search-volume lookup — that endpoint doesn't return difficulty. Never a coerced 0 (PM 2026-09-20 incident root cause #2 was exactly `?? 0` making "no data" look like "definitely safe"). */
  keywordDifficulty: number | null
  snapshotDate: string
  /** Top-3 competitor page titles from the live SERP check. */
  competitorTitles: string[]
  /** This client's own ranking URL for `keyword` in that same SERP call, if any. */
  ctsRankingUrl: string | null
  /** Human-readable "why this page, why this keyword" — e.g. which of the page's own GSC queries matched. */
  chosenReason: string
}

/** A candidate the gate rejected, and exactly which check stopped it — PM 2026-09-20: "选中但没改成的页，必须有回执写明卡在哪一条，不许静默丢". */
export interface MetaCycleGateFailure {
  candidate: MetaCycleCandidate
  /** Machine-readable — one of gate.ts's GATE_REASON constants. */
  reason: string
  /** Human-readable detail for the receipt. */
  detail: string
}

export interface MetaCyclePrescription {
  candidate: MetaCycleCandidate
  actionType: MetaCycleActionType
  auto: boolean
  reason: string
  evidence: MetaCycleGateEvidence
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
  /**
   * Cheap pre-check: is this slug backed by an editable data file at all?
   * PM 2026-09-20 (data-completeness follow-up): this used to only be
   * discovered in step 4's apply() call, AFTER the gate had already spent a
   * live GSC query, a keyword_snapshots/DataForSEO lookup, and a live SERP
   * call on the candidate. Calling this FIRST (step 3, before the gate)
   * means an unreachable page (e.g. forbidden-city-travel-guide, which has
   * no matching src/lib/data file in the CTS repo) is skipped for free.
   * No network/DB writes; safe to call before dryRun is even decided.
   */
  canEditSlug(slug: string | null): Promise<boolean>
  /**
   * Apply a new title/desc for one candidate. Must be a no-op (no
   * network/DB writes) when dryRun is true. `applied: true` means the
   * change is actually MERGED and live — a PR that opened but failed to
   * merge must return applied:false with skipReason:'pr_opened_but_not_merged'
   * so the caller routes it to the manual board instead of logging a change
   * that never happened.
   *
   * `evidence` MUST be surfaced in whatever the adapter produces (PR
   * description, etc.) — PM 2026-09-20 incident follow-up: a human must be
   * able to check the search volume/difficulty/competitor titles/CTS's own
   * ranking URL without leaving the PR.
   */
  apply(input: {
    candidate: MetaCycleCandidate
    newTitle: string
    newDesc: string
    weekKey: string
    dryRun: boolean
    evidence: MetaCycleGateEvidence
  }): Promise<ApplyAdapterResult>
}
