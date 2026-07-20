/**
 * Job-signal ingest orchestrator — the new discovery source for Phase 35.
 *
 * scrape → drop agencies/recruiters → dedupe to companies → resolve each to a
 * real business via Places (high-confidence only) → drop those building a team
 * in-house → dedupe against existing prospects → insert as `discovered` with
 * discovery_source='job_board'. Downstream audit/score/analyze/outreach is the
 * existing pipeline, untouched.
 *
 * H1 (魏征): an already-known prospect is NOT updated here — mutating a row the
 * sweep may be advancing is a race. Phase 1 just skips it (counts skipped_
 * existing); cross-signal enrichment waits for the Phase 2 signals subtable.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { BOARD_SCRAPERS } from './scrapers'
import { isAgencyOrRecruiter, jobKeywordPool, classifySeniority, tagIcpBuckets } from './filters'
import { normaliseLocationToSeedKey } from './locations'
import { resolveCompanyViaPlaces } from './resolve'
import type { CandidateCompany, HiringSignal, JobBoard, JobPosting } from './types'

/** Established + hiring a senior lead = building in-house, not an outsource target. */
const BUILDING_IN_HOUSE_REVIEW_FLOOR = 150

export interface IngestParams {
  boards?:   JobBoard[]
  keywords?: string[]
  maxPerBoard?: number
  /** When true, do everything except the DB insert — returns would-be rows. */
  dryRun?:   boolean
}

export interface IngestResult {
  scraped:  number
  after_noise_filter: number
  companies: number
  resolved:  number
  inserted:  number
  skipped: {
    agency: number
    unmapped_location: number
    unresolved: number
    building_in_house: number
    already_known: number
  }
  rejections: string[]
  preview?: Array<{ company: string; city: string; industry: string; buckets: string[] }>
}

/** Dedupe postings to one candidate per company (case-insensitive), keeping the
 *  strongest signal — a junior/part-time posting outranks a senior one. */
function toCandidates(postings: JobPosting[]): CandidateCompany[] {
  const rank = { junior: 0, mid: 1, senior: 2 }
  const byCompany = new Map<string, CandidateCompany>()
  const discovered_at = new Date().toISOString()
  for (const p of postings) {
    const seniority = classifySeniority(p.title)
    const key = p.company.toLowerCase().trim()
    const existing = byCompany.get(key)
    if (existing && rank[existing.signal.seniority] <= rank[seniority]) continue
    const signal: HiringSignal = {
      board: p.board, job_title: p.title, job_url: p.url, keyword_matched: p.keyword_matched,
      icp_buckets: [], seniority, location_raw: p.location_raw,
      resolved_industry: '', posted_at: p.posted_at, discovered_at,
    }
    byCompany.set(key, { company: p.company, location_raw: p.location_raw, signal })
  }
  return Array.from(byCompany.values())
}

function cityLabelFromSeed(seed: string): string {
  return seed.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export async function ingestJobSignals(params: IngestParams = {}): Promise<IngestResult> {
  const boards = params.boards ?? ['seek']
  const keywords = params.keywords ?? jobKeywordPool()
  const maxPerBoard = params.maxPerBoard ?? 120
  const skipped = { agency: 0, unmapped_location: 0, unresolved: 0, building_in_house: 0, already_known: 0 }
  const rejections: string[] = []

  // ── scrape ──────────────────────────────────────────────────────────────
  const scraped: JobPosting[] = []
  for (const board of boards) {
    scraped.push(...await BOARD_SCRAPERS[board](keywords, maxPerBoard))
  }

  // ── noise filter ────────────────────────────────────────────────────────
  const clean = scraped.filter(p => {
    if (isAgencyOrRecruiter(p.company, p.classification)) { skipped.agency++; return false }
    return true
  })

  const candidates = toCandidates(clean)

  // ── resolve + insert ──────────────────────────────────────────────────────
  const rows: Array<Record<string, unknown>> = []
  const preview: IngestResult['preview'] = []
  let resolved = 0

  for (const c of candidates) {
    const seed = normaliseLocationToSeedKey(c.location_raw)
    if (!seed) { skipped.unmapped_location++; continue }

    const out = await resolveCompanyViaPlaces(c.company, cityLabelFromSeed(seed)).catch(() => null)
    if (!out || 'rejected' in out) {
      skipped.unresolved++
      if (out && 'rejected' in out) rejections.push(`${c.company}: ${out.rejected}`)
      continue
    }
    resolved++
    const { listing, industry_slug } = out

    // Business-layering gate: established company hiring a senior lead is
    // building an in-house team — not an outsource prospect (板桥/魏征).
    if (c.signal.seniority === 'senior' && (listing.review_count ?? 0) >= BUILDING_IN_HOUSE_REVIEW_FLOOR) {
      skipped.building_in_house++; continue
    }

    const signal: HiringSignal = {
      ...c.signal,
      resolved_industry: industry_slug,
      icp_buckets: tagIcpBuckets({
        company: c.company, seniority: c.signal.seniority,
        reviewCount: listing.review_count, industrySlug: industry_slug,
      }),
    }

    // Dedupe against existing prospects (either source). Do NOT touch the
    // existing row (H1) — just skip.
    const known = await isKnownProspect(listing.place_id, listing.domain)
    if (known) { skipped.already_known++; continue }

    rows.push({
      business_name: listing.name, industry: industry_slug, city: seed, country: 'NZ',
      domain: listing.domain, website_url: listing.website_url, phone: listing.phone,
      place_id: listing.place_id, rating: listing.rating, review_count: listing.review_count,
      raw_listing: { ...listing.raw, hiring_signal: signal },
      status: 'discovered', discovery_source: 'job_board',
    })
    preview.push({ company: listing.name, city: seed, industry: industry_slug, buckets: signal.icp_buckets })
  }

  let inserted = 0
  if (!params.dryRun && rows.length > 0) {
    const { error } = await supabaseAdmin.from('outbound_prospects').insert(rows)
    if (error) throw new Error(`job-signal insert failed: ${error.message}`)
    inserted = rows.length
  }

  return {
    scraped: scraped.length, after_noise_filter: clean.length, companies: candidates.length,
    resolved, inserted: params.dryRun ? 0 : inserted, skipped, rejections,
    preview: params.dryRun ? preview : undefined,
  }
}

async function isKnownProspect(placeId: string | null, domain: string | null): Promise<boolean> {
  const or: string[] = []
  if (placeId) or.push(`place_id.eq.${placeId}`)
  if (domain) or.push(`domain.eq.${domain}`)
  if (or.length === 0) return false
  const { count } = await supabaseAdmin
    .from('outbound_prospects').select('id', { count: 'exact', head: true }).or(or.join(','))
  return (count ?? 0) > 0
}
