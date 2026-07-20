/**
 * Job-signal prospecting — shared types.
 *
 * Reference: ROADMAP.md Phase 35 · job-board discovery adapter.
 *
 * A new discovery SOURCE for the existing outbound prospecting pipeline: NZ
 * companies advertising Marketing / social / Facebook-ads / SEO roles are
 * confirmed-intent prospects. We harvest the postings, resolve each to a real
 * business (via Google Places, never the job page), and feed the existing
 * `outbound_prospects.discovered` stage. Everything downstream is reused.
 */

/** One job posting as normalised from a board scraper (Seek/Indeed/TradeMe). */
export interface JobPosting {
  board:          JobBoard
  company:        string
  title:          string
  location_raw:   string
  /** Seek classification / board category, when present — used for noise filtering. */
  classification: string | null
  url:            string | null
  posted_at:      string | null
  /** The keyword-pool term that surfaced this posting. */
  keyword_matched: string
}

export type JobBoard = 'seek' | 'indeed' | 'trademe'

/** ICP bucket tags (mirrors the segments the operator asked to target). */
export type IcpBucket =
  | 'smb_local'        // small local business, generalist/part-time role
  | 'industry_vertical' // matches an industry ME already serves
  | 'mid_large_budget'  // bigger, has budget but may be building in-house
  | 'migrant_chinese'   // AU/NZ migrant / Chinese-owned business

/** Job seniority inferred from the title — drives the positive/negative signal split. */
export type JobSeniority = 'junior' | 'mid' | 'senior'

/**
 * The hiring signal recorded verbatim into outbound_prospects.raw_listing so
 * the operator sees WHY a prospect surfaced. Never used in outreach copy
 * (板桥 guardrail #1: hiring stays a backstage targeting signal only).
 */
export interface HiringSignal {
  board:            JobBoard
  job_title:        string
  job_url:          string | null
  keyword_matched:  string
  icp_buckets:      IcpBucket[]
  seniority:        JobSeniority
  location_raw:     string
  resolved_industry: string
  posted_at:        string | null
  discovered_at:    string
}

/** A posting that survived filtering and was deduped to one company. */
export interface CandidateCompany {
  company:      string
  location_raw: string
  signal:       HiringSignal
}
