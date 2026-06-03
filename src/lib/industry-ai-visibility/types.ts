/**
 * Industry AI Visibility Archive — type definitions.
 *
 * Distinct from src/lib/ai-tracker/* which serves the client-level AI Tracker.
 * This module powers the industry-level time-series archive feeding the
 * Industry Baselines dashboard and (eventually) Yellowbook.
 */

export type IndustryCode =
  | 'inbound_tour'
  | 'outbound_tour'
  | 'migration'
  | 'restaurant'
  | 'real_estate'

export type IntentLayer =
  | 'discovery'
  | 'comparison'
  | 'scenario'
  | 'trust'
  | 'action'
  | 'visa_path'
  | 'study'
  | 'family_visa'
  | 'first_home'
  | 'investor'
  | 'overseas_buyer'
  | 'sell'
  | 'local_expert'

export type GeoScope = 'national' | 'city'
export type Country  = 'nz' | 'au'
export type Language = 'en' | 'zh'
export type Platform = 'chatgpt' | 'google_ai_overview' | 'google_serp' | 'xiaohongshu'

export interface Question {
  id:             string
  industry_code:  IndustryCode
  intent_layer:   IntentLayer
  geo_scope:      GeoScope
  country:        Country | null
  city:           string  | null
  language:       Language
  question_text:  string
  question_hash:  string
  platforms:      Platform[]
  is_active:      boolean
  locked_at:      string | null
  created_at:     string
  notes:          string | null
}

/** Result of running ONE question against ONE platform. */
export interface CollectionResult {
  /** Whether the call succeeded (raw response captured). */
  ok: boolean

  /** Platform-specific raw response, preserved verbatim for re-parsing. */
  raw_response: Record<string, unknown> | null

  /** Brand names extracted from the response, in order of appearance. */
  brands_mentioned: string[]
  top3_brands: string[]

  /** AI text answer (chatgpt / google_ai_overview only). */
  ai_answer_text: string | null
  ai_citation_sources: string[] | null

  /** Google SERP structured data (google_serp only). */
  serp_organic_top10: Array<{
    position: number
    title:    string
    url:      string
    description: string
  }> | null
  serp_local_pack: Array<{
    name: string
    rating: number | null
    review_count: number | null
    address: string | null
  }> | null
  serp_paid_domains: string[] | null
  serp_people_also_ask: string[] | null

  /** Metadata. */
  model_version: string
  tokens_used: number | null
  cost_usd: number
  parse_confidence: number | null

  /** Error info (null on success). */
  error_code: string | null
  error_message: string | null
}

/** Outcome of a batch run. */
export interface RunSummary {
  run_id: string
  week_of: string
  questions_attempted: number
  questions_ok: number
  questions_failed: number
  snapshots_written: number
  total_cost_usd: number
  duration_seconds: number
  status: 'completed' | 'partial' | 'failed'
}
