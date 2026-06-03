'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { buildGapKeywordBlogRequest } from '@/lib/blog/request-builders'
import {
  buildBrandTrafficSplit,
  prioritizeContentKeywords,
  sortByIntentPriority,
  type BrandTrafficSplit,
  type ContentPriorityKeyword,
} from '@/lib/seo-intelligence/intent-strategy'

// ─── Shared types ────────────────────────────────────────────────────────────

interface SeoMetrics {
  organic_keywords: number | null
  organic_traffic:  number | null
  authority_score:  number | null
  published_posts:  number | null
  gsc_clicks?:      number | null
  gsc_impressions?: number | null
  ga4_sessions?:    number | null
  ga4_users?:       number | null
  last_updated:     string | null
}

interface PageHealthRow {
  page:            string
  gsc_clicks:      number | null
  gsc_impressions: number | null
  gsc_ctr:         number | null
  gsc_position:    number | null
  ga4_sessions:    number | null
  ga4_pageviews:   number | null
}

interface PageHealthResponse {
  pages?:      PageHealthRow[]
  gsc_status?: 'connected' | 'no_data' | 'not_connected'
  ga4_status?: 'connected' | 'no_data' | 'not_connected'
  gsc_period?: string | null
  ga4_period?: string | null
  error?:      string
}

interface RankedKeyword {
  keyword:            string
  position:           number | null
  search_volume:      number | null
  keyword_difficulty: number | null
  cpc:                number | null
  competition:        number | null
  intent:             string
  gsc_position?:      number | null
  gsc_impressions?:   number | null
  gsc_clicks?:        number | null
  gsc_ctr?:           number | null
}

interface Competitor {
  domain:          string
  avg_position:    number | null
  intersections:   number
  monthly_traffic: number | null
  keyword_count:   number | null
}

interface GapKeyword {
  keyword:            string
  search_volume:      number | null
  keyword_difficulty: number | null
  cpc:                number | null
  intent:             string
  from_competitor?:   string | null
}

interface RankingsResponse {
  domain?: string
  keywords?: RankedKeyword[]
  source?: 'live' | 'snapshot'
  snapshot_date?: string | null
  gsc_status?: 'connected' | 'no_data' | 'not_connected'
  gsc_period?: string | null
  warning?: string
  error?: string
}

interface BlogGenerationResponse {
  success: boolean
  action?: 'new' | 'upgrade'
  post?: { id: string; cost_usd?: number | null } | null
  audit?: { reason?: string } | null
  error?: string
  cost_usd?: number | null
}

type PositionChangeType = 'new' | 'lost' | 'improved' | 'declined'

interface PositionChange {
  keyword: string
  change_type: PositionChangeType
  previous_position: number | null
  current_position: number | null
  position_delta: number | null
  search_volume: number | null
  keyword_difficulty: number | null
  intent: string | null
}

interface PositionChangesResponse {
  current_date: string | null
  previous_date: string | null
  summary: Record<PositionChangeType, number>
  changes: PositionChange[]
  error?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null, decimals = 0): string {
  if (v == null) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${(v / 1_000).toFixed(decimals > 0 ? decimals : 1)}K`
  return v.toFixed(decimals)
}

function domainRoot(domain: string): string {
  return domain.replace(/^www\./, '').split('.')[0].toLowerCase()
}

type Intent = 'transactional' | 'commercial' | 'informational' | 'navigational'

const INTENT_STYLE: Record<string, { bg: string; label: string }> = {
  transactional: { bg: 'bg-green-100 text-green-700',  label: 'Transactional' },
  commercial:    { bg: 'bg-blue-100 text-blue-700',    label: 'Commercial'    },
  informational: { bg: 'bg-purple-100 text-purple-700', label: 'Informational' },
  navigational:  { bg: 'bg-gray-100 text-gray-600',    label: 'Navigational'  },
}

function posLabel(p: number | null): string {
  if (p == null) return '—'
  return String(p)
}

function posBadgeCls(p: number | null): string {
  if (p == null) return 'bg-gray-100 text-gray-400'
  if (p <= 3)   return 'bg-green-100 text-green-700'
  if (p <= 10)  return 'bg-blue-100 text-blue-700'
  if (p <= 50)  return 'bg-yellow-100 text-yellow-700'
  return 'bg-gray-100 text-gray-500'
}

function kdCls(kd: number | null): string {
  if (kd == null) return 'text-gray-400'
  if (kd <= 30)  return 'text-green-600 font-medium'
  if (kd <= 60)  return 'text-yellow-600 font-medium'
  return 'text-red-600 font-medium'
}

const CHANGE_META: Record<PositionChangeType, { label: string; cls: string }> = {
  new:      { label: 'New',      cls: 'bg-green-50 text-green-700 border-green-200' },
  improved: { label: 'Improved', cls: 'bg-blue-50 text-blue-700 border-blue-200'   },
  declined: { label: 'Declined', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  lost:     { label: 'Lost',     cls: 'bg-red-50 text-red-700 border-red-200'      },
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, trend,
}: {
  icon: string; label: string; value: string; sub?: string; trend?: 'up' | 'down' | 'neutral'
}) {
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : null
  const trendCls  = trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : ''
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-gray-400 text-xs">
        <span>{icon}</span><span>{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
        {trendIcon && <span className={`text-sm font-semibold mb-0.5 ${trendCls}`}>{trendIcon}</span>}
      </div>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

// ─── Venn diagram (SVG, no external lib) ────────────────────────────────────

function VennDiagram({
  clientOnly,
  shared,
  gapCount,
}: {
  clientOnly: number
  shared:     number
  gapCount:   number
}) {
  return (
    <svg viewBox="0 0 420 160" className="w-full max-w-md mx-auto my-2" role="img" aria-label="关键词重叠 Venn 图">
      <circle cx="150" cy="80" r="78" fill="#dbeafe" fillOpacity="0.75" stroke="#93c5fd" strokeWidth="2" />
      <circle cx="270" cy="80" r="78" fill="#fed7aa" fillOpacity="0.75" stroke="#fdba74" strokeWidth="2" />
      {/* Client-only label */}
      <text x="95"  y="72"  textAnchor="middle" fill="#1e40af" fontSize="22" fontWeight="bold">{clientOnly}</text>
      <text x="95"  y="91"  textAnchor="middle" fill="#3b82f6" fontSize="11">你独有</text>
      {/* Shared label (intersection zone) */}
      <text x="210" y="72"  textAnchor="middle" fill="#374151" fontSize="18" fontWeight="bold">{shared}</text>
      <text x="210" y="91"  textAnchor="middle" fill="#6b7280" fontSize="10">共同词</text>
      {/* Gap label */}
      <text x="326" y="72"  textAnchor="middle" fill="#c2410c" fontSize="22" fontWeight="bold">{gapCount}</text>
      <text x="326" y="91"  textAnchor="middle" fill="#ea580c" fontSize="11">竞品缺口</text>
    </svg>
  )
}

// ─── Competitor card ─────────────────────────────────────────────────────────

function CompetitorCard({ comp, rank }: { comp: Competitor; rank: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex-shrink-0 w-52">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold text-gray-400">#{rank}</span>
        <span className="text-xs font-semibold text-gray-800 truncate">{comp.domain}</span>
      </div>
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">月均流量</span>
          <span className="font-medium text-gray-700">{fmt(comp.monthly_traffic)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">关键词数</span>
          <span className="font-medium text-gray-700">{fmt(comp.keyword_count, 0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">均排名</span>
          <span className="font-medium text-gray-700">{comp.avg_position != null ? comp.avg_position.toFixed(1) : '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">共同词</span>
          <span className="font-medium text-indigo-600">{comp.intersections}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Gap keywords table ───────────────────────────────────────────────────────

function GapTable({
  keywords,
  onGenerateBlog,
  generatingKeyword,
}: {
  keywords: GapKeyword[]
  onGenerateBlog: (keyword: GapKeyword) => void
  generatingKeyword: string | null
}) {
  const [search, setSearch] = useState('')
  const [intentFilter, setIntentFilter] = useState('all')
  const [shown, setShown] = useState(50)

  const filtered = useMemo(() =>
    keywords.filter(kw => {
      if (intentFilter !== 'all' && kw.intent !== intentFilter) return false
      if (search && !kw.keyword.toLowerCase().includes(search.toLowerCase())) return false
      return true
    }),
    [keywords, intentFilter, search],
  )
  const prioritized = useMemo(() => sortByIntentPriority(filtered, ''), [filtered])
  const page = prioritized.slice(0, shown)

  return (
    <div className="space-y-3 mt-4">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="搜索缺口词…"
          value={search}
          onChange={e => { setSearch(e.target.value); setShown(50) }}
          className="flex-1 min-w-[160px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
        />
        <select
          value={intentFilter}
          onChange={e => { setIntentFilter(e.target.value); setShown(50) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-indigo-400"
        >
          <option value="all">全部意图</option>
          <option value="transactional">Transactional</option>
          <option value="commercial">Commercial</option>
          <option value="informational">Informational</option>
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">缺口关键词</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">月搜量</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">KD</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">意图</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-36">来源竞品</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">生成</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {page.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-sm text-gray-400">没有符合条件的缺口词</td></tr>
            ) : page.map((kw, i) => {
              const style = INTENT_STYLE[kw.intent] ?? INTENT_STYLE.informational
              const isGenerating = generatingKeyword === kw.keyword
              return (
                <tr key={i} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-gray-900 max-w-xs truncate">{kw.keyword}</td>
                  <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">{fmt(kw.search_volume)}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${kdCls(kw.keyword_difficulty)}`}>{kw.keyword_difficulty ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${style.bg}`}>{style.label}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 truncate max-w-[9rem]">{kw.from_competitor ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onGenerateBlog(kw)}
                      disabled={!!generatingKeyword}
                      className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:bg-indigo-300 transition-colors"
                    >
                      {isGenerating ? '生成中…' : '生成博客'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {shown < filtered.length && (
        <div className="text-center">
          <button onClick={() => setShown(s => s + 50)} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            再显示 {Math.min(50, filtered.length - shown)} 条（共 {filtered.length} 条）
          </button>
        </div>
      )}
      {page.length > 0 && (
        <p className="text-center text-xs text-gray-400">
          显示 {page.length} / {filtered.length} 条{filtered.length < keywords.length && `（已筛选，总计 ${keywords.length} 条）`}
        </p>
      )}
    </div>
  )
}

// ─── Intent distribution bar ──────────────────────────────────────────────────

function IntentDistribution({ keywords }: { keywords: RankedKeyword[] }) {
  const counts = useMemo(() => {
    const tally: Record<string, number> = {}
    for (const kw of keywords) {
      tally[kw.intent] = (tally[kw.intent] ?? 0) + 1
    }
    return tally
  }, [keywords])

  const total   = keywords.length
  const intents = ['transactional', 'commercial', 'informational', 'navigational'] as Intent[]

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {intents.map(intent => {
        const count = counts[intent] ?? 0
        if (count === 0) return null
        const pct   = total > 0 ? Math.round((count / total) * 100) : 0
        const style = INTENT_STYLE[intent]
        return (
          <span
            key={intent}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${style.bg}`}
            style={{ borderColor: 'currentColor', opacity: 0.9 }}
          >
            {style.label}
            <span className="tabular-nums">{count}</span>
            <span className="opacity-60">({pct}%)</span>
          </span>
        )
      })}
    </div>
  )
}

// ─── Rankings table ───────────────────────────────────────────────────────────

const PAGE_SIZE = 50

function PositionChangesPanel({
  data,
  loading,
  error,
}: {
  data: PositionChangesResponse | null
  loading: boolean
  error: string | null
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
        <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-white rounded-lg border border-gray-100 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Position Changes failed to load: {error}
      </div>
    )
  }

  if (!data?.previous_date) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        Position Changes will appear after two weekly keyword snapshots are available.
      </div>
    )
  }

  const visibleChanges = data.changes.slice(0, 8)
  const dateRange = `${data.previous_date} -> ${data.current_date ?? 'latest'}`

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Position Changes</h3>
          <p className="text-xs text-gray-400">{dateRange}</p>
        </div>
        <span className="text-xs text-gray-500">{data.changes.length} movement{data.changes.length === 1 ? '' : 's'}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(['new', 'improved', 'declined', 'lost'] as PositionChangeType[]).map(type => {
          const meta = CHANGE_META[type]
          return (
            <div key={type} className={`rounded-lg border bg-white px-3 py-2 ${meta.cls}`}>
              <p className="text-xs font-medium opacity-80">{meta.label}</p>
              <p className="text-2xl font-bold tabular-nums">{data.summary[type]}</p>
            </div>
          )
        })}
      </div>

      {visibleChanges.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white border-b border-gray-100">
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Keyword</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Change</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Before</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Now</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">Move</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleChanges.map(change => {
                const meta = CHANGE_META[change.change_type]
                const delta = change.position_delta
                const deltaLabel = delta == null ? '-' : `${delta > 0 ? '+' : ''}${delta}`
                return (
                  <tr key={`${change.change_type}-${change.keyword}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900 max-w-xs truncate">{change.keyword}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-gray-600">{posLabel(change.previous_position)}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-gray-900">{posLabel(change.current_position)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${delta != null && delta < 0 ? 'text-amber-600' : 'text-green-600'}`}>
                      {deltaLabel}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No ranking movement between the latest two snapshots.</p>
      )}
    </div>
  )
}

function IntentStrategyPanel({
  split,
  priorities,
}: {
  split: BrandTrafficSplit
  priorities: ContentPriorityKeyword[]
}) {
  const totalEstimatedTraffic = split.branded.estimated_traffic + split.non_branded.estimated_traffic
  return (
    <div className="border-y border-gray-100 py-4 space-y-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Branded vs Non-Branded Traffic</h3>
              <p className="text-xs text-gray-400">Estimated from ranking position and monthly volume</p>
            </div>
            <span className="text-xs font-semibold text-gray-500 tabular-nums">{fmt(totalEstimatedTraffic)}</span>
          </div>
          <TrafficSplitRow label="Branded" bucket={split.branded} tone="brand" />
          <TrafficSplitRow label="Non-Branded" bucket={split.non_branded} tone="growth" />
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Intent Priority Content</h3>
            <p className="text-xs text-gray-400">Transactional terms stay first, then commercial opportunities</p>
          </div>
          {priorities.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {priorities.slice(0, 5).map(item => {
                const style = INTENT_STYLE[item.intent] ?? INTENT_STYLE.informational
                return (
                  <div key={item.keyword} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{item.keyword}</p>
                      <p className="text-xs text-gray-400">
                        Pos {posLabel(item.position ?? null)} · Vol {fmt(item.search_volume)} · Est. traffic {fmt(item.estimated_traffic)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${style.bg}`}>{style.label}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No non-branded content opportunities in the current ranking set.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function TrafficSplitRow({
  label,
  bucket,
  tone,
}: {
  label: string
  bucket: BrandTrafficSplit['branded']
  tone: 'brand' | 'growth'
}) {
  const barCls = tone === 'brand' ? 'bg-indigo-500' : 'bg-emerald-500'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-gray-600">{label}</span>
        <span className="text-gray-400">
          {bucket.share}% · {bucket.keywords} kw · {fmt(bucket.search_volume)} vol
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${barCls}`} style={{ width: `${bucket.share}%` }} />
      </div>
    </div>
  )
}

// ─── Page Health Table (Phase B2) ────────────────────────────────────────────

function PageHealthTable({
  pages,
  loading,
  gscStatus,
  ga4Status,
}: {
  pages: PageHealthRow[]
  loading: boolean
  gscStatus: 'connected' | 'no_data' | 'not_connected'
  ga4Status: 'connected' | 'no_data' | 'not_connected'
}) {
  const [search, setSearch] = useState('')
  const [shown, setShown]   = useState(25)

  const filtered = useMemo(() =>
    pages.filter(p => !search || p.page.toLowerCase().includes(search.toLowerCase())),
    [pages, search],
  )
  const visible = filtered.slice(0, shown)

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (gscStatus === 'not_connected' && ga4Status === 'not_connected') {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        Search Console 和 Analytics 均未连接。连接后此处显示页面级 GSC 点击 / 曝光 + GA4 会话数据。
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        已连接但暂无页面数据，可能在采集中（通常 48–72 小时）。
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="搜索页面路径…"
        value={search}
        onChange={e => { setSearch(e.target.value); setShown(25) }}
        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
      />
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left  px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">页面</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-teal-600 uppercase tracking-wide w-20">GSC 点击</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-teal-600 uppercase tracking-wide w-20">GSC 曝光</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-teal-600 uppercase tracking-wide w-16">CTR</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-teal-600 uppercase tracking-wide w-20">均排名</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-blue-600 uppercase tracking-wide w-20">GA4 会话</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-blue-600 uppercase tracking-wide w-20">GA4 PV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visible.map((p, i) => (
              <tr key={i} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5 text-gray-900 font-medium max-w-md truncate" title={p.page}>{p.page}</td>
                <td className="px-3 py-2.5 text-right text-teal-700 tabular-nums">{p.gsc_clicks != null ? fmt(p.gsc_clicks) : '—'}</td>
                <td className="px-3 py-2.5 text-right text-teal-700 tabular-nums">{p.gsc_impressions != null ? fmt(p.gsc_impressions) : '—'}</td>
                <td className="px-3 py-2.5 text-right text-teal-700 tabular-nums">{p.gsc_ctr != null ? `${(p.gsc_ctr * 100).toFixed(1)}%` : '—'}</td>
                <td className="px-3 py-2.5 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold tabular-nums ${posBadgeCls(p.gsc_position != null ? Math.round(p.gsc_position) : null)}`}>
                    {p.gsc_position != null ? p.gsc_position.toFixed(1) : '—'}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right text-blue-700 tabular-nums">{p.ga4_sessions != null ? fmt(p.ga4_sessions) : '—'}</td>
                <td className="px-3 py-2.5 text-right text-blue-700 tabular-nums">{p.ga4_pageviews != null ? fmt(p.ga4_pageviews) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown < filtered.length && (
        <div className="text-center">
          <button onClick={() => setShown(s => s + 25)} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
            再显示 {Math.min(25, filtered.length - shown)} 条（共 {filtered.length} 条）
          </button>
        </div>
      )}
      {visible.length > 0 && (
        <p className="text-center text-xs text-gray-400">
          显示 {visible.length} / {filtered.length} 条
        </p>
      )}
    </div>
  )
}

function RankingsTable({
  keywords,
  brandRoot,
  gscStatus,
  gscPeriod,
}: {
  keywords: RankedKeyword[]
  brandRoot: string
  gscStatus: 'connected' | 'no_data' | 'not_connected'
  gscPeriod: string | null
}) {
  const hasGsc = gscStatus === 'connected'
  const [intentFilter, setIntentFilter] = useState('all')
  const [posFilter,    setPosFilter]    = useState('all')
  const [brandFilter,  setBrandFilter]  = useState('all')
  const [search,       setSearch]       = useState('')
  const [shown,        setShown]        = useState(PAGE_SIZE)

  const filtered = useMemo(() => {
    return keywords.filter(kw => {
      if (intentFilter !== 'all' && kw.intent !== intentFilter) return false

      if (posFilter !== 'all') {
        const p = kw.position ?? 999
        if (posFilter === '1-3'   && !(p >= 1  && p <= 3))  return false
        if (posFilter === '4-10'  && !(p >= 4  && p <= 10)) return false
        if (posFilter === '11-50' && !(p >= 11 && p <= 50)) return false
        if (posFilter === '51+'   && !(p > 50))             return false
      }

      if (brandFilter !== 'all') {
        const isBranded = kw.keyword.toLowerCase().includes(brandRoot)
        if (brandFilter === 'branded'     &&  !isBranded) return false
        if (brandFilter === 'non-branded' &&   isBranded) return false
      }

      if (search && !kw.keyword.toLowerCase().includes(search.toLowerCase())) return false

      return true
    })
  }, [keywords, intentFilter, posFilter, brandFilter, search, brandRoot])

  const trafficSplit = useMemo(
    () => buildBrandTrafficSplit(keywords, brandRoot),
    [keywords, brandRoot],
  )
  const contentPriorities = useMemo(
    () => prioritizeContentKeywords(keywords, brandRoot, 5),
    [keywords, brandRoot],
  )
  const prioritized = useMemo(
    () => sortByIntentPriority(filtered, brandRoot),
    [filtered, brandRoot],
  )
  const page = prioritized.slice(0, shown)

  return (
    <div className="space-y-3">
      <IntentDistribution keywords={keywords} />
      <IntentStrategyPanel split={trafficSplit} priorities={contentPriorities} />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="搜索关键词…"
          value={search}
          onChange={e => { setSearch(e.target.value); setShown(PAGE_SIZE) }}
          className="flex-1 min-w-[180px] border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400"
        />
        <select
          value={intentFilter}
          onChange={e => { setIntentFilter(e.target.value); setShown(PAGE_SIZE) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-indigo-400"
        >
          <option value="all">全部意图</option>
          <option value="transactional">Transactional</option>
          <option value="commercial">Commercial</option>
          <option value="informational">Informational</option>
          <option value="navigational">Navigational</option>
        </select>
        <select
          value={posFilter}
          onChange={e => { setPosFilter(e.target.value); setShown(PAGE_SIZE) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-indigo-400"
        >
          <option value="all">全部排名</option>
          <option value="1-3">前 3 名</option>
          <option value="4-10">4–10 名</option>
          <option value="11-50">11–50 名</option>
          <option value="51+">51 名以后</option>
        </select>
        <select
          value={brandFilter}
          onChange={e => { setBrandFilter(e.target.value); setShown(PAGE_SIZE) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-indigo-400"
        >
          <option value="all">品牌+非品牌</option>
          <option value="branded">品牌词</option>
          <option value="non-branded">非品牌词</option>
        </select>
      </div>

      {/* GSC status banner */}
      {gscStatus === 'not_connected' && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
          Search Console 未连接 — GSC 列不可用。连接后可看到 Google 真实曝光/点击数据。
        </div>
      )}
      {gscStatus === 'no_data' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
          Search Console 已连接，数据采集中（通常需要 48–72 小时）。
        </div>
      )}
      {gscStatus === 'connected' && (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-xs text-teal-700 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-teal-500" />
          <span>Search Console 已连接{gscPeriod ? ` (${gscPeriod})` : ''}</span>
          <span className="text-teal-600/70">— 未匹配 GSC 数据的关键词显示「—」（GSC 仅返回 top 50 高点击词）</span>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">关键词</th>
              <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-16" title="DataForSEO estimated rank">DF 排名</th>
              {hasGsc && <th className="text-center px-3 py-2.5 text-xs font-semibold text-teal-600 uppercase tracking-wide w-16" title={gscPeriod ? `GSC ${gscPeriod}` : 'GSC real position'}>GSC 排名</th>}
              {hasGsc && <th className="text-right px-3 py-2.5 text-xs font-semibold text-teal-600 uppercase tracking-wide w-20" title="GSC impressions">曝光</th>}
              {hasGsc && <th className="text-right px-3 py-2.5 text-xs font-semibold text-teal-600 uppercase tracking-wide w-16" title="GSC clicks">点击</th>}
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">月搜量</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">KD</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide w-32">意图</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {page.length === 0 ? (
              <tr>
                <td colSpan={hasGsc ? 8 : 5} className="text-center py-8 text-sm text-gray-400">
                  没有符合条件的关键词
                </td>
              </tr>
            ) : (
              page.map((kw, i) => {
                const intentStyle = INTENT_STYLE[kw.intent] ?? INTENT_STYLE.informational
                return (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 text-gray-900 font-medium max-w-xs truncate">
                      {kw.keyword}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold tabular-nums ${posBadgeCls(kw.position)}`}>
                        {posLabel(kw.position)}
                      </span>
                    </td>
                    {hasGsc && (
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold tabular-nums ${posBadgeCls(kw.gsc_position != null ? Math.round(kw.gsc_position) : null)}`}>
                          {kw.gsc_position != null ? kw.gsc_position.toFixed(1) : '—'}
                        </span>
                      </td>
                    )}
                    {hasGsc && (
                      <td className="px-3 py-2.5 text-right text-teal-700 tabular-nums">
                        {kw.gsc_impressions != null ? fmt(kw.gsc_impressions) : '—'}
                      </td>
                    )}
                    {hasGsc && (
                      <td className="px-3 py-2.5 text-right text-teal-700 tabular-nums">
                        {kw.gsc_clicks != null ? fmt(kw.gsc_clicks) : '—'}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">
                      {fmt(kw.search_volume)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${kdCls(kw.keyword_difficulty)}`}>
                      {kw.keyword_difficulty ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${intentStyle.bg}`}>
                        {intentStyle.label}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {shown < filtered.length && (
        <div className="text-center">
          <button
            onClick={() => setShown(s => s + PAGE_SIZE)}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            再显示 {Math.min(PAGE_SIZE, filtered.length - shown)} 条（共 {filtered.length} 条）
          </button>
        </div>
      )}
      {page.length > 0 && (
        <p className="text-center text-xs text-gray-400">
          显示 {page.length} / {filtered.length} 条
          {filtered.length < keywords.length && `（已筛选，总计 ${keywords.length} 条）`}
        </p>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SeoIntelligencePage() {
  const { id: clientId } = useParams() as { id: string }
  const router = useRouter()

  // Top metrics
  const [metrics, setMetrics] = useState<SeoMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  // Rankings (Panel A)
  const [rankings,        setRankings]        = useState<RankedKeyword[]>([])
  const [rankingsDomain,  setRankingsDomain]  = useState('')
  const [rankingsLoading, setRankingsLoading] = useState(true)
  const [rankingsError,   setRankingsError]   = useState<string | null>(null)
  const [rankingsWarning, setRankingsWarning] = useState<string | null>(null)
  const [gscStatus,       setGscStatus]       = useState<'connected' | 'no_data' | 'not_connected'>('not_connected')
  const [gscPeriod,       setGscPeriod]       = useState<string | null>(null)
  const [positionChanges, setPositionChanges] = useState<PositionChangesResponse | null>(null)
  const [positionLoading, setPositionLoading] = useState(true)
  const [positionError,   setPositionError]   = useState<string | null>(null)

  // Competitors + gap keywords (Panel B)
  const [competitors,  setCompetitors]  = useState<Competitor[]>([])
  const [gapKeywords,  setGapKeywords]  = useState<GapKeyword[]>([])
  const [compLoading,  setCompLoading]  = useState(true)
  const [compError,    setCompError]    = useState<string | null>(null)
  const [generatingKeyword, setGeneratingKeyword] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const [actionOk, setActionOk] = useState<boolean | null>(null)

  // Page health (Phase B2)
  const [pageHealth,        setPageHealth]        = useState<PageHealthRow[]>([])
  const [pageHealthLoading, setPageHealthLoading] = useState(true)
  const [pageHealthGsc,     setPageHealthGsc]     = useState<'connected' | 'no_data' | 'not_connected'>('not_connected')
  const [pageHealthGa4,     setPageHealthGa4]     = useState<'connected' | 'no_data' | 'not_connected'>('not_connected')

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/seo-intelligence/metrics`)
        const data = await res.json() as SeoMetrics & { error?: string }
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        setMetrics(data)
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [clientId])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/seo-intelligence/rankings`)
        const data = await res.json() as RankingsResponse
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        setRankings(data.keywords ?? [])
        setRankingsDomain(data.domain ?? '')
        setRankingsWarning(data.warning ?? null)
        setGscStatus(data.gsc_status ?? 'not_connected')
        setGscPeriod(data.gsc_period ?? null)
      } catch (e) {
        setRankingsError(e instanceof Error ? e.message : 'Keyword Intelligence data failed to load')
      } finally {
        setRankingsLoading(false)
      }
    })()
  }, [clientId])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/seo-intelligence/position-changes`)
        const data = await res.json() as PositionChangesResponse
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        setPositionChanges(data)
      } catch (e) {
        setPositionError(e instanceof Error ? e.message : 'Position change data failed to load')
      } finally {
        setPositionLoading(false)
      }
    })()
  }, [clientId])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/seo-intelligence/competitors-gap`)
        const data = await res.json() as { competitors?: Competitor[]; gapKeywords?: GapKeyword[]; error?: string }
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        setCompetitors(data.competitors ?? [])
        setGapKeywords(data.gapKeywords ?? [])
      } catch (e) {
        setCompError(e instanceof Error ? e.message : 'Competitor data failed to load')
      } finally {
        setCompLoading(false)
      }
    })()
  }, [clientId])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/seo-intelligence/page-health`)
        const data = await res.json() as PageHealthResponse
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
        setPageHealth(data.pages ?? [])
        setPageHealthGsc(data.gsc_status ?? 'not_connected')
        setPageHealthGa4(data.ga4_status ?? 'not_connected')
      } catch {
        // Page health is best-effort; silent fail
      } finally {
        setPageHealthLoading(false)
      }
    })()
  }, [clientId])

  const flash = (msg: string, ok: boolean) => {
    setActionMsg(msg)
    setActionOk(ok)
    setTimeout(() => { setActionMsg(''); setActionOk(null) }, 7000)
  }

  const handleGenerateGapBlog = async (keyword: GapKeyword) => {
    setGeneratingKeyword(keyword.keyword)
    flash('正在生成博客草稿…', true)
    try {
      const res = await fetch(`/api/clients/${clientId}/blog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGapKeywordBlogRequest(keyword)),
      })
      const data = await res.json() as BlogGenerationResponse
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Generation failed')

      if (data.action === 'upgrade') {
        flash(data.audit?.reason ?? '已有内容可升级，未新建博客。', false)
        return
      }

      flash(`博客草稿已生成${data.cost_usd != null ? ` ($${data.cost_usd.toFixed(4)})` : ''}`, true)
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Generation failed', false)
    } finally {
      setGeneratingKeyword(null)
    }
  }

  const lastUpdatedLabel = metrics?.last_updated
    ? new Date(metrics.last_updated).toLocaleDateString('zh-CN', {
        timeZone: 'Pacific/Auckland',
        year: 'numeric', month: 'short', day: 'numeric',
      })
    : null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              ← 返回
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-base font-semibold text-gray-900">SEO Intelligence</h1>
          </div>
          {lastUpdatedLabel && (
            <p className="text-xs text-gray-400">数据更新：{lastUpdatedLabel}</p>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {actionMsg && (
          <div className={`border rounded-lg px-4 py-3 text-sm ${
            actionOk ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            {actionMsg}
          </div>
        )}

        {/* ── 顶部指标栏 ─────────────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            SEO 域名快照
          </p>
          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-20 bg-white rounded-xl border border-gray-200 animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">市场视角 (DataForSEO)</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <StatCard icon="🔑" label="收录关键词" value={fmt(metrics?.organic_keywords ?? null)} sub="自然搜索关键词总数" />
                <StatCard icon="📈" label="估算流量"   value={fmt(metrics?.organic_traffic  ?? null)} sub="估算月自然访量" />
                <StatCard icon="⭐" label="权威分"     value={metrics?.authority_score != null ? String(Math.round(metrics.authority_score)) : '—'} sub="0–100，越高越强" />
                <StatCard icon="📝" label="已发布博客" value={fmt(metrics?.published_posts  ?? null, 0)} sub="ME 内已发布文章数" />
              </div>
              <p className="text-[10px] text-teal-600 uppercase tracking-wider mb-2">真实视角 (Search Console + Analytics)</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard icon="🎯" label="GSC 点击"   value={fmt(metrics?.gsc_clicks      ?? null)} sub="Google 真实点击数" />
                <StatCard icon="👁" label="GSC 曝光"   value={fmt(metrics?.gsc_impressions ?? null)} sub="Google 搜索结果露出" />
                <StatCard icon="👥" label="GA4 会话"   value={fmt(metrics?.ga4_sessions    ?? null)} sub="网站访问会话" />
                <StatCard icon="🧑" label="GA4 用户"   value={fmt(metrics?.ga4_users       ?? null)} sub="独立访问用户" />
              </div>
            </>
          )}
          {!loading && !error && metrics?.last_updated == null && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              尚无 SEO 指标快照。周 Cron 任务将自动拉取数据，或联系 FDE 手动触发一次 Keyword Intelligence 同步。
            </div>
          )}
        </section>

        {/* ── Panel A 「了解自己」 ─────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            了解自己
          </p>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">
                Organic Rankings — 关键词排名表
              </h2>
              {rankingsDomain && (
                <span className="text-xs text-gray-400 font-mono">{rankingsDomain}</span>
              )}
            </div>

            {rankingsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : rankingsError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {rankingsError}
              </div>
            ) : rankings.length === 0 ? (
              <div className="space-y-4">
                {rankingsWarning && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                    {rankingsWarning}
                  </div>
                )}
                <PositionChangesPanel
                  data={positionChanges}
                  loading={positionLoading}
                  error={positionError}
                />
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                  No ranking data yet. Keyword Intelligence has not detected organic ranking terms for this domain, or the latest weekly snapshot has not been written.
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {rankingsWarning && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                    {rankingsWarning}
                  </div>
                )}
                <PositionChangesPanel
                  data={positionChanges}
                  loading={positionLoading}
                  error={positionError}
                />
                <RankingsTable
                  keywords={rankings}
                  brandRoot={domainRoot(rankingsDomain)}
                  gscStatus={gscStatus}
                  gscPeriod={gscPeriod}
                />
              </div>
            )}
          </div>
        </section>

        {/* ── 页面健康 (Phase B2) ─────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            页面健康
          </p>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Top Pages — GSC × GA4 合并视图</h2>
              <div className="flex gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full ${pageHealthGsc === 'connected' ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-500'}`}>
                  GSC {pageHealthGsc === 'connected' ? '✓' : '—'}
                </span>
                <span className={`px-2 py-0.5 rounded-full ${pageHealthGa4 === 'connected' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  GA4 {pageHealthGa4 === 'connected' ? '✓' : '—'}
                </span>
              </div>
            </div>
            <PageHealthTable
              pages={pageHealth}
              loading={pageHealthLoading}
              gscStatus={pageHealthGsc}
              ga4Status={pageHealthGa4}
            />
          </div>
        </section>

        {/* ── Panel B 「了解对手」 ─────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            了解对手
          </p>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">竞品对比 + 关键词缺口</h2>
              <Link
                href={`/dashboard/clients/${clientId}/settings`}
                className="text-xs text-cyan-700 hover:text-cyan-900 hover:underline"
              >
                竞品看错？去设置配置 →
              </Link>
            </div>

            {compLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : compError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{compError}</div>
            ) : competitors.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                Keyword Intelligence 未检测到该域名的有机竞品，可能域名流量较低或尚未被收录。
              </div>
            ) : (
              <>
                {/* Competitor cards */}
                <div className="flex gap-3 overflow-x-auto pb-2 mb-5">
                  {competitors.map((comp, i) => (
                    <CompetitorCard key={comp.domain} comp={comp} rank={i + 1} />
                  ))}
                </div>

                {/* Venn diagram */}
                {competitors[0] && (
                  <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 mb-5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide text-center mb-1">
                      关键词重叠分析（vs #{competitors[0].domain}）
                    </p>
                    <VennDiagram
                      clientOnly={Math.max(0, (metrics?.organic_keywords ?? competitors[0].intersections) - competitors[0].intersections)}
                      shared={competitors[0].intersections}
                      gapCount={gapKeywords.length}
                    />
                    <p className="text-center text-xs text-gray-400 mt-1">
                      缺口词 = 竞品排名但你尚未覆盖的关键词（共 {gapKeywords.length} 条，取前 100）
                    </p>
                  </div>
                )}

                {/* Gap keywords table */}
                {gapKeywords.length > 0 ? (
                  <GapTable
                    keywords={gapKeywords}
                    onGenerateBlog={handleGenerateGapBlog}
                    generatingKeyword={generatingKeyword}
                  />
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
                    未找到明显关键词缺口，你的覆盖已相当全面。
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── SEO Gap 快捷入口 ───────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            工具
          </p>
          <Link
            href={`/dashboard/clients/${clientId}/seo-gap`}
            className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-sm p-4 transition-all group"
          >
            <span className="text-2xl">📊</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">SEO Gap 分析</p>
              <p className="text-xs text-gray-400 mt-0.5">对比竞品，找出高机会关键词缺口</p>
            </div>
            <span className="text-gray-300 group-hover:text-indigo-400 transition-colors">→</span>
          </Link>
        </section>
      </div>
    </div>
  )
}
