// SEMrush API Client
// 封装 4 个核心工具，对内提供统一接口

import { validateEnvVar } from '@/lib/validation-utils'

const SEMRUSH_API_BASE = 'https://api.semrush.com'
const DEFAULT_DB = process.env.SEMRUSH_DB || 'au'
// SEMrush queries normally return in 1-3s. Anything past 20s is a hung
// connection — fail fast so the calling agent doesn't blow its wall-clock budget.
const SEMRUSH_FETCH_TIMEOUT_MS = 20_000

function semrushFetchInit(extra?: RequestInit): RequestInit {
  return { ...extra, signal: AbortSignal.timeout(SEMRUSH_FETCH_TIMEOUT_MS) }
}

/**
 * Retrieve the SEMrush API key at call time (not at module load time).
 * This ensures a clear error is thrown when the key is missing,
 * rather than silently passing `undefined` to the API.
 */
function getApiKey(): string {
  return validateEnvVar('SEMRUSH_API_KEY')
}

export interface SemrushKeywordData {
  keyword: string
  volume: number
  kd: number
  cpc: number
  intent: string
  trend: { month: string; volume: number }[]
  position?: number | null  // organic rank position (from Po export column)
}

// Tool 1: 批量关键词概览（最多100个）
export async function batchKeywordOverview(
  keywords: string[],
  db: string = DEFAULT_DB
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'phrase_these',
    key: getApiKey(),
    phrase: keywords.join(';'),
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In,Tr',
    display_limit: String(keywords.length),
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`, semrushFetchInit({
    next: { revalidate: 0 },
  }))

  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)

  const text = await res.text()
  return parseSemrushResponse(text)
}

// Tool 2: 相关关键词扩展
export async function getRelatedKeywords(
  seedKeyword: string,
  db: string = DEFAULT_DB,
  limit: number = 50
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'phrase_related',
    key: getApiKey(),
    phrase: seedKeyword,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In',
    display_limit: String(limit),
    display_sort: 'nq_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`, semrushFetchInit())
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

// Tool 3: 竞品域名有机关键词
export async function getDomainOrganicKeywords(
  domain: string,
  db: string = DEFAULT_DB,
  limit: number = 50
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'domain_organic',
    key: getApiKey(),
    domain,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In,Po',
    display_limit: String(limit),
    display_sort: 'nq_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`, semrushFetchInit())
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

// Tool 4: 关键词差距分析
export async function getKeywordGap(
  clientDomain: string,
  competitorDomains: string[],
  db: string = DEFAULT_DB,
  limit: number = 100
): Promise<SemrushKeywordData[]> {
  const domainParams = [clientDomain, ...competitorDomains]
    .map((d, i) => `domains[${i}][domain]=${d}&domains[${i}][type]=organic`)
    .join('&')

  const params = new URLSearchParams({
    type: 'phrase_kgap',
    key: getApiKey(),
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In',
    display_limit: String(limit),
    display_filter: `+|Ph|Co|${clientDomain}|missing`,
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}&${domainParams}`, semrushFetchInit())
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

function parseSemrushResponse(text: string): SemrushKeywordData[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []

  return lines.slice(1).map(line => {
    const cols = line.split(';')
    const posRaw = cols[5]?.trim()
    const position = posRaw && posRaw !== '' ? (parseInt(posRaw) || null) : null
    return {
      keyword: cols[0]?.trim() || '',
      volume: parseInt(cols[1]) || 0,
      kd: parseInt(cols[2]) || 0,
      cpc: parseFloat(cols[3]) || 0,
      intent: normalizeIntent(cols[4]?.trim()),
      trend: [],
      position,
    }
  }).filter(k => k.keyword.length > 0)
}

// Tool 5: Domain overview snapshot for Master Brief pipeline
export interface DomainOverviewSnapshot {
  top_keywords: SemrushKeywordData[]
  competitor_domains: string[]
  estimated_traffic?: number
}

export async function getDomainOverviewSnapshot(
  domain: string,
  db: string = DEFAULT_DB,
  keywordLimit = 20
): Promise<DomainOverviewSnapshot> {
  try {
    // Wrap in Promise.resolve() so synchronous throws (e.g. missing API key)
    // are captured by allSettled rather than propagating before the await.
    const [topKeywords, competitors] = await Promise.allSettled([
      Promise.resolve().then(() => getDomainOrganicKeywords(domain, db, keywordLimit)),
      Promise.resolve().then(() => getDomainCompetitors(domain, db)),
    ])

    return {
      top_keywords: topKeywords.status === 'fulfilled' ? topKeywords.value : [],
      competitor_domains: competitors.status === 'fulfilled' ? competitors.value : [],
    }
  } catch {
    // Non-fatal: return empty snapshot rather than blocking brief generation
    return { top_keywords: [], competitor_domains: [] }
  }
}

async function getDomainCompetitors(
  domain: string,
  db: string = DEFAULT_DB,
  limit = 5
): Promise<string[]> {
  const params = new URLSearchParams({
    type: 'domain_organic_organic',
    key: getApiKey(),
    domain,
    database: db,
    export_columns: 'Dn,Cr',
    display_limit: String(limit),
    display_sort: 'cr_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`, semrushFetchInit())
  if (!res.ok) return []

  const text = await res.text()
  const lines = text.trim().split('\n').slice(1)
  return lines
    .map(l => l.split(';')[0]?.trim())
    .filter((d): d is string => Boolean(d) && d !== domain)
    .slice(0, limit)
}

// Tool 6: 问题型关键词（FAQ / 教育内容选题）
export async function getQuestionKeywords(
  seedKeyword: string,
  db: string = DEFAULT_DB,
  limit: number = 30
): Promise<SemrushKeywordData[]> {
  const params = new URLSearchParams({
    type: 'phrase_questions',
    key: getApiKey(),
    phrase: seedKeyword,
    database: db,
    export_columns: 'Ph,Nq,Kd,Cp,In',
    display_limit: String(limit),
    display_sort: 'nq_desc',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`, semrushFetchInit())
  if (!res.ok) throw new Error(`SEMrush API error: ${res.status}`)
  return parseSemrushResponse(await res.text())
}

// Tool 7: 域名流量概览（SEO 健康度）
export interface DomainMetrics {
  organic_keywords: number
  organic_traffic: number
  authority_score: number
}

export async function getDomainMetrics(
  domain: string,
  db: string = DEFAULT_DB
): Promise<DomainMetrics> {
  const params = new URLSearchParams({
    type: 'domain_ranks',
    key: getApiKey(),
    domain,
    database: db,
    export_columns: 'Or,Ot,As',
  })

  const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`, semrushFetchInit())
  if (!res.ok) return { organic_keywords: 0, organic_traffic: 0, authority_score: 0 }

  const text = await res.text()
  const lines = text.trim().split('\n')
  if (lines.length < 2) return { organic_keywords: 0, organic_traffic: 0, authority_score: 0 }

  const cols = lines[1].split(';')
  return {
    organic_keywords: parseInt(cols[0]) || 0,
    organic_traffic:  parseInt(cols[1]) || 0,
    authority_score:  parseInt(cols[2]) || 0,
  }
}

// Tool 8: 域名历史流量趋势（华佗 Agent 使用，P8.10.S3.2）
export interface DomainTrendPoint {
  /** 'YYYY-MM' 格式 */
  month: string
  /** 当月有机关键词数 */
  organic_keywords: number
  /** 当月有机流量估算 */
  organic_traffic: number
}

/**
 * 拉取域名过去 N 个月的有机流量和关键词数趋势。
 * 用于华佗 Agent 把"过去实际增长率"作为 KPI target 的锚点。
 *
 * @param months 拉取月数（默认 12）。SEMrush 实际可拉 ~24 个月。
 * @returns 按时间升序排列（最早→最新）的趋势点；若域名无历史返回空数组。
 */
export async function getDomainTrafficTrend(
  domain: string,
  db: string = DEFAULT_DB,
  months: number = 12,
): Promise<DomainTrendPoint[]> {
  const params = new URLSearchParams({
    type: 'domain_rank_history',
    key: getApiKey(),
    domain,
    database: db,
    export_columns: 'Or,Ot,Dt',
    display_limit: String(Math.min(months, 24)),
    display_sort: 'dt_asc',
  })

  try {
    const res = await fetch(`${SEMRUSH_API_BASE}/?${params}`, semrushFetchInit())
    if (!res.ok) return []

    const text = await res.text()
    const lines = text.trim().split('\n')
    if (lines.length < 2) return []

    // Header: Or;Ot;Dt; data rows follow
    const points: DomainTrendPoint[] = []
    for (const line of lines.slice(1)) {
      const cols = line.split(';').map(c => c.trim())
      // Dt format: YYYYMMDD → take YYYY-MM
      const dt = cols[2]
      if (!dt || dt.length < 6) continue
      const month = `${dt.slice(0, 4)}-${dt.slice(4, 6)}`
      points.push({
        month,
        organic_keywords: parseInt(cols[0]) || 0,
        organic_traffic:  parseInt(cols[1]) || 0,
      })
    }
    return points
  } catch (err) {
    console.error('[semrush] getDomainTrafficTrend error', err)
    return []
  }
}

function normalizeIntent(raw?: string): string {
  const map: Record<string, string> = {
    '0': 'informational',
    '1': 'navigational',
    '2': 'commercial',
    '3': 'transactional',
    'informational': 'informational',
    'navigational': 'navigational',
    'commercial': 'commercial',
    'transactional': 'transactional',
  }
  return map[raw || ''] || 'informational'
}
