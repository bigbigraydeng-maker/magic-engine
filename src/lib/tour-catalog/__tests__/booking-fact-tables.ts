/**
 * The two catalog tables the booking-facts reader touches, for test fakes to seed.
 *
 * This is NOT a test file (vitest only runs *.test.ts). The names live inside the catalog
 * folder because only that folder may name the catalog's tables (see `boundary.test.ts`);
 * the CRM booking tests import them from here instead of spelling them out.
 */

export const BOOKING_FACT_TOURS_TABLE = 'tour_catalog_tours'
export const BOOKING_FACT_DEPARTURES_TABLE = 'tour_catalog_departures'
