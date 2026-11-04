/**
 * Request / response bodies for the tour-catalog publish routes, shared by the API routes
 * and the admin page. Type-only module: safe to import from client components.
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.8 / §6.8.1
 *
 * Vocabulary: "draft" = the working tables; "published" = the frozen snapshot channels read.
 */

import type { PublishContributor } from './catalog-contract'

export type PublishRisk = 'high' | 'normal'

export type PublishChangeKind =
  | 'tour_added'
  | 'tour_removed'
  | 'tour_field'
  | 'departure_added'
  | 'departure_removed'
  | 'departure_field'
  /** Derived: the tour as a whole flips between sellable and not sellable in the outward feed. */
  | 'sellable_flip'

export interface PublishChange {
  kind: PublishChangeKind
  tourId: string
  tourName: string
  /** YYYY-MM-DD, present on departure_* changes. */
  departOn?: string
  /** Machine field name, present on *_field changes (e.g. "displayPriceText", "status"). */
  field?: string
  /** Human label in Chinese, always present (e.g. "展示价", "班期状态", "新增班期"). */
  fieldLabel: string
  before: string | null
  after: string | null
  risk: PublishRisk
}

export interface SellableCheck {
  /** Sellable tours in the outward feed, currently published. */
  before: number
  /** Sellable tours in the outward feed, if this goes ahead. */
  after: number
  /** True when `after` is 0, dropped by more than 30%, or this is a first publish — the caller must type `after` to proceed. */
  needsCountConfirm: boolean
}

export interface FirstPublishRow {
  tourId: string
  tourName: string
  displayPriceText: string | null
  upcomingDepartures: number
  nextDepartOn: string | null
  sellable: boolean
}

/** GET …/tour-catalog/publish — status bar + the comparison table in one call. */
export interface PublishPreviewResponse {
  /** 0 = never published. */
  publishedVersion: number
  publishedAt: string | null
  publishedBy: string | null
  /** Working-copy revision the diff was computed against. */
  draftVersion: number
  firstPublish: boolean
  /** Empty when the draft equals what is published. On a first publish this is empty; see firstPublishRows. */
  changes: PublishChange[]
  changedTourIds: string[]
  highRiskCount: number
  sellable: SellableCheck
  /** Non-null when the latest published version was a revert: publishing needs an extra acknowledgement. */
  afterRevert: { toVersion: number } | null
  firstPublishRows: FirstPublishRow[]
  diffHash: string
  /** Who changed how much since the last publish (masked for client editors). Not part of diffHash. */
  contributors?: PublishContributor[]
}

/** POST …/tour-catalog/publish */
export interface PublishRequest {
  draftVersion: number
  publishedVersion: number
  diffHash: string
  acknowledgeHighRisk: boolean
  acknowledgeAfterRevert: boolean
  confirmSellableCount: number | null
  note: string
}

export interface PublishResponse {
  ok: true
  version: number
  websiteSync: 'revalidated' | 'not_configured' | 'failed'
}

export type PublishErrorCode =
  | 'nothing_to_publish'
  | 'stale'
  | 'high_risk_unacknowledged'
  | 'after_revert_unacknowledged'
  | 'sellable_count_mismatch'
  | 'invalid_request'
  | 'version_not_found'
  | 'already_current'
  | 'publish_failed'

export interface PublishErrorResponse {
  error: PublishErrorCode
}

export interface PublishedVersionView {
  version: number
  createdAt: string
  publishedBy: string
  note: string
  /** Set when this version was produced by reverting to an older one. */
  sourceVersion: number | null
  changeCount: number
  highRiskCount: number
  isCurrent: boolean
}

/** GET …/tour-catalog/publish/history */
export interface PublishHistoryResponse {
  versions: PublishedVersionView[]
}

export interface KeptStatusRow {
  tourName: string
  departOn: string
  /**
   * Status the departure will have after the revert: what is published now, or
   * 「已关闭（现在对外已没有这个班期）」when the departure no longer exists outward and comes back closed.
   */
  currentStatus: string
  /** Status that version N had and that is NOT restored. */
  oldStatus: string
}

/** GET …/tour-catalog/publish/revert?version=N — what going back to version N would change outward. */
export interface RevertPreviewResponse {
  targetVersion: number
  publishedVersion: number
  changes: PublishChange[]
  highRiskCount: number
  keptStatuses: KeptStatusRow[]
  sellable: SellableCheck
  diffHash: string
}

/** POST …/tour-catalog/publish/revert */
export interface RevertRequest {
  version: number
  publishedVersion: number
  diffHash: string
  acknowledgeHighRisk: boolean
  confirmSellableCount: number | null
}

/**
 * One visible (open / limited, today or later) departure of a published tour, for outward channels
 * that need more than the website feed carries (e.g. email). No `internal` data.
 */
export interface PublishedTourFactDeparture {
  /** Calendar day, YYYY-MM-DD. */
  departOn: string
  /** Same display format as the website, e.g. "11 March 2027". */
  displayDate: string
  status: 'open' | 'limited'
  priceTextOverride: string | null
}

/** A published tour as the email channel sees it: the published snapshot only, never the draft. */
export interface PublishedTourFact {
  id: string
  slug: string
  destination: string
  tier: string
  name: string
  title: string | null
  durationText: string | null
  displayPriceText: string | null
  highlights: string[]
  inclusions: string[]
  exclusions: string[]
  singleSupplement: string | null
  /** Whole-tour "sold out" banner, as published. */
  soldOut: boolean
  managesDepartures: boolean
  /** Same sellable rule as the website feed: active, and (if it manages departures) at least one visible departure. */
  isActive: boolean
  departures: PublishedTourFactDeparture[]
}

export type PublishedTourFactsRead =
  | { published: false }
  | { published: true; version: number; tours: PublishedTourFact[] }
