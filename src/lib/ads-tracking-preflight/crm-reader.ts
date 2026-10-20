import type { SupabaseClient } from '@supabase/supabase-js'
import type { CrmFacts, LandingTarget } from './types'
import { retryOnce, type Sleep } from './retry'
import { sanitizeError } from './sanitize'

const SEVEN_DAYS_MS = 7 * 86_400_000
/** 一次最多读回多少条官网表单线索来按来源页分类（总数另用库里数出来的精确条数）。 */
const MAX_TOUCHPOINT_ROWS = 200

interface TouchpointRow {
  occurred_at?: unknown
  metadata?: unknown
}

// ─── 来源页分类：这条线索是不是从「广告落地页」提交的 ──────────────────────────────

/**
 * 页面路径规范化：只取路径（去掉域名、网址参数、#），小写，去结尾斜杠。
 * 认两种写法：以 / 开头的路径（官网表单通知里的 Form URL 就是这种），或完整的 http(s) 网址。
 * 其它一律 null（不猜）。
 */
export function normalizePagePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '') return null
  let pathname: string
  try {
    if (text.startsWith('/')) pathname = new URL(text, 'https://placeholder.invalid').pathname
    else if (/^https?:\/\//i.test(text)) pathname = new URL(text).pathname
    else return null
  } catch {
    return null
  }
  let path = pathname.toLowerCase()
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  return path
}

function uniquePaths(paths: readonly unknown[] | undefined): string[] {
  const out: string[] = []
  for (const raw of paths ?? []) {
    const path = normalizePagePath(raw)
    if (path !== null && !out.includes(path)) out.push(path)
  }
  return out
}

/** 从落地页配置得到「广告落地页」路径集合（规范化、去重；读不懂的网址跳过）。 */
export function adLandingPathsFromTargets(targets: readonly LandingTarget[]): string[] {
  return uniquePaths(targets.map(t => t.url))
}

/**
 * 近 7 天的官网表单线索里，哪些是从广告落地页提交的：线索的来源页（metadata.source_url，官网表单通知里的 Form URL）
 * 规范化后等于某个广告落地页路径才算；没有来源页 / 读不懂的不算。最近一条按时间取最大，不看传进来的顺序。
 */
export function classifyAdLandingForms(rows: unknown, paths: readonly string[]): { count: number; latest: string | null } {
  if (!Array.isArray(rows)) return { count: 0, latest: null }
  const wanted = new Set(paths)
  let count = 0
  let latest: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue
    const row = raw as TouchpointRow
    const metadata = typeof row.metadata === 'object' && row.metadata !== null ? (row.metadata as Record<string, unknown>) : null
    const path = normalizePagePath(metadata?.source_url)
    if (path === null || !wanted.has(path)) continue
    count += 1
    if (typeof row.occurred_at !== 'string') continue
    const ms = Date.parse(row.occurred_at)
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms
      latest = row.occurred_at
    }
  }
  return { count, latest }
}

interface TouchpointResult {
  data: unknown
  count: number | null
  error: { message: string } | null
}

function emptyFacts(error: string, asOf: string): CrmFacts {
  return {
    read: false,
    error,
    web_form_touchpoints_7d: 0,
    latest_web_form_at: null,
    as_of: asOf,
  }
}

/**
 * adLandingPaths：广告落地页的页面路径（给了就同时按来源页给线索分类；不给 / 空 = 不分类，和以前一样）。
 */
export async function readCrmFacts(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
  sleep?: Sleep,
  adLandingPaths?: readonly string[],
): Promise<{ facts: CrmFacts; errors: string[] }> {
  const asOf = now.toISOString()
  const sinceIso = new Date(now.getTime() - SEVEN_DAYS_MS).toISOString()
  const adPaths = uniquePaths(adLandingPaths)

  try {
    const { data, count, error } = await retryOnce<TouchpointResult>(
      async () => {
        const r = await supabase
          .from('contact_touchpoints')
          .select('occurred_at, metadata', { count: 'exact' })
          .eq('client_id', clientId)
          .eq('channel', 'web_form')
          .gte('occurred_at', sinceIso)
          .order('occurred_at', { ascending: false })
          .limit(MAX_TOUCHPOINT_ROWS)
        return {
          data: r.data,
          count: typeof r.count === 'number' ? r.count : null,
          error: r.error ? { message: r.error.message } : null,
        }
      },
      { sleep, retryResult: r => r.error !== null },
    )

    if (error) {
      const message = `CRM 读取失败：${sanitizeError(error.message)}`
      return { facts: emptyFacts(message, asOf), errors: [message] }
    }

    const rows: TouchpointRow[] = Array.isArray(data) ? (data as TouchpointRow[]) : []
    const total = typeof count === 'number' ? count : rows.length
    const latest = rows[0]?.occurred_at

    const facts: CrmFacts = {
      read: true,
      error: null,
      web_form_touchpoints_7d: total,
      latest_web_form_at: typeof latest === 'string' ? latest : null,
      as_of: asOf,
    }
    if (adPaths.length > 0) {
      const adLanding = classifyAdLandingForms(rows, adPaths)
      facts.ad_landing_paths = adPaths
      facts.ad_landing_form_touchpoints_7d = adLanding.count
      facts.latest_ad_landing_form_at = adLanding.latest
    }
    return { facts, errors: [] }
  } catch (err) {
    const message = `CRM 读取失败：${sanitizeError(err)}`
    return { facts: emptyFacts(message, asOf), errors: [message] }
  }
}
