import { describe, it, expect } from 'vitest'
import {
  CompetitorSnapshotSchema,
  MarketContextSnapshotSchema,
  LocalMediaChannelSchema,
  ScanResultsRequestSchema,
} from '../schemas'

// ────────────────────────────────────────────────────────────────
// Real fixtures (from Roman Hu 2026-07-10 canonical case)
// ────────────────────────────────────────────────────────────────

const validCompetitor = {
  competitor_name: 'Aaron Foss',
  scanned_at: '2026-07-10T09:30:00+12:00',
  source: 'plugin_manual' as const,
  positioning_oneliner: 'Barfoot Mission Bay 全公司 No.1',
  company: 'Barfoot & Thompson',
  regions: ['Mission Bay', 'Kohimarama'],
  audience: {
    language_mix: 'en_only' as const,
    price_tier: 'high' as const,
  },
  recent_activity: {
    period_months: 12,
    deals_count: 28,
    avg_deal_size: 2650000,
    gmv: null,
    currency: 'NZD',
  },
  personal_domain: {
    exists: false,
    url: null,
    dns_verified: true,
    candidate_domains_checked: ['aaronfoss.co.nz'],
  },
  social_media: [
    {
      platform: 'facebook' as const,
      handle: 'aaronfossrealestate',
      url: 'https://facebook.com/aaronfossrealestate',
      exists: true,
      followers: 2120,
      posts_count: null,
      activity_note: '95% listing 搬砖',
    },
  ],
  paid_ads: { meta_ads: 'unknown' as const, google_ads: 'unknown' as const },
  reputation: { oneroof_testimonials: 123 },
  differentiators: ['8 年区域 No.1'],
  weaknesses: ['无个人域名'],
  source_links: ['https://barfoot.co.nz/our-people/a.foss'],
  data_gaps: ['Meta Ad Library 是 SPA 反爬未拿到'],
}

const validMarketContext = {
  geography: {
    country: 'NZ' as const,
    region_name: 'Auckland Bayside + Central Gold',
    suburbs: ['Mission Bay', 'Remuera'],
  },
  scanned_at: '2026-07-10T10:00:00+12:00',
  source: 'plugin_manual' as const,
  median_prices: [{ suburb: 'Mission Bay', median_price: 2100000 }],
  demographics: { asian_ethnicity_pct: 34.5, census_year: 2023 },
  market_heat: { median_yoy_pct: -1.92, buyer_or_seller_market: 'buyer' as const },
  key_insights: ['双市场双话术'],
  source_links: ['https://reinz.co.nz'],
  data_gaps: [],
}

const validLocalMedia = {
  media_name: 'East & Bays Courier',
  category: 'print_newspaper' as const,
  scanned_at: '2026-07-10T10:20:00+12:00',
  source: 'plugin_manual' as const,
  coverage: {
    geography_covered: ['Mission Bay'],
    reach_metric: 'print_circulation' as const,
  },
  pricing: { rate_card_notes: 'Front page solus $900' },
  contact: { email: 'david.gadd@stuff.co.nz' },
  chinese_relevant: false,
  recommended_play: 'Front page solus 月 1 次',
  roi_rank: 1,
  source_links: ['https://advertise.stuff.co.nz'],
}

// ────────────────────────────────────────────────────────────────
// CompetitorSnapshot
// ────────────────────────────────────────────────────────────────

describe('CompetitorSnapshotSchema', () => {
  it('accepts a full Roman-case Aaron Foss competitor', () => {
    const result = CompetitorSnapshotSchema.safeParse(validCompetitor)
    expect(result.success).toBe(true)
  })

  it('accepts null-heavy fields (unknown data)', () => {
    const minimal = {
      competitor_name: 'X',
      scanned_at: '2026-07-10T09:30:00+12:00',
      source: 'plugin_manual',
      positioning_oneliner: 'test',
      data_gaps: [],
    }
    expect(CompetitorSnapshotSchema.safeParse(minimal).success).toBe(true)
  })

  it('rejects missing required fields', () => {
    const noName = { ...validCompetitor, competitor_name: '' }
    expect(CompetitorSnapshotSchema.safeParse(noName).success).toBe(false)
  })

  it('rejects invalid source enum', () => {
    const badSource = { ...validCompetitor, source: 'random' }
    expect(CompetitorSnapshotSchema.safeParse(badSource).success).toBe(false)
  })

  it('rejects extra properties (strict mode)', () => {
    const extra = { ...validCompetitor, extra_field: 'oops' }
    expect(CompetitorSnapshotSchema.safeParse(extra).success).toBe(false)
  })

  it('requires data_gaps array (even empty)', () => {
    const { data_gaps: _, ...withoutGaps } = validCompetitor
    void _
    expect(CompetitorSnapshotSchema.safeParse(withoutGaps).success).toBe(false)
  })

  it('accepts scanned_at only in ISO 8601 with offset', () => {
    const badTime = { ...validCompetitor, scanned_at: '2026-07-10' }
    expect(CompetitorSnapshotSchema.safeParse(badTime).success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────
// MarketContextSnapshot
// ────────────────────────────────────────────────────────────────

describe('MarketContextSnapshotSchema', () => {
  it('accepts a full Roman-case market context', () => {
    expect(MarketContextSnapshotSchema.safeParse(validMarketContext).success).toBe(true)
  })

  it('accepts null demographics (unknown data)', () => {
    const noDemographics = { ...validMarketContext, demographics: undefined }
    expect(MarketContextSnapshotSchema.safeParse(noDemographics).success).toBe(true)
  })

  it('rejects unknown country code', () => {
    const bad = {
      ...validMarketContext,
      geography: { ...validMarketContext.geography, country: 'US' },
    }
    expect(MarketContextSnapshotSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects extra property at top level', () => {
    const extra = { ...validMarketContext, sneaky: 1 }
    expect(MarketContextSnapshotSchema.safeParse(extra).success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────
// LocalMediaChannel
// ────────────────────────────────────────────────────────────────

describe('LocalMediaChannelSchema', () => {
  it('accepts a full Roman-case media channel', () => {
    expect(LocalMediaChannelSchema.safeParse(validLocalMedia).success).toBe(true)
  })

  it('rejects unknown category', () => {
    const bad = { ...validLocalMedia, category: 'not_a_category' }
    expect(LocalMediaChannelSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects roi_rank out of 1-5', () => {
    const zero = { ...validLocalMedia, roi_rank: 0 }
    const six = { ...validLocalMedia, roi_rank: 6 }
    expect(LocalMediaChannelSchema.safeParse(zero).success).toBe(false)
    expect(LocalMediaChannelSchema.safeParse(six).success).toBe(false)
  })

  it('requires chinese_relevant explicit boolean (no default)', () => {
    const { chinese_relevant: _, ...withoutFlag } = validLocalMedia
    void _
    expect(LocalMediaChannelSchema.safeParse(withoutFlag).success).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────
// ScanResultsRequest (endpoint payload)
// ────────────────────────────────────────────────────────────────

describe('ScanResultsRequestSchema', () => {
  const validRequest = {
    client_id: '550e8400-e29b-41d4-a716-446655440000',
    scanned_at: '2026-07-10T09:00:00+12:00',
    source: 'plugin_manual' as const,
    competitors: [validCompetitor],
    market_context: validMarketContext,
    local_media_channels: [validLocalMedia],
  }

  it('accepts a full payload', () => {
    expect(ScanResultsRequestSchema.safeParse(validRequest).success).toBe(true)
  })

  it('accepts payload with only competitors (no market/media)', () => {
    const compsOnly = {
      client_id: validRequest.client_id,
      scanned_at: validRequest.scanned_at,
      source: 'plugin_manual' as const,
      competitors: [validCompetitor],
      market_context: null,
      local_media_channels: [],
    }
    expect(ScanResultsRequestSchema.safeParse(compsOnly).success).toBe(true)
  })

  it('rejects non-UUID client_id', () => {
    const bad = { ...validRequest, client_id: 'roman-hu' }
    expect(ScanResultsRequestSchema.safeParse(bad).success).toBe(false)
  })

  it('fails when any competitor in the array is invalid (all-or-nothing)', () => {
    const bad = {
      ...validRequest,
      competitors: [validCompetitor, { competitor_name: '' }],
    }
    expect(ScanResultsRequestSchema.safeParse(bad).success).toBe(false)
  })
})
