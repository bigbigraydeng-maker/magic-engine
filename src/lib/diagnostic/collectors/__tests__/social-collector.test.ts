import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures variables are available at factory time
// ---------------------------------------------------------------------------

const { mockScrapeInstagramProfile, mockScrapeFacebookPage, mockScrapeTiktokProfile } = vi.hoisted(() => ({
  mockScrapeInstagramProfile: vi.fn(),
  mockScrapeFacebookPage: vi.fn(),
  mockScrapeTiktokProfile: vi.fn(),
}))

vi.mock('@/lib/apify/social-scraper', () => ({
  scrapeInstagramProfile: mockScrapeInstagramProfile,
  scrapeFacebookPage: mockScrapeFacebookPage,
  scrapeTiktokProfile: mockScrapeTiktokProfile,
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { SocialCollector } from '../social-collector'

// ---------------------------------------------------------------------------
// Supabase mock factory
// ---------------------------------------------------------------------------

const CLIENT_ID = 'client-social-test'
const DOMAIN = 'example.co.nz'
const KEYWORDS: string[] = []

const DEFAULT_TOP_POSTS = [
  {
    platform: 'Instagram' as const,
    url: 'https://instagram.com/p/abc',
    caption: 'Premium NZ tour content #travel #newzealand',
    likes: 320,
    comments: 25,
    hashtags: ['travel', 'newzealand'],
    posted_at: '2026-05-10T00:00:00Z',
  },
]

const DEFAULT_INSTAGRAM = {
  username: 'example_brand',
  followersCount: 5000,
  postsLast30Days: 15,
  engagementRate: 0.025,
  contentTypes: ['image', 'reel', 'video'],
  topPosts30d: DEFAULT_TOP_POSTS,
}

/** Builds a Supabase mock that controls cache check + client handle fetch */
function makeSupabase(opts: {
  instagramHandle?: string | null
  hasCachedFindings?: boolean
}): SupabaseClient {
  const { instagramHandle = 'example_brand', hasCachedFindings = false } = opts

  return {
    from: vi.fn((table: string) => {
      if (table === 'clients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { instagram_handle: instagramHandle },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'diagnostic_findings') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: hasCachedFindings ? [{ id: 'cached-finding' }] : [],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }
      return {}
    }),
  } as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockScrapeInstagramProfile.mockResolvedValue({ ...DEFAULT_INSTAGRAM })
  mockScrapeFacebookPage.mockResolvedValue({
    pageName: 'Example Brand',
    followersCount: 3000,
    postsLast30Days: 12,
    engagementRate: 0.02,
  })
})

// ---------------------------------------------------------------------------
// Basic shape
// ---------------------------------------------------------------------------

describe('SocialCollector.collect() — basic shape', () => {
  it('returns { score, findings } with score in 0–100', async () => {
    const supabase = makeSupabase({})
    const result = await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(Array.isArray(result.findings)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Posting frequency findings
// ---------------------------------------------------------------------------

describe('SocialCollector.collect() — posting frequency', () => {
  it('emits low_posting_frequency (critical) when 0 posts in 30 days', async () => {
    mockScrapeInstagramProfile.mockResolvedValue({
      ...DEFAULT_INSTAGRAM,
      postsLast30Days: 0,
      engagementRate: 0,
    })
    const supabase = makeSupabase({})
    const { findings } = await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = findings.find(x => x.finding_type === 'low_posting_frequency')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('critical')
  })

  it('emits low_posting_frequency (high) when 3 posts in 30 days', async () => {
    mockScrapeInstagramProfile.mockResolvedValue({
      ...DEFAULT_INSTAGRAM,
      postsLast30Days: 3,
    })
    const supabase = makeSupabase({})
    const { findings } = await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    const f = findings.find(x => x.finding_type === 'low_posting_frequency')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('does NOT emit low_posting_frequency when posts >= 12', async () => {
    mockScrapeInstagramProfile.mockResolvedValue({
      ...DEFAULT_INSTAGRAM,
      postsLast30Days: 12,
    })
    const supabase = makeSupabase({})
    const { findings } = await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings.find(x => x.finding_type === 'low_posting_frequency')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Engagement findings
// ---------------------------------------------------------------------------

describe('SocialCollector.collect() — engagement', () => {
  it('emits low_engagement_rate when engagement < 0.5%', async () => {
    mockScrapeInstagramProfile.mockResolvedValue({
      ...DEFAULT_INSTAGRAM,
      engagementRate: 0.003,  // 0.3%
    })
    const supabase = makeSupabase({})
    const { findings } = await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings.find(x => x.finding_type === 'low_engagement_rate')).toBeDefined()
  })

  it('does NOT emit low_engagement_rate when engagement >= 0.5%', async () => {
    mockScrapeInstagramProfile.mockResolvedValue({
      ...DEFAULT_INSTAGRAM,
      engagementRate: 0.01,  // 1%
    })
    const supabase = makeSupabase({})
    const { findings } = await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(findings.find(x => x.finding_type === 'low_engagement_rate')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Missing platform presence
// ---------------------------------------------------------------------------

describe('SocialCollector.collect() — missing Instagram handle', () => {
  it('returns score=null and social_accounts_not_linked (high) when no instagram_handle', async () => {
    // P8.5.23: no social accounts linked → cannot evaluate; dimension skipped
    const supabase = makeSupabase({ instagramHandle: null })
    const { score, findings } = await new SocialCollector(supabase).collect(
      CLIENT_ID, DOMAIN, KEYWORDS,
    )
    expect(score).toBeNull()
    const f = findings.find(x => x.finding_type === 'social_accounts_not_linked')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('high')
  })

  it('does NOT call Apify when instagram_handle is missing', async () => {
    const supabase = makeSupabase({ instagramHandle: null })
    await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(mockScrapeInstagramProfile).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Degraded result on Apify failure
// ---------------------------------------------------------------------------

describe('SocialCollector.collect() — Apify failure', () => {
  it('returns degraded { score: null, findings: [] } when Apify throws', async () => {
    mockScrapeInstagramProfile.mockRejectedValue(new Error('Apify down'))
    const supabase = makeSupabase({})
    const result = await new SocialCollector(supabase, 30_000).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(result.findings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Cache hit — Apify NOT called
// ---------------------------------------------------------------------------

describe('SocialCollector.collect() — cache', () => {
  it('does NOT call Apify when fresh social findings exist in DB (within 7 days)', async () => {
    const supabase = makeSupabase({ hasCachedFindings: true })
    await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(mockScrapeInstagramProfile).not.toHaveBeenCalled()
    expect(mockScrapeFacebookPage).not.toHaveBeenCalled()
  })

  it('returns a valid CollectorResult from cache (score=null when cache hit)', async () => {
    const supabase = makeSupabase({ hasCachedFindings: true })
    const result = await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.score).toBeNull()
    expect(Array.isArray(result.findings)).toBe(true)
  })
})

// ─── P8.10.S2.3: post sampling ──────────────────────────────────────────────

describe('SocialCollector.collect() — top-post samples (P8.10.S2.3)', () => {
  it('exposes post_samples on the result and pipes top_posts_30d into finding evidence', async () => {
    mockScrapeInstagramProfile.mockResolvedValue({ ...DEFAULT_INSTAGRAM, postsLast30Days: 2 })
    const supabase = makeSupabase({ instagramHandle: 'example_brand' })
    const result = await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)

    expect(result.post_samples.length).toBeGreaterThan(0)
    const freqFinding = result.findings.find(f => f.finding_type === 'low_posting_frequency')
    expect(freqFinding).toBeDefined()
    const ev = freqFinding!.evidence as { parsed?: { top_posts_30d?: unknown[] } }
    expect(Array.isArray(ev.parsed?.top_posts_30d)).toBe(true)
    expect((ev.parsed!.top_posts_30d as unknown[]).length).toBeGreaterThan(0)
  })

  it('returns post_samples=[] when no platforms configured', async () => {
    const supabase = makeSupabase({ instagramHandle: null })
    const result = await new SocialCollector(supabase).collect(CLIENT_ID, DOMAIN, KEYWORDS)
    expect(result.post_samples).toEqual([])
  })
})
