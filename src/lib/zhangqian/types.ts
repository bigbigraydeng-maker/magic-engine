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
  // ── Real metrics from Apify scrapers (P8.12.S1.6a) — null when not scraped ──
  /** Real follower count from the platform scraper. */
  followers_count?: number | null
  /** Posts published in the last 30 days. */
  posts_last_30d?: number | null
  /** Engagement rate as a 0–1 decimal (0.035 = 3.5%). */
  engagement_rate?: number | null
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
  platform: 'google' | 'productreview' | 'tripadvisor' | 'trustpilot' | 'yelp' | 'facebook' | 'other'
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
  semrush_kd?: number | null        // keyword difficulty 0–100
  semrush_cpc?: number | null       // cost per click in USD
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
  /** Phone numbers extracted via DataForSEO Domain Technologies (P8.13.B.3). */
  phone_numbers?: string[]
  /** Email addresses extracted via DataForSEO Domain Technologies (P8.13.B.3). */
  emails?: string[]
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

/**
 * Meta (Facebook/Instagram) ad activity, populated by the fetch_meta_ads
 * tool via Apify's Facebook Ads Library scraper (P8.12.S1.6a).
 */
export interface DiscoveredMetaAds {
  /** Number of currently active ads found in the Ad Library. */
  active_ads_count: number
  /** Ad creative formats observed, e.g. ['image', 'video', 'carousel']. */
  ad_types: string[]
  /** Coarse spend signal derived from the Ad Library. */
  estimated_spend: 'low' | 'medium' | 'high' | 'unknown'
  /** Up to 3 sample ad headlines / copy. */
  top_ad_copy: string[]
}

/**
 * A Google SERP snapshot for one query, populated by the fetch_serp_results
 * tool via Apify's Google Search scraper (P8.12.S1.6c). Captures organic
 * ranking, paid advertisers, and the Google AI Mode answer — the AI Mode
 * answer feeds the "AI visibility" diagnosis dimension.
 */
export interface DiscoveredSerpResult {
  query: string
  /** Top organic results for the query. */
  organic_results: Array<{
    position: number
    title: string
    url: string
    description: string
  }>
  /** Domains that ran paid ads for this query. */
  paid_advertiser_domains: string[]
  /** Google AI Mode answer text; null when Google did not surface one. */
  ai_overview_text: string | null
  /** Source URLs cited in the AI Mode answer. */
  ai_overview_sources: string[]
}

export interface DiagnosisBlock {
  executive_summary: string  // Chinese narrative ~3-5 sentences
  crisis_type: string | null // e.g. "TYPE_E 声誉陷阱" or null if no crisis
  scores: {
    seo: number             // 0-100
    social: number
    reputation: number
    ai_visibility: number
    ads?: number | null     // null = not yet measured by zhangqian
    competitor?: number | null
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

// ─── v1.1 · Plugin merge dimensions (P8.13.E) ────────────────────────────────
//
// Ported from `plugins/me-client-discovery/schemas/` (v0.1.0 Roman Hu case)
// into 张骞 v1.1 · 2026-07 · so the ME-native "Add new client" flow captures
// local media outreach targets, regional market context, and 4-类 sanity issues
// alongside the existing 15+ discovery dimensions. See
// `plugins/me-client-discovery/docs/FUTURE-ME-COMPAT.md` for the merge rationale.

export type MediaChannelCategory =
  | 'print_newspaper'
  | 'print_magazine'
  | 'community_fb_group'
  | 'neighbourly'
  | 'newsletter_edm'
  | 'podcast'
  | 'youtube_channel'
  | 'radio'
  | 'tv'
  | 'sponsorship_event'
  | 'chinese_media'
  | 'school_publication'
  | 'business_association'
  | 'other'

export type MediaChannelReachMetric =
  | 'print_circulation'
  | 'readers_nielsen'
  | 'fb_members'
  | 'email_subs'
  | 'podcast_downloads'
  | 'tv_viewers'
  | 'unknown'

/**
 * A local media / newsletter / community / sponsorship channel discovered in
 * the client's target region. Consumed by 诸葛亮 (Prescription) when choosing
 * where to invest organic PR / editorial / sponsorship budget.
 *
 * Free-form text fields (`coverage_note`, `pricing_notes`) are used so the
 * agent can capture the messy real-world variance ("Full page $2,752 · Front
 * page solus 2x8 $900") without a rigid rate-card schema.
 */
export interface DiscoveredMediaChannel {
  media_name: string
  category: MediaChannelCategory
  /** Free-form: which suburbs / audience segments this channel reaches. */
  coverage_note?: string | null
  /** Numeric reach when the source publishes one; null when unknown. */
  reach_number?: number | null
  reach_metric?: MediaChannelReachMetric | null
  /** Free-form pricing summary; leave null if not published. */
  pricing_notes?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  advertise_url?: string | null
  /**
   * True if this channel is specifically Chinese-language or has a strong
   * Chinese audience. Drives Prescription-side segmentation.
   */
  chinese_relevant: boolean
  /** One-line recommended action, e.g. "月刊 1/4 版 + 季度署名 op-ed". */
  recommended_play?: string | null
  /** 1 = must-do first, 5 = optional. Used to sort in the UI. */
  roi_rank?: number | null
  /** Known blockers, e.g. "主赞助被 Barfoot 占了 10+ 年". */
  traps_to_avoid?: string[] | null
  source_urls?: string[] | null
}

/**
 * Regional market context — median prices, school zones, demographics, market
 * heat. Consumed by 华佗 (Analysis) as the baseline against which to score the
 * client's positioning, and by 诸葛亮 (Prescription) to inform pricing / target
 * suburb selection.
 *
 * One record per (client, target region) — the agent may skip this dimension
 * entirely when the client is a non-place-based business (SaaS, ecommerce).
 */
export interface DiscoveredMarketContext {
  region_name: string
  suburbs?: string[] | null
  median_prices?: Array<{
    suburb: string
    median_price: number | null
    currency?: string
    as_of?: string | null
    source_url?: string | null
  }> | null
  school_zones?: Array<{
    zone_name: string
    covered_suburbs?: string[] | null
    premium_note?: string | null
  }> | null
  demographics?: {
    chinese_ethnicity_pct?: number | null
    asian_ethnicity_pct?: number | null
    census_year?: number | null
    census_source_url?: string | null
  } | null
  market_heat?: {
    median_yoy_pct?: number | null
    sales_volume_yoy_pct?: number | null
    days_on_market?: number | null
    buyer_or_seller_market?: 'buyer' | 'seller' | 'balanced' | 'unknown'
    source_urls?: string[] | null
  } | null
  buyer_profiles?: string[] | null
  platform_penetration?: {
    facebook_pct_pop?: number | null
    instagram_pct_pop?: number | null
    wechat_note?: string | null
    xiaohongshu_note?: string | null
  } | null
  key_insights?: string[] | null
  source_urls?: string[] | null
  data_gaps?: string[] | null
}

/**
 * A single 4-类硬伤 issue surfaced by the sanity check that runs post-agent,
 * pre-persist. Non-blocking (report is still stored) but shown to the FDE in
 * the review UI so they can decide whether to accept, edit, or re-run.
 */
export type SanityIssueCategory =
  | 'fabricated_number'      // 数字无来源
  | 'unmarked_uncertainty'   // LLM 声称但未标 low-confidence
  | 'cross_geography'        // 提到超出目标地理的 suburb / region
  | 'weakness_omitted'       // 只有 differentiators / strengths · 无 weaknesses / gaps
  | 'other'

export interface SanityIssue {
  severity: 'red' | 'yellow'
  category: SanityIssueCategory
  /** Dotted path into the report, e.g. "competitors.2.monthly_traffic" */
  location: string
  issue: string
  fix_suggestion: string
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

  /** Meta ad activity — populated by fetch_meta_ads (P8.12.S1.6a); null when not checked */
  meta_ads?: DiscoveredMetaAds | null

  /** Google SERP snapshots — populated by fetch_serp_results (P8.12.S1.6c); null when not checked */
  serp_results?: DiscoveredSerpResult[] | null

  /** Deep diagnostic block with scores, narrative, and action plan */
  diagnosis?: DiagnosisBlock | null

  /**
   * Inferred visual brand DNA — auto-prefilled into the Master Brief form.
   * Source: Claude's read of hero imagery, button colors, typography tone,
   * photography style across the homepage + 1-2 inner pages. When the
   * website offers no usable signal, the agent returns null rather than
   * fabricating one. Populated by P8.10.S2.F.3.
   */
  visual_dna?: {
    style_keywords: string[]   // 3–5 adjectives, e.g. 'minimalist', 'warm', 'bold'
    colors: string[]           // 2–4 hex codes or color names sampled from the site
    donts: string[]            // 3–5 visual DON'T guidelines, e.g. 'no stock photos'
  } | null

  /**
   * Technology stack detected via DataForSEO Domain Technologies (P8.13.B.1).
   * CMS, ecommerce, analytics, chat, contact info, social graph URLs.
   * null when not checked or domain not found.
   */
  technology_stack?: {
    cms:               string | null
    ecommerce:         string | null
    analytics:         string[]
    crm_marketing:     string[]
    chat:              string | null
    domain_rank:       number | null
    phone_numbers:     string[]
    emails:            string[]
    social_graph_urls: string[]
  } | null

  /**
   * WHOIS domain registration data via DataForSEO (P8.13.B.1).
   * Domain age, expiry, registrar, backlink count, organic traffic estimate.
   * null when not checked or domain not found.
   */
  domain_whois?: {
    registered_at:          string | null
    expires_at:             string | null
    registrar:              string | null
    domain_age_years:       number | null
    referring_domains:      number | null
    backlinks:              number | null
    organic_etv:            number | null
    organic_keywords_top10: number | null
  } | null

  /**
   * On-page technical SEO audit for the homepage (P8.13.D.3).
   * Populated by the fetch_onpage_audit tool; null when not checked.
   */
  onpage_audit?: {
    status_code:     number | null
    title:           string | null
    description:     string | null
    canonical:       string | null
    h1:              string | null
    internal_links:  number | null
    external_links:  number | null
    images_no_alt:   number | null
    images_total:    number | null
    word_count:      number | null
    core_web_vitals: {
      lcp: number | null
      cls: number | null
      tbt: number | null
    } | null
    checks: {
      no_title:         boolean
      no_description:   boolean
      no_h1:            boolean
      missing_alt_text: boolean
      broken_links:     boolean
      redirect_chain:   boolean
      https:            boolean
    }
  } | null

  /**
   * v1.1 · Local media / newsletter / community / sponsorship channels for
   * organic PR outreach in the client's target region. Populated by prompt
   * step 10 (P8.13.E · me-client-discovery plugin merge). Null when the agent
   * skipped this dimension (non-place-based business, or no signals found).
   */
  local_media_channels?: DiscoveredMediaChannel[] | null

  /**
   * v1.1 · Regional market context (medians / school zones / demographics /
   * market heat). Populated by prompt step 11. Null when not relevant
   * (SaaS, ecommerce without local footprint).
   */
  market_context?: DiscoveredMarketContext | null

  /**
   * v1.1 · 4-类硬伤 sanity issues detected by score-guardrails post-agent.
   * Never populated by Claude — always computed server-side after validation.
   */
  sanity_issues?: SanityIssue[] | null

  /**
   * Advanced discovery payload — populated after a connector (meta-ads / gbp)
   * is authorized and the advanced pass runs. Never overwrites the basic fields.
   */
  advanced?: AdvancedDiscoveryPayload | null

  /** Run telemetry — written by agent.ts, not by Claude */
  meta: {
    model: string
    tool_calls: number
    cost_usd: number
    duration_ms: number
    truncated: boolean              // true if hit tool-call cap before finishing
  }
}

// ─── Advanced discovery ───────────────────────────────────────────────────────

/** Facebook profile metrics fetched during advanced discovery. */
export interface AdvancedFacebookProfile {
  url: string
  page_name: string
  followers_count: number
  posts_last_30d: number
  engagement_rate: number
}

/** One row from the Google Search Console Search Analytics API. */
export interface GscQueryRow {
  query: string
  impressions: number
  clicks: number
  /** Click-through rate as a 0–1 decimal (0.05 = 5%). */
  ctr: number
  /** Average position in Google search results (1 = top). */
  position: number
}

/**
 * GSC search performance data fetched during advanced discovery (gsc connector).
 * Replaces SEMrush keyword estimates with real GSC query data.
 */
export interface GscSearchData {
  /** The GSC site URL exactly as entered by the user, e.g. "https://example.com.au/" */
  site_url: string
  /** Number of calendar days covered (default 28). */
  date_range_days: number
  /** Top queries ordered by clicks descending (up to 25 rows). */
  rows: GscQueryRow[]
  fetched_at: string
}

/**
 * Google Ads Transparency Center data fetched during advanced discovery
 * (google-ads connector). Public data — no credentials required.
 */
export interface DiscoveredGoogleAdsData {
  /** Advertiser name or domain queried. */
  advertiser: string
  /** Count of active ads observed in the Transparency Center. */
  active_ads_count: number
  /** Distinct creative formats — e.g. ['text', 'image', 'video', 'shopping']. */
  ad_formats: string[]
  /** Distinct regions where ads were running (ISO country codes). */
  regions: string[]
  /** Sample headlines / preview text (up to 3). */
  top_ad_previews: string[]
}

/**
 * Payload written to `client_discovery.payload.advanced` after a connector
 * is authorised. Does NOT overwrite the basic DiscoveryReport fields — it
 * sits alongside them under the `advanced` key.
 *
 * Fields are optional so old rows (only meta_ads/facebook_profiles) remain
 * valid without schema migration.
 */
export interface AdvancedDiscoveryPayload {
  /** Meta Ad Library data — null when scrape failed or no ads found */
  meta_ads: DiscoveredMetaAds | null
  /** Facebook Page metrics — one entry per FB profile found in basic discovery */
  facebook_profiles: AdvancedFacebookProfile[]
  /** GSC search performance — populated by gsc connector trigger; null otherwise */
  gsc_data?: GscSearchData | null
  /** Google Ads Transparency scan — populated by google-ads connector; null otherwise */
  google_ads_data?: DiscoveredGoogleAdsData | null
  meta: {
    duration_ms: number
    /** Apify cost is tracked externally; Claude cost is 0 for advanced pass */
    cost_usd: number
    ran_at: string
    triggered_by: string  // connector anchor that triggered this run
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
