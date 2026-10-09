/** Response shapes of /api/clients/[id]/tour-catalog/* as consumed by the admin page. */

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

export interface CatalogSnapshotResponse {
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
  aliases: Array<{ aliasNorm: string; tourId: string }>
  batches: CatalogBatchView[]
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
