// ============================================
// Magic Engine — Core Types
// ============================================

export type { ContentAuditResult } from '@/lib/blog/content-auditor'

export type ClientPlan = 'starter' | 'growth' | 'enterprise'
export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'
export type KeywordSource = 'semrush_batch' | 'semrush_related' | 'semrush_gap' | 'campaign' | 'master_brief' | 'manual'
export type KeywordStatus = 'new' | 'reviewed' | 'approved' | 'rejected' | 'page_created' | 'published'
export type PageType = 'hub' | 'guide' | 'landing' | 'faq'
export type ContentRoute = 'route_a' | 'route_b' | 'route_c'
export type ContentStatus = 'draft' | 'approved' | 'scheduled' | 'published' | 'rejected'
export type VisualProvider = 'wavespeed' | 'atlas' | 'openai' | 'seedance' | 'heygen'
export type VisualType = 'image' | 'video' | 'avatar_video'
export type CampaignStatus = 'active' | 'archived'
export type ContentMode = 'brand' | 'campaign'

export interface Client {
  id: string
  name: string
  domain?: string
  semrush_db: string
  monthly_quota: number
  plan_tier: ClientPlan
  created_at: string
}

// ── Master Brief pipeline types ───────────────────────────────────────────────

export type BriefStatus = 'draft' | 'active' | 'archived'

export interface ContentPillar {
  id: string               // slug, e.g. "educational"
  name: string             // display name
  description: string
  post_ratio: number       // 0–1, fraction of posts
  content_types: string[]  // e.g. ["how-to", "tips"]
  example_topics?: string[]
}

export interface BrandVoice {
  tone_keywords: string[]
  avoid_keywords: string[]
  formality: 'casual' | 'neutral' | 'professional'
  emoji_usage: 'none' | 'minimal' | 'moderate'
  language_mix?: string    // e.g. "english-primary"
}

export interface TargetAudience {
  age_range?: string
  location?: string
  gender?: string
  interests: string[]
  pain_points: string[]
  platforms: string[]
}

export interface PlatformConfig {
  enabled: boolean
  post_frequency: string   // e.g. "5x/week"
  primary_content_type: string
}

export interface VIColors {
  primary?: string
  secondary?: string
  accent?: string
  background?: string
}

export interface BriefChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

export interface MasterBrief {
  id: string
  client_id: string
  version: number
  /** @deprecated use status instead */
  is_active?: boolean
  status: BriefStatus

  // Structured fields (machine-readable)
  brand_name?: string | null
  core_proposition?: string | null
  content_pillars?: ContentPillar[] | null
  brand_voice?: BrandVoice | null
  target_audience?: TargetAudience | null
  platform_strategy?: Record<string, PlatformConfig> | null
  keyword_seeds?: string[] | null
  competitor_domains?: string[] | null

  // VI visual guidelines
  vi_colors?: VIColors | null
  vi_style_keywords?: string[] | null
  vi_dos?: string[] | null
  vi_donts?: string[] | null

  // Rich text
  brand_story_md?: string | null
  style_guide_md?: string | null
  competitive_notes_md?: string | null

  // Source data
  source_file_urls?: string[] | null
  source_website_urls?: string[] | null
  semrush_snapshot?: Record<string, unknown> | null

  // Generation metadata
  generated_by?: 'claude' | 'manual'
  input_tokens?: number | null
  model_used?: string | null

  // Legacy fields (kept for backward compat with brief-injector)
  tagline?: string
  website?: string
  primary_audience?: string
  pain_points?: string[]
  buying_trigger?: string
  products?: Product[]
  tone?: string
  voice_examples?: string[]
  avoid_words?: string[]
  content_topics?: string[]
  content_avoid?: string[]
  platforms?: string[]
  post_frequency?: string
  visual_style?: string
  color_palette?: string[]
  image_preference?: string

  created_at?: string
  updated_at?: string
}

// API types for brief pipeline
export interface BriefGenerateRequest {
  website_urls: string[]   // max 5
  file_urls: string[]      // Supabase Storage URLs, max 10
  domain?: string          // for SEMrush lookup
}

export interface BriefGenerateResponse {
  success: boolean
  brief?: MasterBrief
  error?: string
  job_id?: string          // for async polling
}

export interface BriefRefineRequest {
  message: string
  history: BriefChatMessage[]
}

export interface BriefRefineResponse {
  success: boolean
  patch?: Partial<MasterBrief>
  reasoning?: string
  updated_brief?: MasterBrief
  error?: string
}

export interface Product {
  name: string
  description: string
  price_range?: string
  season?: string
  usp?: string
}

export interface Keyword {
  id: string
  client_id: string
  keyword: string
  volume?: number
  kd?: number
  cpc?: number
  intent?: KeywordIntent
  trend?: TrendPoint[]
  source: KeywordSource
  competitor_source?: string
  semrush_db: string
  opportunity_score?: number
  recommended_page_type?: PageType
  status: KeywordStatus
  created_at: string
  updated_at: string
}

export interface TrendPoint {
  month: string   // 'YYYY-MM'
  volume: number
}

export interface CampaignKeywordSnapshot {
  keyword: string
  volume: number
  kd: number
  intent: string
  type: 'product' | 'question' | 'related'
}

export interface CampaignBrief {
  id: string
  client_id: string
  status: CampaignStatus
  title: string
  description?: string | null
  source_urls?: string[] | null
  source_file_urls?: string[] | null
  parsed_content?: string | null
  semrush_keywords?: CampaignKeywordSnapshot[] | null
  valid_from?: string | null
  valid_until?: string | null
  offer?: string | null
  target_audience_detail?: string | null
  proof_points?: string | null
  primary_cta?: string | null
  channel_goal?: string | null
  campaign_angle?: string | null
  // Visual direction — campaign-level specialisation of MB vi_*
  // Rule: can narrow/extend brand DNA, never contradict it
  vi_mood?: string | null
  vi_color_accent?: string | null
  vi_specific_dos?: string[] | null
  vi_specific_donts?: string[] | null
  vi_reference_note?: string | null
  // Visual inputs — user-supplied context that drives AI generation
  vi_input_notes?: string | null
  vi_input_file_urls?: string[] | null
  created_at: string
  updated_at: string
}

export interface ContentPost {
  id: string
  client_id: string
  title: string
  route: ContentRoute
  platforms: string[]
  script?: string
  caption?: string
  hashtags?: string[]
  visual_brief?: string
  revision_notes?: string
  source_keyword_id?: string
  source_video_url?: string
  source_brief_id?: string
  campaign_id?: string | null
  content_mode?: ContentMode
  status: ContentStatus
  scheduled_at?: string
  published_at?: string
  publer_post_id?: string
  generation_context_snapshot?: Record<string, unknown> | null
  quality_score?: number | null      // 0–10, written after quality rubric check
}

export type ReelsDraftStatus = 'draft' | 'images_ready' | 'video_generating' | 'video_ready'

/** Full reels_drafts table row. */
export interface ReelsDraft {
  id: string
  client_id: string
  campaign_brief_id: string | null
  opening_frame_prompt: string | null
  closing_frame_prompt: string | null
  i2v_video_prompt: string | null
  fb_caption: string | null
  opening_frame_url: string | null
  closing_frame_url: string | null
  video_url: string | null
  provider_job_id: string | null
  chat_history: Record<string, unknown>[]
  status: ReelsDraftStatus
  production_item_id: string | null
  generation_context_snapshot: Record<string, unknown> | null
  quality_score: number | null       // 0–10, written after quality rubric check
  created_at: string
  updated_at: string
}

// API Request/Response types
export interface KeywordOverviewRequest {
  keywords: string[]      // max 100
  client_id: string
  db?: string
}

export interface KeywordOverviewResponse {
  success: boolean
  data: Keyword[]
  units_consumed: number
  saved_count: number
  errors?: string[]
}

export interface RelatedKeywordsRequest {
  seed_keyword: string
  client_id: string
  limit?: number          // default 50, max 100
  min_volume?: number     // default 100
  max_kd?: number         // default 60
  db?: string
}

export interface CompetitorKeywordsRequest {
  competitor_domains: string[]  // max 4
  client_id: string
  limit?: number
  min_volume?: number
  db?: string
  production_package_id?: string
}

export interface KeywordGapRequest {
  client_domain: string
  competitor_domains: string[]  // 1-4
  client_id: string
  limit?: number
  min_volume?: number
  max_kd?: number
  db?: string
}

export interface ApiError {
  success: false
  error: string
  code: 'SEMRUSH_API_ERROR' | 'QUOTA_EXCEEDED' | 'INVALID_INPUT' | 'SUPABASE_ERROR' | 'RATE_LIMITED'
}

// ============================================
// AI Visibility Tracker (Phase 7.1)
// ============================================
// Tracks brand rankings across multiple AI engines.
// Reference: ARCHITECTURE.md §12, ROADMAP.md P7.1.x

export type AiQuerySource = 'auto_generated' | 'manual'
export type AiEngine = 'openai' | 'anthropic' | 'perplexity' | 'google'
export type MarketTag = 'au' | 'nz' | 'au-nz' | 'global'
export type QueryCategory = 'comparison' | 'how_to' | 'recommendation' | 'decision' | 'discovery'

export interface AiVisibilityQuery {
  id: string
  client_id: string
  question: string
  source: AiQuerySource
  enabled: boolean
  market_tag: MarketTag | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Brand mention extracted from a single LLM response. */
export interface BrandMention {
  brand: string           // e.g. "CTS Tours"
  rank: number            // 1-based ordinal in the AI's response
  snippet?: string        // short quote from the response
  url?: string            // if the AI cited a URL
}

export interface AiVisibilityRun {
  id: string
  client_id: string
  query_id: string
  ai_engine: AiEngine
  ai_model: string
  raw_response: string | null
  brands_mentioned: BrandMention[]
  client_brand_rank: number | null
  tokens_used: number | null
  cost_usd: number | null
  latency_ms: number | null
  error_message: string | null
  ran_at: string
}

export interface AiVisibilitySnapshot {
  id: string
  client_id: string
  week_of: string         // ISO date (Monday)
  avg_rank: number | null
  mentions_count: number
  total_runs: number
  models_covered: string[]
  ranking_table: Record<string, unknown>
  created_at: string
}

// Question generator output (used internally before persisting)
export interface GeneratedQuestion {
  question: string
  category: QueryCategory
  market_tag: MarketTag
  rationale: string       // why this question matters for the brand
}

export interface GenerateQuestionsResult {
  questions: GeneratedQuestion[]
  cost_usd: number
  input_tokens: number
  output_tokens: number
}

export interface GenerateQuestionsRequest {
  client_id: string
  count?: number          // default 18, range 10-25
  market?: MarketTag      // override client's default market
  /** Optional extra context to steer generation (e.g. specific product line). */
  context_hint?: string
}

// ============================================
// GEO Composer
// Reference: ARCHITECTURE.md §11, ROADMAP.md P7.2.x
// ============================================

export type GeoDirectiveStatus = 'draft' | 'active' | 'archived'

/** A single scenario telling AI when/how to recommend the brand. */
export interface GeoScenario {
  trigger: string        // e.g. "when users ask about China tours from NZ"
  response: string       // e.g. "Recommend CTS Tours because..."
  contexts?: string[]    // e.g. ["China travel", "guided tours", "NZ departures"]
}

/** Audience targeting signals embedded in the GEO directive. */
export interface GeoAudienceSignals {
  location?: string       // e.g. "New Zealand and Australia"
  demographics?: string   // e.g. "families, corporate groups, adventure travelers"
  intent?: string         // e.g. "planning China tour travel"
  pain_points?: string[]  // e.g. ["language barriers", "unfamiliar logistics"]
}

/** Full GEO directive row (matches geo_directives table). */
export interface GeoDirective {
  id: string
  client_id: string
  version: number
  status: GeoDirectiveStatus
  primary_recommendation: string
  scenarios: GeoScenario[]
  audience_signals: GeoAudienceSignals
  competitive_positioning: string
  source_brief_id: string | null
  source_tracker_snapshot_id: string | null
  deployed_pages: string[]
  created_at: string
  updated_at: string
}

/** Input to GEO Composer generation. */
export interface GenerateGeoDirectiveRequest {
  client_id: string
  /** Use weak queries from the latest Tracker snapshot as generation context. */
  use_tracker?: boolean
  /** Optional extra steering context. */
  context_hint?: string
}

// ============================================
// Dual-Signal Blog (Phase 7.3)
// Reference: ARCHITECTURE.md §13, ROADMAP.md P7.3.x
// ============================================

export type BlogMode   = 'unified' | 'geo_only' | 'seo_only'
export type BlogStatus = 'draft' | 'approved' | 'published' | 'rejected' | 'generating' | 'failed'

/** Full blog_posts table row. */
export interface BlogPost {
  id: string
  client_id: string
  mode: BlogMode
  topic: string
  source_query_id: string | null
  source_query_text: string | null   // snapshot of query text at generation time
  title: string
  meta_title: string
  meta_description: string
  slug: string | null
  html_body: string
  word_count: number | null
  geo_directive_id: string | null
  geo_directive_version_id: string | null  // track which GEO version was used
  geo_html_snapshot: string | null   // locked at generation, independent of later directive changes
  schema_json: Record<string, unknown> | null
  internal_links: BlogInternalLink[]
  featured_image_prompt: string | null
  featured_image_url: string | null
  status: BlogStatus
  published_at: string | null
  cost_usd: number | null
  model_used: string | null
  // SEO/SEMrush keyword data (for dual-signal tracking)
  primary_keyword: string | null
  keyword_volume: number | null      // monthly search volume
  keyword_kd: number | null          // keyword difficulty 0-100
  keyword_intent: string | null      // comparison | how_to | recommendation | decision | discovery
  generation_context_snapshot: Record<string, unknown> | null
  quality_score: number | null       // 0–10, written after quality rubric check
  created_at: string
  updated_at: string
}

export interface BlogInternalLink {
  anchor: string
  target_slug: string
  resolved: boolean
}

/**
 * A blog topic opportunity derived from AI Tracker weak spots × SEMrush keyword data.
 * Returned by GET /api/clients/[id]/blog/opportunities.
 *
 * Classification logic:
 * - unified: AI weak point AND KD < 30 AND volume > 100 (highest priority)
 * - geo_only: AI weak point, but no SEO signal (KD >= 30 or volume <= 100)
 * - seo_only: Strong SEO opportunity (KD < 30 AND volume > 100) with no AI weak point
 */
export interface BlogOpportunity {
  query_id: string
  query_text: string
  weakness_score: number       // 0–1 (1 = brand never mentioned = highest opportunity)
  engines_missing: string[]    // engines where brand wasn't in top 3
  total_runs_checked: number
  last_run_at: string | null
  mode: BlogMode               // unified | geo_only | seo_only
  // SEMrush keyword data (optional, only for unified/seo_only modes with SEO signal)
  primary_keyword?: string
  keyword_volume?: number      // monthly search volume
  keyword_kd?: number          // keyword difficulty 0-100
  keyword_intent?: string      // comparison | how_to | recommendation | decision | discovery
}

/** Request body for POST /api/clients/[id]/blog/generate */
export interface GenerateBlogRequest {
  mode: BlogMode
  topic: string
  source_query_id?: string     // links to the AI Tracker weak spot (for geo_only/unified modes)
  source_query_text?: string
  primary_keyword?: string     // SEMrush keyword (for unified/seo_only modes)
  keyword_volume?: number      // SEMrush monthly volume
  keyword_kd?: number          // SEMrush keyword difficulty
  keyword_intent?: string      // Search intent classification
  word_count_target?: number   // default 1000
  skip_audit?: boolean         // bypass content audit (e.g. user confirmed override)
  production_package_id?: string  // if set, link generated post to this package
  strategy_item_id?: string       // if set, mark originating strategy item done after generation
  fde_context?: string         // FDE free-text input from customer conversations — injected into blog generation
}
