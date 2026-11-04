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
  /**
   * The client's own brand words (clients.seo_config.brand_terms). Never a page fact:
   * the hard fact check must not demand they survive a rewrite — 2026-10-28 every CTS
   * proposal was blocked for "dropping CTS" while the brand voice forbids adding the
   * brand suffix. Optional so existing configs/fixtures stay valid (missing = []).
   */
  brandTerms?: string[]
  /**
   * PM 2026-09-20 (fourth pass): DataForSEO location_codes to try (in order)
   * when the client's own primary market has no data — e.g. CTS configures
   * [2036] (AU) because DataForSEO doesn't index many NZ long-tail queries.
   * Per-client config, not a shared default: PM was explicit that AU/NZ
   * substitution is NOT valid for every industry/client, so this must default
   * to [] (no fallback) unless a client's own clients.seo_config sets
   * meta_cycle_keyword_fallback_locations (roster.ts validates: positive
   * integers only, max 2).
   */
  keywordFallbackLocations: number[]
  /**
   * Slugs this client has flagged as high-stakes conversion pages (quote/
   * lead-gen pages, the homepage) — the meta-cycle skips these entirely, no
   * matter what the gate or fact-check would otherwise allow. PM 2026-09-23
   * incident follow-up: /china-tours (CTS's highest-converting page) almost
   * had its departure-city coverage silently narrowed by an auto-merged
   * change that both the gate and the AI fact-judge let through. Automated
   * small-copy edits are an acceptable risk on content pages; never on a
   * page that's a customer's primary enquiry entry point. Read from
   * clients.seo_config.meta_cycle_protected_slugs (roster.ts) — client-level
   * config (L4), same pattern as keywordFallbackLocations. Defaults to []
   * (no client is protected by default; each client opts specific slugs in).
   */
  protectedSlugs: string[]
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
 * PM 2026-09-20 (fourth pass): where keywordData (searchVolume +
 * keywordDifficulty) actually came from — DataForSEO's own coverage gaps in
 * small markets (NZ long-tail queries especially) mean not every candidate
 * resolves the same way, and PM wants the source visible everywhere the
 * numbers are, not just implied by which location_code shows up.
 *   'dataforseo_primary'  — client's own market (keyword_snapshots or a live
 *                           bulkKeywordVolume call at that location).
 *   'dataforseo_fallback' — a client-configured fallback location_code
 *                           (MetaCycleClientConfig.keywordFallbackLocations).
 *   'gsc_serp'            — neither DataForSEO location had data: searchVolume
 *                           is this page's own GSC impressions for the
 *                           keyword (≥30, the same floor outcome-classifier.ts
 *                           uses), keywordDifficulty is an average SERP-
 *                           competitor domain-authority estimate (NOT a real
 *                           DataForSEO difficulty score — always labelled as
 *                           such in chosenReason/PR body/receipts).
 */
export type MetaCycleKeywordDataSource = 'dataforseo_primary' | 'dataforseo_fallback' | 'gsc_serp'

/**
 * The evidence trail the information-completeness gate collected for a
 * candidate that passed every check (gate.ts). PM 2026-09-20 (incident
 * follow-up) requires this be visible in both the PR description and
 * seo_meta_log — "PM 要能一眼核对" — not just used internally to decide.
 */
export interface MetaCycleGateEvidence {
  keyword: string
  /** Search volume AND difficulty are both hard requirements — gate.ts's resolveKeywordData only returns success when neither is null, from whichever tier supplied them (PM 2026-09-20, third/fourth pass: a partial result is treated the same as no result, never coerced or let through with a gap). */
  searchVolume: number
  keywordDifficulty: number
  snapshotDate: string
  keywordDataSource: MetaCycleKeywordDataSource
  /** The DataForSEO location_code actually used (tiers 1–2). null for gsc_serp (tier 3) — there's no single "location" for a GSC-impressions + SERP-domain-authority estimate. */
  keywordDataLocation: number | null
  /** Human-readable "where did this number come from" — e.g. "需求来自谷歌后台真实曝光 214 次；难度按谷歌前三名网站强度估算为 38（非 DataForSEO 难度分）". Rendered directly into the PR body, dry-run JSON, and receipts (PM: "都用人话标来源"). */
  keywordDataNote: string
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
  /**
   * dryRun: true MUST be read-only and MUST accept empty newTitle/newDesc — the
   * runner calls it that way first to read the page's current title/description
   * (oldTitle/oldDesc) before generating (2026-10-28). Any new implementation
   * (e.g. wp_plugin) has to honour this.
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
