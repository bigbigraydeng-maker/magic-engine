/**
 * Client-facing weekly browsing summary — pure parts (no supabase, no provider calls).
 *
 * Inputs come from the GSC / GA4 connectors and the leads table (see gather.ts).
 * Everything here is deterministic so it can be unit tested without network.
 *
 * Platform rule: no client names or client business numbers live in this file.
 * Brand terms, labels and language come in through the input (client configuration).
 */

export interface GscWindowTotals {
  clicks: number
  impressions: number
  /** Impression-weighted average position as returned by Search Analytics. */
  position: number
}

export interface GscQueryRow {
  query: string
  clicks: number
  impressions: number
  position: number
}

export interface GscPageRow {
  page: string
  clicks: number
  impressions: number
  position: number
}

export interface Ga4PageViewRow {
  page: string
  pageviews: number
}

export interface WeeklyReportInput {
  clientLabel: string
  /** Inclusive ISO dates (YYYY-MM-DD) of the reported GSC window and the one before it. */
  window: { start: string; end: string }
  previousWindow: { start: string; end: string }
  /** null = the source could not be read (never rendered as zero). */
  gsc: {
    current: GscWindowTotals
    previous: GscWindowTotals
    queries: GscQueryRow[]
    pages: GscPageRow[]
  } | null
  ga4: {
    periodStart: string
    periodEnd: string
    totalPageviews: number
    totalSessions: number
    totalUsers: number
    pages: Ga4PageViewRow[]
  } | null
  /** null = leads could not be read. */
  leadsInWindow: number | null
  /** Client-configured brand terms, e.g. trading names. Matched loosely. */
  brandTerms: string[]
  /** Free-text bullet lines of what changed on the site this week (supplied by the operator). */
  siteUpdates: string[]
  /** Free-text next steps / things we need from the client. */
  nextSteps: string[]
}

export interface BrandSplit {
  brandClicks: number
  brandImpressions: number
  otherClicks: number
  otherImpressions: number
}

export interface WeeklySummary {
  input: WeeklyReportInput
  brand: BrandSplit | null
  topPages: Array<{ page: string; pageviews: number }>
  notes: string[]
}

/** Lowercase, strip non-alphanumerics, drop one trailing "s" so "park homes" ≈ "park home". */
function normalizeTerm(s: string): string {
  const flat = s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return flat.endsWith('s') ? flat.slice(0, -1) : flat
}

/** Shorter normalized terms match too many unrelated queries (substring match across word boundaries). */
const MIN_BRAND_TERM_LENGTH = 6

function usableBrandTerms(terms: readonly string[]): string[] {
  return terms.filter((t) => normalizeTerm(t).length >= MIN_BRAND_TERM_LENGTH)
}

export function isBrandQuery(query: string, brandTerms: readonly string[]): boolean {
  const q = normalizeTerm(query)
  if (q.length === 0) return false
  return brandTerms.some((t) => {
    const n = normalizeTerm(t)
    return n.length >= MIN_BRAND_TERM_LENGTH && q.includes(n)
  })
}

export function splitBrand(queries: readonly GscQueryRow[], brandTerms: readonly string[]): BrandSplit {
  const out: BrandSplit = { brandClicks: 0, brandImpressions: 0, otherClicks: 0, otherImpressions: 0 }
  for (const r of queries) {
    if (isBrandQuery(r.query, brandTerms)) {
      out.brandClicks += r.clicks
      out.brandImpressions += r.impressions
    } else {
      out.otherClicks += r.clicks
      out.otherImpressions += r.impressions
    }
  }
  return out
}

/** Week-over-week change as a rounded integer percent, or null when the base is zero. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

function pagePath(url: string): string {
  try {
    const p = new URL(url).pathname
    return p === '' ? '/' : p
  } catch {
    return url
  }
}

export function buildWeeklySummary(input: WeeklyReportInput): WeeklySummary {
  const notes: string[] = []
  if (input.gsc === null) notes.push('搜索后台数据本周没有读到，下面的搜索部分未列出，不代表为 0。')
  if (input.ga4 === null) notes.push('流量统计数据本周没有读到，下面的浏览部分未列出，不代表为 0。')
  if (input.leadsInWindow === null) notes.push('咨询记录本周没有读到，咨询数未列出，不代表为 0。')

  // Brand split is only meaningful on the queries Google returned (top rows, not the full tail).
  // No usable brand term configured => no split at all (never a fabricated "brand clicks: 0").
  const hasBrandTerms = usableBrandTerms(input.brandTerms).length > 0
  const brand = input.gsc && hasBrandTerms ? splitBrand(input.gsc.queries, input.brandTerms) : null
  if (input.gsc && input.gsc.queries.length > 0 && brand) {
    notes.push('谷歌不公开搜索量很小的搜索词，所以品牌和其他搜索的点击相加，会少于上面的总点击数。')
  }

  const topPages = (input.ga4?.pages ?? [])
    .slice()
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, 5)
    .map((p) => ({ page: pagePath(p.page), pageviews: p.pageviews }))

  return { input, brand, topPages, notes }
}

function delta(current: number, previous: number): string {
  const pct = pctChange(current, previous)
  if (pct === null) return previous === 0 && current > 0 ? '（上周为 0）' : ''
  if (pct === 0) return '（与上周持平）'
  return pct > 0 ? `（比上周多 ${pct}%）` : `（比上周少 ${Math.abs(pct)}%）`
}

/** Plain-text Chinese rendering (the client email body and the PM draft preview). */
export function renderWeeklyReportZh(s: WeeklySummary): string {
  const { input } = s
  const lines: string[] = []
  lines.push(`${input.clientLabel} 网站每周浏览总结`)
  lines.push(`统计周期：${input.window.start} 至 ${input.window.end}`)
  lines.push('')

  lines.push('一、搜索表现（谷歌搜索后台）')
  if (input.gsc) {
    const c = input.gsc.current
    const p = input.gsc.previous
    lines.push(`- 网站在谷歌搜索结果中出现 ${c.impressions} 次${delta(c.impressions, p.impressions)}`)
    lines.push(`- 被点击 ${c.clicks} 次${delta(c.clicks, p.clicks)}`)
    if (s.brand) {
      lines.push(`- 其中通过品牌名搜索的点击 ${s.brand.brandClicks} 次，通过其他词搜索的点击 ${s.brand.otherClicks} 次`)
    }
  } else {
    lines.push('- 本周没有读到搜索后台数据')
  }
  lines.push('')

  lines.push('二、网站浏览（网站流量统计）')
  if (input.ga4) {
    lines.push(`- 流量统计区间：${input.ga4.periodStart} 至 ${input.ga4.periodEnd}（与上面的搜索统计区间不完全相同，含当天尚未统计完的数据）`)
    lines.push(`- 页面浏览 ${input.ga4.totalPageviews} 次，访问 ${input.ga4.totalSessions} 次，访客 ${input.ga4.totalUsers} 人`)
    if (s.topPages.length > 0) {
      lines.push('- 浏览最多的页面：')
      for (const p of s.topPages) lines.push(`  ${p.page}　${p.pageviews} 次`)
    }
  } else {
    lines.push('- 本周没有读到流量统计数据')
  }
  lines.push('')

  lines.push('三、咨询')
  lines.push(
    input.leadsInWindow === null
      ? '- 本周没有读到咨询记录'
      : `- 本周网站收到 ${input.leadsInWindow} 条咨询`,
  )
  lines.push('')

  lines.push('四、本周网站更新')
  if (input.siteUpdates.length > 0) for (const u of input.siteUpdates) lines.push(`- ${u}`)
  else lines.push('- （待运营补充）')
  lines.push('')

  lines.push('五、下周计划与需要您提供的')
  if (input.nextSteps.length > 0) for (const n of input.nextSteps) lines.push(`- ${n}`)
  else lines.push('- （待运营补充）')

  if (s.notes.length > 0) {
    lines.push('')
    lines.push('说明')
    for (const n of s.notes) lines.push(`- ${n}`)
  }
  return lines.join('\n')
}
