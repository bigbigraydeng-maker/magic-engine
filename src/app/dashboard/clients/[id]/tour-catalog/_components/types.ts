/** Response shapes of /api/clients/[id]/tour-catalog/* as consumed by the admin page. */

import type { CatalogAccessEnvelope } from '@/lib/tour-catalog/catalog-contract'

export interface CatalogItineraryDayView {
  day: number
  title: string
  description: string
  meals?: string[]
}

export interface CatalogTourView {
  id: string
  slug: string
  destination: string
  tier: string
  name: string
  displayPriceText: string | null
  isActive: boolean
  managesDepartures: boolean
  // Full editable fields (present in the GET snapshot; optional so older fixtures still type-check).
  title?: string | null
  shortDescription?: string | null
  durationText?: string | null
  highlights?: string[]
  itinerary?: CatalogItineraryDayView[]
  inclusions?: string[]
  exclusions?: string[]
  tourCities?: string[]
  singleSupplement?: string | null
  maxGroupSize?: number | null
  /** Optimistic-concurrency token; send back unchanged when saving. */
  updatedAt?: string
}

export interface CatalogDepartureView {
  id: string
  tourId: string
  departOn: string
  returnOn: string | null
  status: 'open' | 'limited' | 'sold_out' | 'closed' | 'cancelled'
  priceTextOverride: string | null
  /** Optimistic-concurrency token; send back unchanged when saving. */
  updatedAt?: string
}

export interface CatalogBatchView {
  id: string
  kind: string
  status: 'previewed' | 'applied' | 'rolled_back' | 'rejected'
  rowCounts: Record<string, unknown>
  createdAt: string
}

export interface CatalogSnapshotResponse extends CatalogAccessEnvelope {
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
  /** Only sent to people who may manage aliases. */
  aliases?: Array<{ aliasNorm: string; tourId: string }>
  /** Only sent to people who may import. */
  batches?: CatalogBatchView[]
  /** The client's own website domain, used to read its existing tours. */
  domain: string | null
}

export interface PreviewSummaryView {
  adds: number
  updates: number
  unchanged: number
  rejected: number
  warningCount: number
}

export interface PreviewRejectedView {
  line: number
  reason: string
  detail?: string
  /** Raw tour name from the CSV row, when known. */
  tourName?: string
}

export type PreviewWarningView =
  | { kind: 'suspected_typo'; tourId: string; newDate: string; nearDate: string; days: number }
  | { kind: 'not_in_file'; tourId: string; departureId: string; departOn: string }
  | { kind: 'cancelled_kept'; tourId: string; departureId: string; departOn: string }
  | { kind: 'reopens_cancelled'; tourId: string; departureId: string; departOn: string; newStatus: string }

export interface PreviewResponse {
  batchId: string | null
  planHash: string | null
  summary: PreviewSummaryView
  adds: Array<{ line: number; tourId: string; departOn: string; returnOn: string; status: string }>
  updates: Array<{
    line: number
    departureId: string
    tourId: string
    departOn: string
    before: { returnOn: string | null; status: string }
    after: { returnOn: string; status: string }
  }>
  rejected: PreviewRejectedView[]
  warnings: PreviewWarningView[]
}

export interface ChangeLogEntryView {
  id: string
  entity: 'tour' | 'departure'
  entityId: string
  action: 'insert' | 'update' | 'delete'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  actor: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// AI assistant proposal shapes (client-side mirror of the server contract).
// Re-declared here so client components never import server modules.
// ---------------------------------------------------------------------------

export interface TourPatchView {
  name?: string
  title?: string | null
  displayPriceText?: string | null
  durationText?: string | null
  shortDescription?: string | null
  highlights?: string[]
  itinerary?: CatalogItineraryDayView[]
  inclusions?: string[]
  exclusions?: string[]
  tourCities?: string[]
  singleSupplement?: string | null
  maxGroupSize?: number | null
  isActive?: boolean
  managesDepartures?: boolean
}

export interface DeparturePatchView {
  returnOn?: string | null
  status?: 'open' | 'limited' | 'sold_out' | 'closed' | 'cancelled'
  priceTextOverride?: string | null
}

export interface NewDepartureView {
  departOn: string
  returnOn: string
  status: 'open' | 'limited' | 'sold_out' | 'closed' | 'cancelled'
  priceTextOverride: string | null
}

export type ProposalView =
  | { kind: 'update_tour'; tourId: string; summary: string; patch: TourPatchView }
  | {
      kind: 'update_departure'
      tourId: string
      departureId: string
      summary: string
      patch: DeparturePatchView
    }
  | { kind: 'create_departure'; tourId: string; summary: string; fields: NewDepartureView }

export interface FieldErrorView {
  field: string
  code: string
}

export type ProposalWarningView =
  | { code: 'itinerary_shrinks'; from: number; to: number }
  | { code: 'itinerary_mostly_changed'; changed: number; total: number }

export type ProposalCheckView =
  | { ok: true; warnings?: ProposalWarningView[] }
  | { ok: false; errors: FieldErrorView[] }

export interface AssistantProposalView {
  proposal: ProposalView
  check: ProposalCheckView
}

export interface AssistantReplyView {
  reply: string
  proposals: AssistantProposalView[]
  costUsd: number
  ignoredCount?: number
}
