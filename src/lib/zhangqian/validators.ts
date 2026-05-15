/**
 * 张骞 Zhangqian — runtime validators for Claude's JSON output.
 *
 * Pure TypeScript guards (no Zod dependency). Each validator returns either
 * { ok: true, value } or { ok: false, error } — never throws — so the agent
 * can decide whether to retry, repair, or fail.
 *
 * Reference: ROADMAP.md P8.10.S0.6
 */

import type {
  DiscoveryReport,
  DiscoveredBusiness,
  DiscoveredRegistration,
  DiscoveredSocial,
  DiscoveredGbp,
  DiscoveredReviewPlatform,
  DiscoveredKeyword,
  DiscoveredCompetitor,
  DiscoveredAiQuestion,
  DiscoveredMetaAds,
  DiscoveredSerpResult,
  SemrushSnapshot,
  AiVisibilityResult,
  ReviewSample,
  SocialPlatform,
  KeywordType,
  CompetitorRelevance,
  AiQuestionCategory,
  Market,
  DiagnosisBlock,
} from './types'

// ─── Result type ──────────────────────────────────────────────────────────────

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

// ─── Primitive helpers ────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v)
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isString)

const inRange = (n: number, min: number, max: number): boolean =>
  n >= min && n <= max

// ─── Enum sets (kept inline for fast lookup, mirrors types.ts) ───────────────

const SOCIAL_PLATFORMS: ReadonlySet<SocialPlatform> = new Set<SocialPlatform>([
  'instagram', 'facebook', 'linkedin', 'youtube', 'tiktok', 'twitter', 'pinterest',
])

/**
 * Common aliases LLMs emit for known platforms — coerced before the enum
 * check so a cosmetic naming drift (e.g. Twitter → "x") doesn't drop the row.
 */
const SOCIAL_PLATFORM_ALIASES: Record<string, SocialPlatform> = {
  x: 'twitter', 'x.com': 'twitter', 'twitter.com': 'twitter',
  fb: 'facebook', meta: 'facebook', 'facebook.com': 'facebook',
  ig: 'instagram', insta: 'instagram', 'instagram.com': 'instagram',
  yt: 'youtube', 'youtube.com': 'youtube',
  li: 'linkedin', 'linkedin.com': 'linkedin',
  'tik tok': 'tiktok', 'tiktok.com': 'tiktok',
}

const KEYWORD_TYPES: ReadonlySet<KeywordType> = new Set<KeywordType>([
  'brand', 'category', 'long_tail', 'local', 'transactional',
])

const COMPETITOR_RELEVANCE: ReadonlySet<CompetitorRelevance> = new Set<CompetitorRelevance>([
  'direct', 'adjacent', 'aspirational',
])

const AI_QUESTION_CATEGORIES: ReadonlySet<AiQuestionCategory> = new Set<AiQuestionCategory>([
  'brand', 'category', 'comparison', 'local',
])

const MARKETS: ReadonlySet<Market> = new Set<Market>(['AU', 'NZ', 'AU/NZ'])

const COUNTRIES: ReadonlySet<DiscoveredBusiness['location']['country']> = new Set<
  DiscoveredBusiness['location']['country']
>(['AU', 'NZ', 'AU/NZ'])

const REVIEW_PLATFORMS: ReadonlySet<DiscoveredReviewPlatform['platform']> = new Set<
  DiscoveredReviewPlatform['platform']
>(['google', 'productreview', 'trustpilot', 'yelp', 'facebook', 'other'])

const REGISTRATION_STATUSES: ReadonlySet<DiscoveredRegistration['status']> = new Set<
  DiscoveredRegistration['status']
>(['active', 'cancelled', 'unknown'])

// ─── Field-level guards ───────────────────────────────────────────────────────

function isBusiness(v: unknown): v is DiscoveredBusiness {
  if (!isRecord(v)) return false
  if (!isString(v.name) || v.name.length === 0) return false
  if (!isStringArray(v.industry) || v.industry.length === 0) return false
  if (!isRecord(v.location)) return false
  const loc = v.location
  if (loc.city !== undefined && loc.city !== null && !isString(loc.city)) return false
  if (loc.region !== undefined && loc.region !== null && !isString(loc.region)) return false
  if (!isString(loc.country)) return false
  if (!COUNTRIES.has(loc.country as Market)) {
    const upper = loc.country.toUpperCase().slice(0, 2)
    loc.country = (COUNTRIES.has(upper as Market) ? upper : 'AU') as Market
  }
  if (!isString(v.description) || v.description.length === 0) return false
  if (!isStringArray(v.target_audience)) return false
  if (!isStringArray(v.unique_selling_points)) return false
  if (!isNumber(v.confidence) || !inRange(v.confidence, 0, 1)) return false
  // Optional verified registration (P8.12.S1.1) — coerce, never reject the
  // whole report over a malformed registration sub-object.
  if (v.registration !== undefined) {
    v.registration = isRegistration(v.registration) ? v.registration : null
  }
  return true
}

/**
 * Lenient guard for the optional registration sub-object. Nullable string
 * fields accept undefined/null/string; an unknown status is coerced to
 * 'unknown' rather than rejected.
 */
function isRegistration(v: unknown): v is DiscoveredRegistration {
  if (!isRecord(v)) return false
  if (v.country !== 'AU' && v.country !== 'NZ') return false
  if (!isString(v.identifier) || v.identifier.length === 0) return false
  if (v.identifier_type !== 'ABN' && v.identifier_type !== 'NZBN') return false
  if (v.entity_name !== undefined && v.entity_name !== null && !isString(v.entity_name)) return false
  if (v.entity_type !== undefined && v.entity_type !== null && !isString(v.entity_type)) return false
  if (!isString(v.status) || !REGISTRATION_STATUSES.has(v.status as DiscoveredRegistration['status'])) {
    v.status = 'unknown'
  }
  if (v.registered_since !== undefined && v.registered_since !== null && !isString(v.registered_since)) return false
  if (v.gst_registered !== undefined && v.gst_registered !== null
      && typeof v.gst_registered !== 'boolean') return false
  return true
}

/** Guard for a single sampled negative review. */
function isReviewSample(v: unknown): v is ReviewSample {
  if (!isRecord(v)) return false
  if (!isNumber(v.rating)) return false
  if (!isString(v.text)) return false
  if (v.date !== undefined && v.date !== null && !isString(v.date)) return false
  if (v.author !== undefined && v.author !== null && !isString(v.author)) return false
  return true
}

function isSocial(v: unknown): v is DiscoveredSocial {
  if (!isRecord(v)) return false
  if (!isString(v.platform)) return false
  // Coerce common aliases (e.g. "x" → "twitter") before the enum check; a
  // genuinely unknown platform returns false so the caller drops just that row.
  if (!SOCIAL_PLATFORMS.has(v.platform as SocialPlatform)) {
    const alias = SOCIAL_PLATFORM_ALIASES[v.platform.toLowerCase().trim()]
    if (!alias) return false
    v.platform = alias
  }
  // handle is optional nullable (some platforms expose URL only)
  if (v.handle !== undefined && v.handle !== null && !isString(v.handle)) return false
  if (!isString(v.url) || !v.url.startsWith('http')) return false
  if (!isNumber(v.confidence) || !inRange(v.confidence, 0, 1)) return false
  // Optional Apify metrics (P8.12.S1.6a) — coerce bad values to null, never reject the row.
  if (v.followers_count !== undefined && v.followers_count !== null && !isNumber(v.followers_count)) {
    v.followers_count = null
  }
  if (v.posts_last_30d !== undefined && v.posts_last_30d !== null && !isNumber(v.posts_last_30d)) {
    v.posts_last_30d = null
  }
  if (v.engagement_rate !== undefined && v.engagement_rate !== null && !isNumber(v.engagement_rate)) {
    v.engagement_rate = null
  }
  return true
}

function isGbp(v: unknown): v is DiscoveredGbp {
  if (!isRecord(v)) return false
  // Optional nullable fields: allow undefined too (Claude may omit instead of null)
  if (v.place_id !== undefined && v.place_id !== null && !isString(v.place_id)) return false
  if (!isString(v.business_name)) return false
  if (!isString(v.address)) return false
  if (v.rating !== undefined && v.rating !== null
      && (!isNumber(v.rating) || !inRange(v.rating, 0, 5))) return false
  if (v.review_count !== undefined && v.review_count !== null
      && (!isNumber(v.review_count) || v.review_count < 0)) return false
  if (v.google_maps_url !== undefined && v.google_maps_url !== null
      && !isString(v.google_maps_url)) return false
  if (!isNumber(v.confidence) || !inRange(v.confidence, 0, 1)) return false
  return true
}

function isReviewPlatform(v: unknown): v is DiscoveredReviewPlatform {
  if (!isRecord(v)) return false
  // Be lenient on platform — fall back to 'other' if Claude returns something
  // outside our enum (e.g. 'g2', 'capterra'); we'd rather keep the row than
  // throw the whole report away over an enum mismatch.
  if (!isString(v.platform)) return false
  if (!REVIEW_PLATFORMS.has(v.platform as DiscoveredReviewPlatform['platform'])) {
    v.platform = 'other'  // coerce
  }
  if (!isString(v.url)) return false
  // rating/review_count are optional: allow undefined, null, or number
  if (v.rating !== undefined && v.rating !== null && !isNumber(v.rating)) return false
  if (v.review_count !== undefined && v.review_count !== null && !isNumber(v.review_count)) return false
  // Optional enrichment fields (P8.12.S1.2) — coerce to null/clean array,
  // never reject the row over malformed enrichment data.
  if (v.rating_distribution !== undefined && !isRecord(v.rating_distribution)) {
    v.rating_distribution = null
  }
  if (v.recent_negative_samples !== undefined) {
    v.recent_negative_samples = Array.isArray(v.recent_negative_samples)
      ? v.recent_negative_samples.filter(isReviewSample)
      : null
  }
  if (v.response_rate !== undefined && v.response_rate !== null && !isNumber(v.response_rate)) {
    v.response_rate = null
  }
  return true
}

function isKeyword(v: unknown): v is DiscoveredKeyword {
  if (!isRecord(v)) return false
  if (!isString(v.keyword) || v.keyword.length === 0) return false
  if (!isString(v.type)) return false
  // Coerce unknown / compound types (e.g. "category-geo", "local-transactional")
  // to closest match in our enum. Take the first hyphen-separated token that
  // matches a known type; fall back to 'category' as the most generic bucket.
  if (!KEYWORD_TYPES.has(v.type as KeywordType)) {
    const tokens = v.type.toLowerCase().split(/[-_/\s]+/)
    const match = tokens.find(t => KEYWORD_TYPES.has(t as KeywordType))
    v.type = (match ?? 'category') as KeywordType
  }
  if (!isString(v.rationale)) return false
  if (v.estimated_volume !== undefined && v.estimated_volume !== null && !isNumber(v.estimated_volume)) return false
  return true
}

function isCompetitor(v: unknown): v is DiscoveredCompetitor {
  if (!isRecord(v)) return false
  if (!isString(v.domain) || v.domain.length === 0) return false
  if (!isString(v.name) || v.name.length === 0) return false
  if (!isString(v.relevance)) return false
  if (!COMPETITOR_RELEVANCE.has(v.relevance as CompetitorRelevance)) {
    v.relevance = 'adjacent' as CompetitorRelevance  // safe default
  }
  if (!isString(v.rationale)) return false
  if (v.location !== undefined && v.location !== null && !isString(v.location)) return false
  return true
}

function isAiQuestion(v: unknown): v is DiscoveredAiQuestion {
  if (!isRecord(v)) return false
  if (!isString(v.question) || v.question.length === 0) return false
  if (!isString(v.category)) return false
  if (!AI_QUESTION_CATEGORIES.has(v.category as AiQuestionCategory)) {
    const tokens = v.category.toLowerCase().split(/[-_/\s]+/)
    const match = tokens.find(t => AI_QUESTION_CATEGORIES.has(t as AiQuestionCategory))
    v.category = (match ?? 'category') as AiQuestionCategory
  }
  if (!isString(v.market)) return false
  if (!MARKETS.has(v.market as Market)) {
    // 'au', 'nz', 'australia' etc. → uppercase + extract first 2 letters
    const upper = v.market.toUpperCase().slice(0, 2)
    v.market = (MARKETS.has(upper as Market) ? upper : 'AU') as Market
  }
  if (!isString(v.rationale)) return false
  return true
}

/**
 * Lenient guard for the optional meta_ads block (P8.12.S1.6a).
 * An unknown estimated_spend is coerced to 'unknown' rather than rejected.
 */
function isMetaAds(v: unknown): v is DiscoveredMetaAds {
  if (!isRecord(v)) return false
  if (!isNumber(v.active_ads_count)) return false
  if (!Array.isArray(v.ad_types) || !v.ad_types.every(isString)) return false
  if (!isString(v.estimated_spend)
      || !['low', 'medium', 'high', 'unknown'].includes(v.estimated_spend)) {
    v.estimated_spend = 'unknown'
  }
  if (!Array.isArray(v.top_ad_copy) || !v.top_ad_copy.every(isString)) return false
  return true
}

/** Lenient guard for one entry of the optional serp_results array (P8.12.S1.6c). */
function isSerpResult(v: unknown): v is DiscoveredSerpResult {
  if (!isRecord(v)) return false
  if (!isString(v.query) || v.query.length === 0) return false
  if (!Array.isArray(v.organic_results)) return false
  if (!Array.isArray(v.paid_advertiser_domains)
      || !v.paid_advertiser_domains.every(isString)) return false
  // ai_overview_text is nullable — coerce a missing/bad value to null.
  if (v.ai_overview_text !== null && !isString(v.ai_overview_text)) {
    v.ai_overview_text = null
  }
  if (!Array.isArray(v.ai_overview_sources)
      || !v.ai_overview_sources.every(isString)) return false
  return true
}

/**
 * Lenient guard for the optional semrush_snapshot block.
 * Deep-coerces: nullable numeric fields stay null/number; top_keywords MUST
 * be an array — Claude sometimes emits `null` when no data, which used to
 * crash KeywordsCard.length / .slice.
 */
function isSemrushSnapshot(v: unknown): v is SemrushSnapshot {
  if (!isRecord(v)) return false
  for (const key of ['monthly_traffic', 'trust_score', 'keyword_count'] as const) {
    if (v[key] !== null && !isNumber(v[key])) v[key] = null
  }
  if (!Array.isArray(v.top_keywords)) {
    v.top_keywords = []
  } else {
    v.top_keywords = v.top_keywords.filter((kw): kw is SemrushSnapshot['top_keywords'][number] => {
      if (!isRecord(kw)) return false
      if (!isString(kw.keyword)) return false
      if (!isNumber(kw.position)) return false
      if (kw.volume !== null && !isNumber(kw.volume)) kw.volume = null
      return true
    })
  }
  return true
}

/**
 * Lenient guard for one entry of the optional ai_visibility_results array.
 * Forces top_brands to a string array (Claude may emit null).
 */
function isAiVisibilityResult(v: unknown): v is AiVisibilityResult {
  if (!isRecord(v)) return false
  if (!isString(v.question)) return false
  if (typeof v.client_mentioned !== 'boolean') return false
  if (!Array.isArray(v.top_brands)) {
    v.top_brands = []
  } else {
    v.top_brands = v.top_brands.filter(isString)
  }
  return true
}

/**
 * Lenient guard for the optional diagnosis block. Deep-coerces:
 *   scores.*    : missing / non-number → 0
 *   actions.*   : missing / non-array → []
 *   text fields : non-string → '' (empty allowed)
 *   crisis_type : non-string non-null → null
 * The UI relies on these shapes being safe to .map / .length.
 */
function isDiagnosis(v: unknown): v is DiagnosisBlock {
  if (!isRecord(v)) return false
  if (!isRecord(v.scores)) {
    v.scores = { seo: 0, social: 0, reputation: 0, ai_visibility: 0, overall: 0 }
  } else {
    const scores = v.scores as Record<string, unknown>
    for (const key of ['seo', 'social', 'reputation', 'ai_visibility', 'overall'] as const) {
      if (!isNumber(scores[key])) scores[key] = 0
    }
  }
  if (!isRecord(v.actions)) {
    v.actions = { quick_fix: [], important: [], talk_to_us: [] }
  } else {
    const actions = v.actions as Record<string, unknown>
    for (const key of ['quick_fix', 'important', 'talk_to_us'] as const) {
      if (!Array.isArray(actions[key])) actions[key] = []
      else actions[key] = (actions[key] as unknown[]).filter(isString)
    }
  }
  for (const key of ['executive_summary', 'money_flow', 'key_finding'] as const) {
    if (!isString(v[key])) v[key] = ''
  }
  if (v.crisis_type !== null && !isString(v.crisis_type)) v.crisis_type = null
  return true
}

// ─── Top-level validator ──────────────────────────────────────────────────────

/**
 * Validate the body of a Claude response. Caller is responsible for stripping
 * any markdown fences before passing the parsed JSON in. `meta` is NOT part of
 * Claude's output (set by agent.ts) and is not checked here.
 */
export function validateDiscoveryReport(
  v: unknown,
): ValidationResult<Omit<DiscoveryReport, 'meta'>> {
  if (!isRecord(v)) return { ok: false, error: 'root is not an object' }

  if (v.schema_version !== 1) {
    return { ok: false, error: `schema_version must be 1, got ${String(v.schema_version)}` }
  }

  if (!isString(v.domain) || v.domain.length === 0) {
    return { ok: false, error: 'domain is missing or empty' }
  }

  if (!isBusiness(v.business)) {
    return { ok: false, error: 'business block is invalid (check required fields)' }
  }

  // social_profiles: tolerate a missing/null field as an empty array, and
  // filter row-by-row rather than rejecting the whole report — a single bad
  // social entry must not waste an otherwise-complete discovery run.
  const socialProfiles: DiscoveredSocial[] =
    (Array.isArray(v.social_profiles) ? v.social_profiles : []).filter(isSocial)

  // gbp: coerce a malformed object to null rather than rejecting the whole report.
  const gbpValue: DiscoveredGbp | null = isGbp(v.gbp) ? v.gbp : null

  // review_platforms: filter row-by-row, never reject the whole report over one bad row.
  const reviewPlatforms: DiscoveredReviewPlatform[] =
    (Array.isArray(v.review_platforms) ? v.review_platforms : []).filter(isReviewPlatform)

  // seed_keywords / competitors / ai_tracker_questions: filter bad entries, then enforce
  // the quality floor on what survives — a single malformed entry must not waste a $1+ run.
  const seedKeywords: DiscoveredKeyword[] =
    (Array.isArray(v.seed_keywords) ? v.seed_keywords : []).filter(isKeyword)
  if (seedKeywords.length < 3) {
    return { ok: false, error: `seed_keywords must contain at least 3 valid entries (got ${seedKeywords.length})` }
  }

  const competitorsArr: DiscoveredCompetitor[] =
    (Array.isArray(v.competitors) ? v.competitors : []).filter(isCompetitor)
  if (competitorsArr.length < 3) {
    return { ok: false, error: `competitors must contain at least 3 valid entries (got ${competitorsArr.length})` }
  }

  const aiQuestions: DiscoveredAiQuestion[] =
    (Array.isArray(v.ai_tracker_questions) ? v.ai_tracker_questions : []).filter(isAiQuestion)
  if (aiQuestions.length < 5) {
    return { ok: false, error: `ai_tracker_questions must contain at least 5 valid entries (got ${aiQuestions.length})` }
  }

  if (!isString(v.notes)) {
    return { ok: false, error: 'notes must be a string (empty string allowed)' }
  }

  return {
    ok: true,
    value: {
      schema_version: 1,
      domain: v.domain,
      business: v.business,
      social_profiles: socialProfiles,
      gbp: gbpValue,
      review_platforms: reviewPlatforms,
      seed_keywords: seedKeywords,
      competitors: competitorsArr,
      ai_tracker_questions: aiQuestions,
      notes: v.notes,
      // Optional pass-through fields — deep-coerced so the UI never crashes on null nested arrays.
      semrush_snapshot: isSemrushSnapshot(v.semrush_snapshot) ? v.semrush_snapshot : null,
      ai_visibility_results: Array.isArray(v.ai_visibility_results)
        ? v.ai_visibility_results.filter(isAiVisibilityResult)
        : null,
      meta_ads: isMetaAds(v.meta_ads) ? v.meta_ads : null,
      serp_results: Array.isArray(v.serp_results) ? v.serp_results.filter(isSerpResult) : null,
      diagnosis: isDiagnosis(v.diagnosis) ? v.diagnosis : null,
    },
  }
}

/**
 * Strip common markdown wrappers Claude sometimes leaks despite instructions
 * to emit raw JSON. Returns the cleaned string ready for JSON.parse().
 */
export function stripJsonFences(raw: string): string {
  let s = raw.trim()
  // ```json … ```
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  return s.trim()
}
