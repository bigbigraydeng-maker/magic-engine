/**
 * Discovery data contract · Zod schemas
 *
 * 与 plugins/me-client-discovery/schemas/*.schema.json 一一对应 ·
 * Plugin 输出 → 本 endpoint 校验 → Supabase 落表 · 三处同 shape 零转换。
 *
 * 未来 Q1 2027 后司马徽 agent 也用这套 · 只是 source 字段变成 'simatai_auto'。
 */

import { z } from 'zod'

// ────────────────────────────────────────────────────────────────
// 共用
// ────────────────────────────────────────────────────────────────

export const SourceEnum = z.enum(['plugin_manual', 'simatai_auto', 'manual_import'])

// ────────────────────────────────────────────────────────────────
// CompetitorSnapshot
// ────────────────────────────────────────────────────────────────

const AudienceSchema = z.object({
  language_mix: z.enum(['en_only', 'en_zh', 'zh_only', 'en_zh_multi', 'unknown']).optional(),
  price_tier: z.enum(['entry', 'mid', 'high', 'luxury', 'mixed', 'unknown']).optional(),
  notes: z.string().optional(),
}).optional()

const RecentActivitySchema = z.object({
  period_months: z.number().int().default(12),
  deals_count: z.number().int().nullable().optional(),
  avg_deal_size: z.number().nullable().optional(),
  gmv: z.number().nullable().optional(),
  currency: z.string().default('NZD'),
}).optional()

const PersonalDomainSchema = z.object({
  exists: z.boolean(),
  url: z.string().nullable().optional(),
  dns_verified: z.boolean(),
  candidate_domains_checked: z.array(z.string()).optional(),
}).optional()

const SocialMediaItemSchema = z.object({
  platform: z.enum([
    'facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'threads',
    'wechat_public', 'wechat_video', 'xiaohongshu', 'douyin', 'twitter', 'other',
  ]),
  handle: z.string().nullable(),
  url: z.string().optional(),
  exists: z.boolean(),
  followers: z.number().int().nullable().optional(),
  posts_count: z.number().int().nullable().optional(),
  activity_note: z.string().optional(),
})

const PaidAdsSchema = z.object({
  meta_ads: z.enum(['yes', 'no', 'unknown']).optional(),
  google_ads: z.enum(['yes', 'no', 'unknown']).optional(),
  verification_notes: z.string().optional(),
}).optional()

const ReputationSchema = z.object({
  google_business_profile: z.boolean().nullable().optional(),
  rate_my_agent_score: z.number().nullable().optional(),
  rate_my_agent_reviews: z.number().int().nullable().optional(),
  oneroof_testimonials: z.number().int().nullable().optional(),
  other_notes: z.string().optional(),
}).optional()

export const CompetitorSnapshotSchema = z.object({
  competitor_name: z.string().min(1),
  scanned_at: z.string().datetime({ offset: true }),
  source: SourceEnum,
  positioning_oneliner: z.string().min(1),
  company: z.string().optional(),
  regions: z.array(z.string()).optional(),
  audience: AudienceSchema,
  recent_activity: RecentActivitySchema,
  personal_domain: PersonalDomainSchema,
  social_media: z.array(SocialMediaItemSchema).optional(),
  paid_ads: PaidAdsSchema,
  reputation: ReputationSchema,
  differentiators: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
  source_links: z.array(z.string().url()).optional(),
  data_gaps: z.array(z.string()),
}).strict()

export type CompetitorSnapshot = z.infer<typeof CompetitorSnapshotSchema>

// ────────────────────────────────────────────────────────────────
// MarketContextSnapshot
// ────────────────────────────────────────────────────────────────

const GeographySchema = z.object({
  country: z.enum(['NZ', 'AU', 'other']),
  region_name: z.string().min(1),
  suburbs: z.array(z.string()).optional(),
})

const MedianPriceSchema = z.object({
  suburb: z.string(),
  median_price: z.number().nullable().optional(),
  currency: z.string().default('NZD'),
  as_of: z.string().optional(),
  source_url: z.string().optional(),
})

const SchoolZoneSchema = z.object({
  zone_name: z.string(),
  covered_suburbs: z.array(z.string()).optional(),
  premium_note: z.string().optional(),
})

const DemographicsSchema = z.object({
  chinese_ethnicity_pct: z.number().nullable().optional(),
  asian_ethnicity_pct: z.number().nullable().optional(),
  census_year: z.number().int().nullable().optional(),
  census_source_url: z.string().optional(),
}).optional()

const MarketHeatSchema = z.object({
  median_yoy_pct: z.number().nullable().optional(),
  sales_volume_yoy_pct: z.number().nullable().optional(),
  days_on_market: z.number().int().nullable().optional(),
  buyer_or_seller_market: z.enum(['buyer', 'seller', 'balanced', 'unknown']).optional(),
  source_urls: z.array(z.string()).optional(),
}).optional()

const PlatformPenetrationSchema = z.object({
  facebook_pct_pop: z.number().nullable().optional(),
  instagram_pct_pop: z.number().nullable().optional(),
  wechat_note: z.string().optional(),
  xiaohongshu_note: z.string().optional(),
}).optional()

export const MarketContextSnapshotSchema = z.object({
  geography: GeographySchema,
  scanned_at: z.string().datetime({ offset: true }),
  source: SourceEnum,
  median_prices: z.array(MedianPriceSchema).optional(),
  school_zones: z.array(SchoolZoneSchema).optional(),
  demographics: DemographicsSchema,
  market_heat: MarketHeatSchema,
  buyer_profiles: z.array(z.string()).optional(),
  platform_penetration: PlatformPenetrationSchema,
  key_insights: z.array(z.string()).optional(),
  source_links: z.array(z.string()).optional(),
  data_gaps: z.array(z.string()).optional(),
}).strict()

export type MarketContextSnapshot = z.infer<typeof MarketContextSnapshotSchema>

// ────────────────────────────────────────────────────────────────
// LocalMediaChannel
// ────────────────────────────────────────────────────────────────

const CoverageSchema = z.object({
  geography_covered: z.array(z.string()).optional(),
  reach_number: z.number().int().nullable().optional(),
  reach_metric: z.enum([
    'print_circulation', 'readers_nielsen', 'fb_members', 'email_subs',
    'podcast_downloads', 'tv_viewers', 'unknown',
  ]).optional(),
  audience_profile: z.string().optional(),
}).optional()

const PricingSchema = z.object({
  rate_card_notes: z.string().optional(),
  cheapest_entry_option: z.string().optional(),
  discount_note: z.string().optional(),
  currency: z.string().default('NZD'),
}).optional()

const ContactSchema = z.object({
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  person: z.string().nullable().optional(),
  advertise_url: z.string().optional(),
  notes: z.string().optional(),
}).optional()

export const LocalMediaChannelSchema = z.object({
  media_name: z.string().min(1),
  category: z.enum([
    'print_newspaper', 'print_magazine', 'community_fb_group', 'neighbourly',
    'newsletter_edm', 'podcast', 'youtube_channel', 'radio', 'tv',
    'sponsorship_event', 'chinese_media', 'school_publication',
    'business_association', 'other',
  ]),
  scanned_at: z.string().datetime({ offset: true }),
  source: SourceEnum,
  coverage: CoverageSchema,
  pricing: PricingSchema,
  contact: ContactSchema,
  chinese_relevant: z.boolean(),
  recommended_play: z.string().optional(),
  roi_rank: z.number().int().min(1).max(5).optional(),
  traps_to_avoid: z.array(z.string()).optional(),
  source_links: z.array(z.string()).optional(),
}).strict()

export type LocalMediaChannel = z.infer<typeof LocalMediaChannelSchema>

// ────────────────────────────────────────────────────────────────
// Endpoint request payload
// ────────────────────────────────────────────────────────────────

export const ScanResultsRequestSchema = z.object({
  client_id: z.string().uuid(),
  scanned_at: z.string().datetime({ offset: true }),
  source: SourceEnum,
  competitors: z.array(CompetitorSnapshotSchema).default([]),
  market_context: MarketContextSnapshotSchema.nullable().default(null),
  local_media_channels: z.array(LocalMediaChannelSchema).default([]),
}).strict()

export type ScanResultsRequest = z.infer<typeof ScanResultsRequestSchema>

export const ScanResultsResponseSchema = z.object({
  written: z.object({
    competitor_snapshots: z.number().int(),
    market_context_snapshots: z.number().int(),
    local_media_channels: z.number().int(),
  }),
  discovery_tab_url: z.string(),
})

export type ScanResultsResponse = z.infer<typeof ScanResultsResponseSchema>
