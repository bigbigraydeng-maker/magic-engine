/**
 * 张骞 Zhangqian — Discovery Agent type definitions.
 *
 * Reference: ROADMAP.md P8.10.S0
 *
 * Naming: 张骞 (Zhāng Qiān, ~164–113 BCE) was the Han dynasty diplomat who
 * pioneered the Silk Road by mapping the previously-unknown Western Regions
 * over a 13-year expedition. Our Discovery Agent mirrors that mission:
 * given only a domain, it autonomously maps the unknown territory of a
 * client's digital presence (competitors, social, reviews, keywords).
 */

// ─── Discovered sub-entities ──────────────────────────────────────────────────

export type SocialPlatform =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'youtube'
  | 'tiktok'
  | 'twitter'
  | 'pinterest'

export interface DiscoveredSocial {
  platform: SocialPlatform
  handle: string | null            // e.g. "@oztopbuilding" — null if URL-only
  url: string                       // canonical profile URL
  confidence: number                // 0–1: how sure are we this is the right account
}

export interface DiscoveredGbp {
  place_id: string | null           // Google Places place_id if found
  business_name: string
  address: string
  rating: number | null             // 1–5
  review_count: number | null
  google_maps_url: string | null
  confidence: number                // 0–1
}

/** A sampled negative review surfaced as concrete diagnosis evidence. */
export interface ReviewSample {
  rating: number                    // 1–5
  text: string
  date: string | null               // upstream-provided, free-form
  author: string | null
}

export interface DiscoveredReviewPlatform {
  platform: 'google' | 'productreview' | 'trustpilot' | 'yelp' | 'facebook' | 'other'
  url: string
  rating: number | null             // platform-specific scale
  review_count: number | null
  // ── Enriched by the fetch_local_reviews connector (P8.12.S1.2) ──
  /** Star-rating breakdown (review count per star), if the source exposes it. */
  rating_distribution?: Record<'1' | '2' | '3' | '4' | '5', number> | null
  /** Sample reviews with rating <= 2, used as concrete diagnosis evidence. */
  recent_negative_samples?: ReviewSample[] | null
  /** Owner response rate, 0–1; null when the source does not expose it. */
  response_rate?: number | null
}

export type KeywordType = 'brand' | 'category' | 'long_tail' | 'local' | 'transactional'

export interface DiscoveredKeyword {
  keyword: string
  type: KeywordType
  rationale: string                 // why Claude picked this
  estimated_volume?: number | null  // optional: rough volume guess
  semrush_rank?: number | null      // current organic rank from SEMrush
  semrush_volume?: number | null    // verified monthly search volume from SEMrush
}

export type CompetitorRelevance = 'direct' | 'adjacent' | 'aspirational'

export interface DiscoveredCompetitor {
  domain: string                    // canonical, no protocol, no trailing slash
  name: string                      // human-readable brand
  relevance: CompetitorRelevance
  rationale: string                 // why this competitor matters
  location?: string | null          // city/region if local-market relevant
  monthly_traffic?: number | null   // estimated monthly organic traffic from SEMrush
  keyword_count?: number | null     // number of ranking keywords from SEMrush
  trust_score?: number | null       // domain authority score from SEMrush
}

export type AiQuestionCategory = 'brand' | 'category' | 'comparison' | 'local'
export type Market = 'AU' | 'NZ' | 'AU/NZ'

export interface DiscoveredAiQuestion {
  question: string                  // exact wording for AI Tracker
  category: AiQuestionCategory
  market: Market
  rationale: string
}

/**
 * Verified business registration, populated by the
 * verify_business_registration connector (P8.12.S1.1).
 * Sourced from the ABR (AU) or NZBN (NZ) official registry — never guessed.
 */
export interface DiscoveredRegistration {
  country: 'AU' | 'NZ'
  identifier: string                 // ABN (11 digits) or NZBN (13 digits)
  identifier_type: 'ABN' | 'NZBN'
  entity_name: string | null         // legal entity name
  entity_type: string | null         // e.g. "Australian Private Company"
  status: 'active' | 'cancelled' | 'unknown'
  registered_since: string | null    // ISO date — anchors "registration age"
  gst_registered: boolean | null      // null = registry does not expose GST
}

export interface DiscoveredBusiness {
  name: string                      // brand name (not domain)
  industry: string[]                // 1–3 industry tags, broad to specific
  location: {
    city: string | null
    region: string | null            // QLD, NSW, Auckland, etc.
    country: 'AU' | 'NZ' | 'AU/NZ'
  }
  description: string                // 2–3 sentence brand summary
  target_audience: string[]          // e.g. ["builders", "home owners", "designers"]
  unique_selling_points: string[]    // e.g. ["one-team install", "free measure"]
  confidence: number                 // 0–1
  /** Verified registry record (ABR/NZBN); null when not found or not checked. */
  registration?: DiscoveredRegistration | null
}

// ─── New diagnostic types ─────────────────────────────────────────────────────

export interface SemrushSnapshot {
  monthly_traffic: number | null
  trust_score: number | null
  keyword_count: number | null
  top_keywords: Array<{ keyword: string; position: number; volume: number | null }>
}

export interface AiVisibilityResult {
  question: string
  top_brands: string[]       // brands that appeared in search results for this query
  client_mentioned: boolean
}

export interface DiagnosisBlock {
  executive_summary: string  // Chinese narrative ~3-5 sentences
  crisis_type: string | null // e.g. "TYPE_E 声誉陷阱" or null if no crisis
  scores: {
    seo: number             // 0-100
    social: number
    reputation: number
    ai_visibility: number
    overall: number
  }
  money_flow: string        // Chinese "钱去了哪里" narrative
  key_finding: string       // one-line Chinese diagnosis
  actions: {
    quick_fix: string[]     // 立即可做 (客户自助)
    important: string[]     // 重要建设 (1-3个月)
    talk_to_us: string[]    // 需要专业支持
  }
}

// ─── Top-level report ─────────────────────────────────────────────────────────

export interface DiscoveryReport {
  /** Schema version — increment when shape changes incompatibly */
  schema_version: 1

  domain: string                                          // input
  business: DiscoveredBusiness
  social_profiles: DiscoveredSocial[]
  gbp: DiscoveredGbp | null
  review_platforms: DiscoveredReviewPlatform[]
  seed_keywords: DiscoveredKeyword[]                      // 5–10 expected
  competitors: DiscoveredCompetitor[]                     // 5–10 expected
  ai_tracker_questions: DiscoveredAiQuestion[]            // 10–20 expected

  /** Free-form research notes / caveats the agent wants the human to know */
  notes: string

  /** SEMrush pre-fetched domain snapshot (populated server-side before agent run) */
  semrush_snapshot?: SemrushSnapshot | null

  /** AI visibility test results — agent tests 2-3 questions and records who appears */
  ai_visibility_results?: AiVisibilityResult[] | null

  /** Deep diagnostic block with scores, narrative, and action plan */
  diagnosis?: DiagnosisBlock | null

  /** Run telemetry — written by agent.ts, not by Claude */
  meta: {
    model: string
    tool_calls: number
    cost_usd: number
    duration_ms: number
    truncated: boolean              // true if hit tool-call cap before finishing
  }
}

// ─── Job / persistence shapes ─────────────────────────────────────────────────

export type DiscoveryJobStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface DiscoveryJob {
  id: string
  client_id: string
  domain: string
  status: DiscoveryJobStatus
  progress_note: string | null
  tool_call_count: number
  cost_usd: number
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface ClientDiscoveryRow {
  id: string
  client_id: string
  domain: string
  payload: DiscoveryReport
  cost_usd: number
  model: string
  tool_calls: number
  generated_at: string
  expires_at: string
  confirmed_at: string | null
  confirmed_by: string | null
}
