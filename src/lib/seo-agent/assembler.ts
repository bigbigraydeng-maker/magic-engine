import { getActiveBrief } from '@/lib/content/brief-injector'
import { getKeywordsGap, getRankedKeywords, getSerpCompetitors } from '@/lib/dataforseo/labs'
import { getLatestKeywordSnapshotForClient, locationCodeForDb } from '@/lib/seo-intelligence/keyword-snapshots'
import { isBrandedKeyword } from '@/lib/seo-intelligence/intent-strategy'
import {
  buildBusinessKeywordTerms,
  extractBriefSeedTerms,
  isBusinessRelevantKeyword,
} from '@/lib/seo-intelligence/keyword-relevance'
import { getPositionChangesForClient } from '@/lib/seo-intelligence/position-changes'
import { getActiveGoal } from '@/lib/strategy/goals'
import { getLatestDiscovery } from '@/lib/zhangqian/persistor'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LabsKeyword } from '@/lib/dataforseo/labs'
import { buildScoredCandidate, type RawSeoCandidate } from './scorer'
import type { SeoAgentInput, SeoAgentLocationContext, SeoKeywordCandidate } from './types'

const GENERIC_DOMAIN_BLOCKLIST = new Set([
  'facebook.com', 'instagram.com', 'youtube.com', 'reddit.com', 'linkedin.com', 'google.com',
  'tripadvisor.com', 'booking.com', 'expedia.com', 'airbnb.com',
])

export async function assembleSeoAgentInput(
  supabase: SupabaseClient,
  clientId: string,
): Promise<SeoAgentInput> {
  const client = await fetchClientContext(supabase, clientId)
  const [goal, brief, discovery, rankings, positionChanges] = await Promise.all([
    getActiveGoal(supabase, clientId),
    getActiveBrief(clientId),
    getLatestDiscovery(supabase, clientId),
    fetchRankings(client),
    getPositionChangesForClient(clientId).catch(() => ({ changes: [] })),
  ])

  const location = buildLocationContext(discovery?.payload?.business?.location, brief?.target_audience?.location ?? null)
  const businessTerms = buildBusinessKeywordTerms({
    domain: client.domain,
    industry: client.industry,
    seedTerms: extractBriefSeedTerms(brief as Record<string, unknown> | null),
  })
  const gapKeywords = await fetchGapKeywords(client.domain, client.semrush_db, brief?.competitor_domains ?? [], businessTerms)
  const candidates = buildCandidates({
    domain: client.domain,
    goal,
    rankings,
    gapKeywords,
    positionChanges: positionChanges.changes ?? [],
    businessTerms,
    location,
  })

  return {
    client,
    goal,
    brief,
    location,
    candidates,
    rankings_count: rankings.length,
    gap_count: gapKeywords.length,
    position_change_count: (positionChanges.changes ?? []).length,
  }
}

async function fetchClientContext(supabase: SupabaseClient, clientId: string) {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, domain, semrush_db, industry')
    .eq('id', clientId)
    .single()

  if (error || !data?.domain) {
    throw new Error(error?.message ?? `Client ${clientId} is missing a domain`)
  }

  return {
    id: data.id as string,
    name: data.name as string,
    domain: data.domain as string,
    semrush_db: (data.semrush_db as string | null) ?? 'au',
    industry: (data.industry as string | null) ?? null,
  }
}

async function fetchRankings(client: { id: string; domain: string; semrush_db: string | null }): Promise<LabsKeyword[]> {
  const locationCode = locationCodeForDb(client.semrush_db)
  try {
    return await getRankedKeywords(client.domain, locationCode, 200)
  } catch {
    const snapshot = await getLatestKeywordSnapshotForClient(client)
    return snapshot.keywords
  }
}

async function fetchGapKeywords(
  domain: string,
  semrushDb: string | null,
  knownCompetitors: string[],
  businessTerms: string[],
): Promise<LabsKeyword[]> {
  const locationCode = locationCodeForDb(semrushDb)
  const competitorDomains = knownCompetitors.length > 0
    ? normalizeCompetitors(knownCompetitors)
    : await discoverCompetitors(domain, locationCode)

  if (competitorDomains.length === 0) return []

  const keywords = await getKeywordsGap(domain, competitorDomains.slice(0, 3), locationCode, 120)
  return keywords.filter((item) => isBusinessRelevantKeyword(item.keyword, businessTerms)).slice(0, 40)
}

async function discoverCompetitors(domain: string, locationCode: number): Promise<string[]> {
  const competitors = await getSerpCompetitors(domain, locationCode, 10)
  return competitors
    .map((item) => item.domain.toLowerCase())
    .filter((item) => !GENERIC_DOMAIN_BLOCKLIST.has(item))
    .slice(0, 5)
}

function normalizeCompetitors(domains: string[]): string[] {
  return domains
    .map((item) => item.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase())
    .filter((item) => item.length > 0)
}

function buildLocationContext(
  location: { city: string | null; region: string | null; country: 'AU' | 'NZ' | 'AU/NZ' } | undefined,
  audienceLocation: string | null,
): SeoAgentLocationContext {
  return {
    city: location?.city ?? null,
    region: location?.region ?? null,
    country: location?.country ?? 'AU/NZ',
    audience_location: audienceLocation,
  }
}

function buildCandidates(input: {
  domain: string
  goal: SeoAgentInput['goal']
  rankings: LabsKeyword[]
  gapKeywords: LabsKeyword[]
  positionChanges: Array<{
    keyword: string
    current_position: number | null
    previous_position: number | null
    position_delta: number | null
    search_volume: number | null
    keyword_difficulty: number | null
    intent: string | null
    change_type: string
  }>
  businessTerms: string[]
  location: SeoAgentLocationContext
}): SeoKeywordCandidate[] {
  const brandRoot = input.domain.replace(/^www\./, '').split('.')[0].toLowerCase()
  const map = new Map<string, RawSeoCandidate>()

  for (const candidate of buildGapCandidates(input.gapKeywords, input.businessTerms, input.location)) {
    map.set(candidate.keyword, candidate)
  }

  for (const candidate of buildRankingCandidates(input.rankings, brandRoot, input.businessTerms, input.location)) {
    if (!map.has(candidate.keyword)) map.set(candidate.keyword, candidate)
  }

  for (const candidate of buildChangeCandidates(input.positionChanges, brandRoot, input.businessTerms, input.location)) {
    if (!map.has(candidate.keyword)) map.set(candidate.keyword, candidate)
  }

  return Array.from(map.values())
    .map((item) => buildScoredCandidate(item, input.goal))
    .filter((item) => item.score >= 35)
    .sort((a, b) => b.score - a.score || (b.search_volume ?? 0) - (a.search_volume ?? 0))
    .slice(0, 16)
}

function buildGapCandidates(
  keywords: LabsKeyword[],
  businessTerms: string[],
  location: SeoAgentLocationContext,
): RawSeoCandidate[] {
  return keywords.slice(0, 18).map((item) => buildRawCandidate(item, 'gap', businessTerms, location))
}

function buildRankingCandidates(
  keywords: LabsKeyword[],
  brandRoot: string,
  businessTerms: string[],
  location: SeoAgentLocationContext,
): RawSeoCandidate[] {
  // NOTE: intentionally uses token-equality `isBrandedKeyword` (not the
  // alias-aware `isBrandedKeywordWithAliases` from intent-strategy.ts). The
  // assembler is selecting CONTENT-BRIEF candidates: widening the matcher to
  // substring + aliases here would suppress legitimate non-brand keyword
  // opportunities (e.g. "cts" alias would knock out generic-term candidates
  // that happen to contain those letters). If a future PR needs alias-aware
  // filtering in the assembler, switch to isBrandedKeywordWithAliases and
  // pass clients.brand_aliases through. See intent-strategy.ts for context.
  return keywords
    .filter((item) => !isBrandedKeyword(item.keyword, brandRoot))
    .filter((item) => item.intent !== 'navigational')
    .filter((item) => (item.position ?? 999) >= 4 && (item.position ?? 999) <= 20)
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
    .slice(0, 10)
    .map((item) => buildRawCandidate(item, 'ranking', businessTerms, location))
}

function buildChangeCandidates(
  changes: Array<{
    keyword: string
    current_position: number | null
    previous_position: number | null
    position_delta: number | null
    search_volume: number | null
    keyword_difficulty: number | null
    intent: string | null
    change_type: string
  }>,
  brandRoot: string,
  businessTerms: string[],
  location: SeoAgentLocationContext,
): RawSeoCandidate[] {
  return changes
    .filter((item) => item.change_type === 'declined' || item.change_type === 'lost')
    .filter((item) => !isBrandedKeyword(item.keyword, brandRoot))
    .slice(0, 8)
    .map((item) => ({
      keyword: item.keyword,
      source: 'position_change' as const,
      intent: item.intent ?? 'informational',
      search_volume: item.search_volume,
      keyword_difficulty: item.keyword_difficulty,
      position: item.current_position,
      previous_position: item.previous_position,
      position_delta: item.position_delta,
      has_business_match: isBusinessRelevantKeyword(item.keyword, businessTerms),
      has_location_match: matchesLocation(item.keyword, location),
    }))
}

function buildRawCandidate(
  keyword: LabsKeyword,
  source: RawSeoCandidate['source'],
  businessTerms: string[],
  location: SeoAgentLocationContext,
): RawSeoCandidate {
  return {
    keyword: keyword.keyword,
    source,
    intent: keyword.intent,
    search_volume: keyword.search_volume,
    keyword_difficulty: keyword.keyword_difficulty,
    position: keyword.position ?? null,
    previous_position: null,
    position_delta: null,
    has_business_match: isBusinessRelevantKeyword(keyword.keyword, businessTerms),
    has_location_match: matchesLocation(keyword.keyword, location),
  }
}

function matchesLocation(keyword: string, location: SeoAgentLocationContext): boolean {
  const normalized = keyword.toLowerCase()
  return extractLocationTokens(location).some((token) => normalized.includes(token))
}

function extractLocationTokens(location: SeoAgentLocationContext): string[] {
  const raw = [location.city, location.region, location.audience_location]
    .filter((item): item is string => Boolean(item))
    .join(' ')
    .toLowerCase()

  return raw
    .split(/[^a-z0-9]+/)
    .filter((item) => item.length >= 3)
}
