/**
 * Google Trends connector — via SerpAPI google_trends engine.
 *
 * Reference: ROADMAP.md P8.12.S1.5
 *
 * 给华佗一个"行业搜索热度趋势"锚点：客户所属行业关键词在过去 12 个月
 * 的 Google 搜索兴趣曲线（AU/NZ 地域），用于判断市场需求是涨是跌。
 *
 * Design mirrors src/lib/semrush/client.ts getDomainTrafficTrend：
 *  - API key 在调用时获取（缺失时抛清晰错误）。
 *  - 高层 wrapper getIndustryInterestTrend 非致命：任何失败都返回 no_data 摘要。
 */

import { validateEnvVar } from '@/lib/validation-utils'

const SERPAPI_BASE = 'https://serpapi.com/search.json'

export type GTrendsGeo = 'AU' | 'NZ'

/** 单个时间点的搜索兴趣（0–100，Google Trends 归一化值）。 */
export interface GTrendsPoint {
  /** ISO 日期（周起始日，YYYY-MM-DD） */
  date: string
  /** 搜索兴趣值 0–100 */
  value: number
}

export type GTrendsTrajectory = 'rising' | 'flat' | 'declining' | 'no_data'

export interface GTrendsInterestSummary {
  has_data: boolean
  /** 查询关键词 */
  query: string
  geo: GTrendsGeo
  /** 按时间升序的兴趣点 */
  points: GTrendsPoint[]
  /** 12 个月平均兴趣 */
  average: number | null
  /** 近 4 周均值 vs 前 4 周均值的百分比变化 */
  recent_shift_pct: number | null
  /** 趋势判定 */
  trajectory: GTrendsTrajectory
}

function getSerpApiKey(): string {
  return validateEnvVar('SERPAPI_API_KEY')
}

// raw SerpAPI shape (只取我们消费的字段)
interface SerpApiTrendsRaw {
  error?: string
  interest_over_time?: {
    timeline_data?: Array<{
      timestamp?: string
      values?: Array<{ extracted_value?: number }>
    }>
  }
}

/**
 * 拉取关键词在指定地域过去 12 个月的 Google 搜索兴趣曲线。
 * 抛错由调用方处理；高层 wrapper getIndustryInterestTrend 会兜底。
 */
export async function fetchInterestOverTime(
  query: string,
  geo: GTrendsGeo = 'AU',
): Promise<GTrendsPoint[]> {
  const params = new URLSearchParams({
    engine: 'google_trends',
    q: query,
    data_type: 'TIMESERIES',
    date: 'today 12-m',
    geo,
    api_key: getSerpApiKey(),
  })

  const res = await fetch(`${SERPAPI_BASE}?${params}`)
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`)

  const data = (await res.json()) as SerpApiTrendsRaw
  if (data.error) throw new Error(`SerpAPI error: ${data.error}`)

  const timeline = data.interest_over_time?.timeline_data ?? []
  const points: GTrendsPoint[] = []
  for (const row of timeline) {
    const ts = row.timestamp
    const raw = row.values?.[0]?.extracted_value
    if (!ts || typeof raw !== 'number') continue
    const iso = new Date(parseInt(ts) * 1000).toISOString().slice(0, 10)
    points.push({ date: iso, value: raw })
  }
  return points
}

/**
 * 把兴趣曲线折叠成摘要：平均值、近 4 周环比、趋势判定。
 */
export function summarizeInterest(
  query: string,
  geo: GTrendsGeo,
  points: GTrendsPoint[],
): GTrendsInterestSummary {
  if (points.length === 0) {
    return {
      has_data: false,
      query,
      geo,
      points: [],
      average: null,
      recent_shift_pct: null,
      trajectory: 'no_data',
    }
  }

  const total = points.reduce((sum, p) => sum + p.value, 0)
  const average = Math.round(total / points.length)
  const recentShift = computeRecentShift(points)

  const trajectory: GTrendsTrajectory =
    recentShift == null ? 'flat' :
    recentShift >= 10   ? 'rising' :
    recentShift <= -10  ? 'declining' :
                          'flat'

  return { has_data: true, query, geo, points, average, recent_shift_pct: recentShift, trajectory }
}

/** 近 4 周均值 vs 前 4 周均值的百分比变化。数据不足返回 null。 */
function computeRecentShift(points: GTrendsPoint[]): number | null {
  if (points.length < 8) return null
  const recent = points.slice(-4)
  const previous = points.slice(-8, -4)
  const recentAvg = recent.reduce((sum, p) => sum + p.value, 0) / 4
  const previousAvg = previous.reduce((sum, p) => sum + p.value, 0) / 4
  if (previousAvg <= 0) return null
  return Math.round(((recentAvg - previousAvg) / previousAvg) * 100)
}

/**
 * 高层非致命 wrapper：拉取并摘要行业关键词搜索兴趣。
 * 任何失败（缺 key、网络、SerpAPI 报错）都返回 no_data 摘要，绝不阻塞处方生成。
 */
export async function getIndustryInterestTrend(
  query: string,
  geo: GTrendsGeo = 'AU',
): Promise<GTrendsInterestSummary> {
  try {
    const points = await fetchInterestOverTime(query, geo)
    return summarizeInterest(query, geo, points)
  } catch (err) {
    console.error('[gtrends] getIndustryInterestTrend error', err)
    return summarizeInterest(query, geo, [])
  }
}

/**
 * 把搜索兴趣摘要格式化成 Claude prompt 中嵌入的中文段落。
 */
export function formatInterestForPrompt(summary: GTrendsInterestSummary): string {
  if (!summary.has_data) {
    return `## 行业搜索热度趋势（Google Trends）\n\n**无数据**（关键词「${summary.query}」在 ${summary.geo} 无足够搜索量）。市场需求趋势判断请依赖行业基准与季节日历。`
  }

  const trajectoryLabel: Record<GTrendsTrajectory, string> = {
    rising: '📈 上升',
    flat: '➡️ 平稳',
    declining: '📉 下降',
    no_data: '无数据',
  }

  const lines: string[] = [
    `## 行业搜索热度趋势（Google Trends，${summary.geo}，过去 12 个月）`,
    '',
    `**查询关键词**：${summary.query}`,
    `**12 个月平均兴趣**：${summary.average} / 100`,
    `**近 4 周环比**：${summary.recent_shift_pct != null ? summary.recent_shift_pct + '%' : '数据不足'}`,
    `**当前轨迹**：${trajectoryLabel[summary.trajectory]}`,
    '',
    '**重要约束**：',
    summary.trajectory === 'declining'
      ? '1. ⚠️ 行业搜索需求下降中——处方应包含"需求转化"动作（抓住现有流量、提高转化率），而非单纯追求曝光增长。'
      : summary.trajectory === 'rising'
        ? '1. 行业搜索需求上升中——处方可适度激进，把握需求红利窗口。'
        : '1. 行业搜索需求平稳——处方以稳健的份额争夺为主。',
    '2. Google Trends 是相对值（0–100），不能作为 KPI current_value；它只用于校准 target_value 的激进程度。',
  ]
  return lines.join('\n')
}
