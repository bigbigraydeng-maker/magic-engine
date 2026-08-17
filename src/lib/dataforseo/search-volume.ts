/**
 * Google Ads 搜索量 —— 单个接口同时给「月搜索量 + 12 个月历史 + CPC + 竞争度」。
 *
 * 端点：`keywords_data/google_ads/search_volume/live`
 *
 * 🔴 **别用 `labs.ts` 的 `bulkKeywordVolume`** —— 它打的
 *    `dataforseo_labs/google/bulk_keyword_search_volume/live` **返回 404，端点不存在**
 *    （2026-08-15 实测）。那个函数目前在 3 个生产路径里静默失败，已单独登记待修。
 *
 * 🔴 有了这里的 `monthly_searches`，判趋势**不需要 SerpAPI / Google Trends** ——
 *    别为了「拿趋势」再多引一个 provider 和一把钥匙。
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

/** 一个月的搜索量点。 */
export interface MonthlySearchPoint {
  year: number
  month: number
  searchVolume: number
}

export interface SearchVolumeResult {
  keyword: string
  /** 月均搜索量。null = 该市场无数据。 */
  searchVolume: number | null
  cpcUsd: number | null
  /** 付费竞争度 0–1（由 competition_index 0–100 折算）。 */
  competition: number | null
  /** 按时间**升序**的历史点（接口原始顺序是倒序，这里已翻正）。 */
  monthlySearches: readonly MonthlySearchPoint[]
}

function authHeader(): string {
  const login = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

interface RawVolumeItem {
  keyword?: string
  search_volume?: number | null
  cpc?: number | null
  competition_index?: number | null
  monthly_searches?: Array<{ year?: number; month?: number; search_volume?: number }>
}

function toPoints(raw: RawVolumeItem['monthly_searches']): MonthlySearchPoint[] {
  const points = (raw ?? [])
    .filter((p): p is { year: number; month: number; search_volume: number } =>
      typeof p.year === 'number' && typeof p.month === 'number'
      && typeof p.search_volume === 'number')
    .map((p) => ({ year: p.year, month: p.month, searchVolume: p.search_volume }))
  // 接口给的是最近月在前，翻成时间升序，后面算趋势才不会算反。
  return points.sort((a, b) => a.year - b.year || a.month - b.month)
}

/**
 * 查一批关键词在某个市场的搜索量。
 *
 * location_code：澳洲 2036 / 新西兰 2554（见 lib/dataforseo/client.ts）。
 * 抛错由调用方兜底 —— 这里不吞异常，因为「查不到」和「查错了」必须分得开。
 */
export async function getSearchVolume(
  keywords: readonly string[],
  locationCode: number,
  languageCode = 'en',
): Promise<SearchVolumeResult[]> {
  if (keywords.length === 0) return []

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/keywords_data/google_ads/search_volume/live`,
    {
      method: 'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        keywords: [...keywords],
        location_code: locationCode,
        language_code: languageCode,
      }]),
    },
  )
  if (!res.ok) throw new Error(`DataForSEO search_volume error: ${res.status}`)

  const json = await res.json() as { tasks?: Array<{ result?: RawVolumeItem[] }> }
  const items = json.tasks?.[0]?.result ?? []

  return items.map((item) => ({
    keyword: item.keyword ?? '',
    searchVolume: item.search_volume ?? null,
    cpcUsd: item.cpc ?? null,
    competition: typeof item.competition_index === 'number'
      ? item.competition_index / 100
      : null,
    monthlySearches: toPoints(item.monthly_searches),
  }))
}

export type SearchTrajectory = 'rising' | 'flat' | 'declining'

/**
 * 从历史点算轨迹：最近 3 个月均值 vs 前 3 个月均值，±10% 为界。
 *
 * 点数不足 6 个返回 null —— **数据不够就说不够，不许折中成 flat**。
 */
export function deriveTrajectory(
  points: readonly MonthlySearchPoint[],
): SearchTrajectory | null {
  if (points.length < 6) return null
  const avg = (xs: readonly MonthlySearchPoint[]): number =>
    xs.reduce((sum, p) => sum + p.searchVolume, 0) / xs.length

  const recent = avg(points.slice(-3))
  const previous = avg(points.slice(-6, -3))
  if (previous <= 0) return null

  const shiftPct = ((recent - previous) / previous) * 100
  if (shiftPct >= 10) return 'rising'
  if (shiftPct <= -10) return 'declining'
  return 'flat'
}
