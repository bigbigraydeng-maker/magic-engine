/**
 * Job-signal filtering, keyword pool, and ICP tagging.
 *
 * The noise filter (§ isAgencyOrRecruiter) is the first gate: a live sample
 * showed ~1 in 4 marketing postings come from recruiters or marketing
 * agencies — the latter are our competitors, not prospects. Both must be
 * dropped before any paid Places resolution runs.
 *
 * Seniority split (板桥 + 魏征): a company hiring a junior/part-time/coordinator
 * marketing role is a STRONG signal (needs the capability, can't afford a full
 * team → outsource target). A company hiring a full-time senior Marketing
 * Manager / Head of Marketing is a WEAK/negative signal (building in-house).
 */

import type { IcpBucket, JobSeniority } from './types'

/**
 * The keyword pool, real-data-calibrated from live Seek sampling. AI-visibility
 * / GEO deliberately excluded: a live probe of those terms returned only AI
 * *engineering* roles — there is no hiring signal for AI visibility in NZ yet,
 * so it stays an upsell, not an ingest keyword. Overridable via env.
 */
export const DEFAULT_JOB_KEYWORDS = [
  'digital marketing',
  'social media',
  'facebook ads',
  'google ads',
  'marketing manager',
  'marketing coordinator',
  'seo',
  'content marketing',
  'ecommerce',
  'paid media',
]

export function jobKeywordPool(): string[] {
  const raw = process.env.JOB_SIGNAL_KEYWORDS
  if (!raw) return DEFAULT_JOB_KEYWORDS
  const parsed = raw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
  return parsed.length ? parsed : DEFAULT_JOB_KEYWORDS
}

// Company-name tokens that mark a recruiter or a marketing/digital agency
// (= competitor). Word-boundary matched so "Marketing" in "Markwell" or a real
// brand that merely *contains* a fragment is not falsely dropped. NB: bare
// "consult" is deliberately NOT here — it false-dropped "Construction Cost
// Consultants" (a real end-employer). Marketing consultancies are caught by
// their other tokens (digital/marketing) or the classification / exact list.
const AGENCY_NAME_PATTERN =
  /\b(recruit(ment|ing|er)?|talent|staffing|personnel|agency|agencies|digital|marketing|media|creative|advertising|seo|ppc|growth partners?)\b/i

// Recruiters/consultancies whose names carry NO agency keyword — a curated
// exact-match list that grows as we spot slip-throughs (a live run surfaced
// "Positive People", "Working In", "PN Personnel"). Kept separate from the
// pattern so broadening it never costs a real end-employer.
const KNOWN_RECRUITERS = new Set([
  'positive people', 'working in', 'eq consultants', 'hays', 'madison recruitment',
  'beyond recruitment', 'frog recruitment', 'rice consulting', 'kinetic recruitment',
])

// Board categories that only agencies/recruiters post under.
const AGENCY_CLASSIFICATIONS = new Set([
  'advertising, arts & media',
  'consulting & strategy',
  'human resources & recruitment',
])

/**
 * True when a posting's hiring entity is a recruiter or marketing agency
 * rather than an end-employer prospect. Errs toward dropping: a false negative
 * (agency slips through) is caught later at Places resolution; a false positive
 * only costs one lead.
 */
export function isAgencyOrRecruiter(company: string, classification: string | null): boolean {
  if (KNOWN_RECRUITERS.has(company.toLowerCase().trim())) return true
  if (AGENCY_NAME_PATTERN.test(company)) return true
  if (classification && AGENCY_CLASSIFICATIONS.has(classification.toLowerCase().trim())) return true
  return false
}

const SENIOR_TITLE = /\b(head of|director|chief|cmo|lead|manager|snr|senior)\b/i
const JUNIOR_TITLE = /\b(assistant|coordinator|co-ordinator|junior|jnr|intern|graduate|trainee|part[\s-]?time)\b/i

/** Infer seniority from the job title. Junior wins ties (part-time coordinator = junior). */
export function classifySeniority(title: string): JobSeniority {
  if (JUNIOR_TITLE.test(title)) return 'junior'
  if (SENIOR_TITLE.test(title)) return 'senior'
  return 'mid'
}

const CHINESE_MIGRANT_HINT =
  /\b(kiwi|asia|asian|china|chinese|mandarin|oriental|dragon|jade|golden|lucky)\b/i

/**
 * Tag ICP buckets for the prospect. Multiple can apply. `reviewCount` is only
 * known after Places resolution, so buckets are computed at resolve time.
 */
export function tagIcpBuckets(params: {
  company: string
  seniority: JobSeniority
  reviewCount: number | null
  industrySlug: string
}): IcpBucket[] {
  const buckets: IcpBucket[] = []
  const { company, seniority, reviewCount, industrySlug } = params

  // Small business hiring a junior/generalist role = the core outsource target.
  if (seniority === 'junior') buckets.push('smb_local')

  // Large review count = established, likely bigger, may build in-house.
  if ((reviewCount ?? 0) >= 150) buckets.push('mid_large_budget')

  if (CHINESE_MIGRANT_HINT.test(company)) buckets.push('migrant_chinese')

  // Industries ME already has playbooks for (tourism / building / education).
  if (/travel|tour|building|construction|renovat|floor|education|school|tutor/i.test(industrySlug)) {
    buckets.push('industry_vertical')
  }

  return buckets.length ? buckets : ['smb_local']
}
