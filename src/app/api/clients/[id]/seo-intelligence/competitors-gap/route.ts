import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  getSerpCompetitors,
  getKeywordsGapWithStatus,
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
import {
  competitorsGapCacheKey,
  competitorsGapFingerprint,
  dedupeInFlight,
  isCacheableResult,
  readCompetitorsGapCache,
  writeCompetitorsGapCache,
} from '@/lib/seo-intelligence/competitors-gap-cache'

// HTTP-level cache is only a short CDN buffer; the billing guard is the
// server-side cache above. Kept at 60 s so refreshes stay cheap to reason about.
const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60',
}

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

interface GapResult {
  domain: string
  competitors: LabsCompetitor[]
  gapKeywords: LabsKeyword[]
}

/** The paid part: every DataForSEO call for this route happens in here only. */
async function computeGap(
  clientId: string,
  domain: string,
  locationCode: number,
  businessTerms: ReturnType<typeof buildBusinessKeywordTerms>,
  excludedTopics: ReturnType<typeof extractExcludedTopics>,
): Promise<{ result: GapResult; cacheable: boolean }> {
  // ── Step 1: Discover competitors via DataForSEO (fallback source for resolver)
  const rawSerpResults = await getSerpCompetitors(domain, locationCode, 20)
  const filteredSerp   = rawSerpResults.filter(c => !GENERIC_DOMAIN_BLOCKLIST.has(c.domain))
  const serpMap        = new Map(filteredSerp.map(c => [c.domain, c]))

  // ── Step 2: Resolve final competitor list via unified resolver
  //   Priority: clients.competitor_domains (FDE) > master_briefs > DataForSEO auto
  const resolved = await getClientCompetitors(
    clientId,
    filteredSerp.map(c => c.domain),
    5,
    true, // strict: a DB read failure must not silently degrade to auto-discovered domains
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
  const gap = top3.length > 0
    ? await getKeywordsGapWithStatus(domain, top3, locationCode, 200)
    : { keywords: [] as LabsKeyword[], failedCount: 0 }
  const rawGapKeywords = gap.keywords
  const gapKeywords = rawGapKeywords
    .filter(keyword => isBusinessRelevantKeyword(keyword.keyword, businessTerms, excludedTopics))
    .slice(0, 100)

  const cacheable = isCacheableResult({
    competitors,
    gapFailedCount: gap.failedCount,
  })
  return { result: { domain, competitors, gapKeywords }, cacheable }
}

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
 * Cache: 24 h server-side in local_data_cache (see competitors-gap-cache.ts).
 * Invalidated early when FDE/brief competitor lists change; `?refresh=1` forces a
 * re-pull but only after a 10 min cooldown. Errors/partial results are never cached.
 * One uncached run = 1 competitors_domain + 0-5 domain_rank_overview
 * + 1-3 domain_intersection + 1 keyword_overview paid call.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id, domain, semrush_db, industry, competitor_domains')
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

  const cacheKey = competitorsGapCacheKey(clientId, locationCode)
  const fingerprint = competitorsGapFingerprint({
    domain: client.domain,
    locationCode,
    fde: client.competitor_domains ?? null,
    brief: briefRecord?.competitor_domains ?? null,
    terms: businessTerms,
    excluded: excludedTopics,
  })
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'

  try {
    const cached = await readCompetitorsGapCache<GapResult>(cacheKey, fingerprint, { forceRefresh })
    if (cached) return NextResponse.json(cached, { headers: { ...CACHE_HEADERS, 'X-Cache': 'HIT' } })

    const result = await dedupeInFlight(cacheKey, async () => {
      const computed = await computeGap(clientId, client.domain as string, locationCode, businessTerms, excludedTopics)
      if (computed.cacheable) {
        await writeCompetitorsGapCache(cacheKey, fingerprint, (client.semrush_db as string | null) ?? 'au', computed.result)
      }
      return computed.result
    })

    return NextResponse.json(result, { headers: { ...CACHE_HEADERS, 'X-Cache': 'MISS' } })
  } catch {
    return NextResponse.json(
      { error: 'Keyword Intelligence is temporarily unavailable. Competitor discovery will retry after billing or API access is restored.' },
      { status: 502 },
    )
  }
}
