import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  getSerpCompetitors,
  getKeywordsGap,
  fetchDomainRankOverview,
  type LabsCompetitor,
  type LabsKeyword,
} from '@/lib/dataforseo/labs'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { getClientCompetitors } from '@/lib/competitors/resolver'
import {
  buildBusinessKeywordTerms,
  extractBriefSeedTerms,
  extractExcludedTopics,
  isBusinessRelevantKeyword,
} from '@/lib/seo-intelligence/keyword-relevance'

const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }

/**
 * Generic high-traffic domains that appear as false positives in DataForSEO
 * competitor discovery for small/mid-size sites. Always filtered out.
 */
const GENERIC_DOMAIN_BLOCKLIST = new Set([
  'facebook.com', 'instagram.com', 'youtube.com', 'twitter.com', 'x.com',
  'reddit.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'snapchat.com',
  'google.com', 'google.com.au', 'google.co.nz',
  'wikipedia.org', 'wikimedia.org',
  'amazon.com', 'amazon.com.au', 'ebay.com', 'ebay.com.au',
  'yelp.com', 'trustpilot.com', 'glassdoor.com',
  'apple.com', 'microsoft.com',
  // Travel aggregators — high-DA sites that co-rank on travel terms but are not direct competitors
  'tripadvisor.com', 'tripadvisor.com.au', 'tripadvisor.co.nz',
  'booking.com', 'expedia.com', 'expedia.com.au', 'expedia.co.nz',
  'hotels.com', 'agoda.com', 'airbnb.com', 'hostelworld.com',
])

/**
 * GET /api/clients/[id]/seo-intelligence/competitors-gap
 *
 * Returns top competitors + keyword gap (untapped keywords where competitors
 * rank but the client does not).
 *
 * Competitor selection priority (highest → lowest):
 *   1. clients.competitor_domains (FDE hand-picked — highest weight)
 *   2. active master_briefs.competitor_domains (Brand Brief / Discovery)
 *   3. DataForSEO auto-discovery, filtered by GENERIC_DOMAIN_BLOCKLIST
 *
 * Response shape:
 * {
 *   domain:      string
 *   competitors: LabsCompetitor[]   // up to 5
 *   gapKeywords: LabsKeyword[]      // up to 100 untapped keywords
 * }
 *
 * Cache: 24 h (expensive DataForSEO live calls).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, domain, semrush_db, industry')
    .eq('id', clientId)
    .single()

  if (clientError || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  if (!client.domain) {
    return NextResponse.json(
      { error: 'Client has no domain configured' },
      { status: 400 },
    )
  }

  const locationCode = LOCATION_CODE_BY_DB[(client.semrush_db as string | null) ?? 'au'] ?? LOCATION_CODE_BY_DB.au

  // Read brief for business terms (NOT for competitor list — that's resolver's job)
  const activeBrief = await getActiveBrief(clientId)
  const briefRecord = activeBrief as Record<string, unknown> | null
  const businessTerms = buildBusinessKeywordTerms({
    domain: client.domain,
    industry: (client.industry as string | null) ?? null,
    seedTerms: extractBriefSeedTerms(briefRecord),
  })
  const excludedTopics = extractExcludedTopics(briefRecord)

  try {
    // ── Step 1: Discover competitors via DataForSEO (fallback source for resolver)
    const rawSerpResults = await getSerpCompetitors(client.domain, locationCode, 20)
    const filteredSerp   = rawSerpResults.filter(c => !GENERIC_DOMAIN_BLOCKLIST.has(c.domain))
    const serpMap        = new Map(filteredSerp.map(c => [c.domain, c]))

    // ── Step 2: Resolve final competitor list via unified resolver
    //   Priority: clients.competitor_domains (FDE) > master_briefs > DataForSEO auto
    const resolved = await getClientCompetitors(
      clientId,
      filteredSerp.map(c => c.domain),
      5,
    )
    const competitors: LabsCompetitor[] = resolved.domains.map(domain =>
      serpMap.get(domain) ?? {
        domain,
        avg_position:    null,
        intersections:   0,
        monthly_traffic: null,
        keyword_count:   null,
      }
    )

    // ── Step 2.5: Enrich stub competitors (those not in SERP list — typically
    //   FDE hand-picked niche competitors that DataForSEO competitors_domain
    //   missed). One domain_rank_overview call per stub, in parallel.
    //   intersections + avg_position stay null (we have no shared-keyword data
    //   for them), but monthly_traffic + keyword_count get real values.
    const stubsToEnrich = competitors.filter(c => c.monthly_traffic === null && c.keyword_count === null)
    if (stubsToEnrich.length > 0) {
      const enrichResults = await Promise.allSettled(
        stubsToEnrich.map(c => fetchDomainRankOverview(c.domain, locationCode)),
      )
      stubsToEnrich.forEach((stub, idx) => {
        const r = enrichResults[idx]
        if (r.status === 'fulfilled') {
          stub.monthly_traffic = r.value.organic_traffic
          stub.keyword_count   = r.value.organic_keywords
        }
      })
    }

    // ── Step 3: Keyword gap using top 3 competitor domains
    const top3       = competitors.slice(0, 3).map(c => c.domain)
    const rawGapKeywords: LabsKeyword[] = top3.length > 0
      ? await getKeywordsGap(client.domain, top3, locationCode, 200)
      : []
    const gapKeywords = rawGapKeywords
      .filter(keyword => isBusinessRelevantKeyword(keyword.keyword, businessTerms, excludedTopics))
      .slice(0, 100)

    return NextResponse.json(
      { domain: client.domain, competitors, gapKeywords },
      {
        headers: {
          // Short cache so FDE-edited competitor_domains take effect within ~1 minute.
          // Trade-off: DataForSEO calls are gated by this cache, so don't drop to 0;
          // 60s strikes a balance between freshness and API spend (was 86400 / 24h).
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60',
        },
      },
    )
  } catch {
    return NextResponse.json(
      { error: 'Keyword Intelligence is temporarily unavailable. Competitor discovery will retry after billing or API access is restored.' },
      { status: 502 },
    )
  }
}
