import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

function getCredentials(): { login: string; password: string } {
  return {
    login: validateEnvVar('DATAFORSEO_LOGIN'),
    password: validateEnvVar('DATAFORSEO_PASSWORD'),
  }
}

export interface CompetitorDomain {
  domain: string
  overlap_score: number  // 0–1, shared keyword ratio vs client
  organic_traffic: number
  authority_score: number
}

export async function getCompetitorDomains(
  domain: string,
  limit: number = 5,
): Promise<CompetitorDomain[]> {
  const { login, password } = getCredentials()
  const credentials = Buffer.from(`${login}:${password}`).toString('base64')

  const res = await fetch(`${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        keyword: `site:${domain}`,
        location_code: 2554,  // Australia
        language_code: 'en',
        depth: 10,
      },
    ]),
  })

  if (!res.ok) throw new Error(`DataForSEO API error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          domain?: string
          etv?: number
          intersections?: number
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(item => item.domain && item.domain !== domain)
    .slice(0, limit)
    .map(item => ({
      domain: item.domain ?? '',
      overlap_score: Math.min(1, (item.intersections ?? 0) / 100),
      organic_traffic: item.etv ?? 0,
      authority_score: 0,
    }))
}

// ─── P8.10.S2.1: Backlink summary ────────────────────────────────────────────

export interface BacklinkSummary {
  total_backlinks: number
  referring_domains: number
  rank: number              // 0–1000 DataForSEO backlink rank (higher = stronger)
  broken_backlinks: number
  fetched_at: string        // ISO timestamp
}

export async function getBacklinkSummary(domain: string): Promise<BacklinkSummary> {
  const { login, password } = getCredentials()
  const credentials = Buffer.from(`${login}:${password}`).toString('base64')

  const res = await fetch(`${DATAFORSEO_API_BASE}/backlinks/summary/live`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ target: domain, internal_list_limit: 10 }]),
  })

  if (!res.ok) throw new Error(`DataForSEO backlinks error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        backlinks?: number
        referring_domains?: number
        rank?: number
        broken_backlinks?: number
      }>
    }>
  }

  const r = json.tasks?.[0]?.result?.[0] ?? {}
  return {
    total_backlinks: r.backlinks ?? 0,
    referring_domains: r.referring_domains ?? 0,
    rank: r.rank ?? 0,
    broken_backlinks: r.broken_backlinks ?? 0,
    fetched_at: new Date().toISOString(),
  }
}

// ─── P8.10.S2.1: SERP rankings per target keyword ────────────────────────────

export interface SerpRanking {
  keyword: string
  position: number | null   // null = not in top 100
  url: string | null
  fetched_at: string
}

// DataForSEO location_code: 2554 = Australia, 2554 + 2540 supported. NZ = 2554? No: NZ = 2540.
const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }

export async function getSerpRankings(
  domain: string,
  keywords: string[],
  db: string = 'au',
): Promise<SerpRanking[]> {
  if (keywords.length === 0) return []
  const { login, password } = getCredentials()
  const credentials = Buffer.from(`${login}:${password}`).toString('base64')
  const location_code = LOCATION_CODE_BY_DB[db] ?? LOCATION_CODE_BY_DB.au

  const body = keywords.map(keyword => ({
    keyword,
    location_code,
    language_code: 'en',
    depth: 100,
  }))

  const res = await fetch(`${DATAFORSEO_API_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`DataForSEO SERP error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      data?: { keyword?: string }
      result?: Array<{
        keyword?: string
        items?: Array<{
          type?: string
          rank_absolute?: number
          domain?: string
          url?: string
        }>
      }>
    }>
  }

  const fetched_at = new Date().toISOString()
  const normalisedDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()

  return (json.tasks ?? []).map(task => {
    const keyword = task.data?.keyword ?? task.result?.[0]?.keyword ?? ''
    const items = task.result?.[0]?.items ?? []
    const hit = items.find(it =>
      it.type === 'organic' &&
      (it.domain ?? '').toLowerCase().includes(normalisedDomain),
    )
    return {
      keyword,
      position: hit?.rank_absolute ?? null,
      url: hit?.url ?? null,
      fetched_at,
    }
  })
}
