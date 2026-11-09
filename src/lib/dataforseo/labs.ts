/**
 * DataForSEO Labs API — keyword intelligence + competitor discovery.
 *
 * Reference: ROADMAP.md P8.13.A.1
 *
 * Replaces Claude web_search guessing for:
 *   - Seed keyword discovery (Keywords For Site)
 *   - Competitor domain discovery (Competitors Domain)
 *   - Competitor traffic enrichment (Bulk Traffic Estimation)
 *
 * Authentication: Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD) —
 * same credentials as src/lib/dataforseo/client.ts, no new env vars required.
 *
 * Default location: AU (2036). Pass location_code 2554 for NZ.
 *
 * Split into sub-modules (2026-09-23); this file is now a barrel that
 * re-exports everything so existing imports keep working unchanged.
 */

export * from './labs-types'
export * from './labs-keywords'
export * from './labs-competitors'
export * from './labs-traffic'
export * from './labs-rankings'
