import type { PublishPreviewResponse } from '@/lib/tour-catalog/publish-contract'
import { checkTourCompleteness, missingItems } from '@/lib/tour-catalog/completeness'
import type { CatalogDepartureView, CatalogTourView } from './types'

export interface IncompleteNewTour {
  tourId: string
  tourName: string
  missing: string[]
}

/** New tours in this publish that still miss something the SOP wants filled in. */
export function incompleteNewTours(
  preview: PublishPreviewResponse,
  tours: CatalogTourView[],
  departures: CatalogDepartureView[],
): IncompleteNewTour[] {
  const addedIds = new Set(preview.changes.filter(c => c.kind === 'tour_added').map(c => c.tourId))
  const out: IncompleteNewTour[] = []
  for (const tour of tours) {
    if (!addedIds.has(tour.id)) continue
    const count = departures.filter(d => d.tourId === tour.id).length
    const missing = missingItems(checkTourCompleteness(tour, count)).map(i => i.label)
    if (missing.length > 0) out.push({ tourId: tour.id, tourName: tour.name, missing })
  }
  return out
}
