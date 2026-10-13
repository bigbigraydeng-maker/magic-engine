/**
 * Response bodies shared by the tour-catalog API routes and the admin page.
 *
 * Both sides type their JSON with these, so a renamed field breaks the type check instead of
 * silently rendering an empty page (2026-10-10: the change log read `entries` while the route
 * sent `changes`). Type-only module: safe to import from client components.
 */

import type { CatalogDeparture, CatalogTour } from './types'
import type { ChangeLogEntry } from './store-edit'
import type { SeedResult } from './seed'

export interface ChangesResponse {
  changes: ChangeLogEntry[]
}

export interface TourSavedResponse {
  tour: CatalogTour
}

export interface DepartureSavedResponse {
  departure: CatalogDeparture
}

export type SeedResponse = { ok: true } & SeedResult

export interface RollbackConflictResponse {
  error: 'conflict'
  conflict?: { reason: 'modified' | 'missing'; tourName: string; departOn: string }
}
