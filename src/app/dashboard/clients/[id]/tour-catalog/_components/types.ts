/** Response shapes of /api/clients/[id]/tour-catalog/* as consumed by the admin page. */

export interface CatalogTourView {
  id: string
  slug: string
  destination: string
  tier: string
  name: string
  displayPriceText: string | null
  isActive: boolean
  managesDepartures: boolean
}

export interface CatalogDepartureView {
  id: string
  tourId: string
  departOn: string
  returnOn: string | null
  status: 'open' | 'limited' | 'sold_out' | 'closed' | 'cancelled'
  priceTextOverride: string | null
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
