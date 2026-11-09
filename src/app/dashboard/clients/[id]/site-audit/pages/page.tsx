'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CrawlButton, type JobStatus } from '../_components/CrawlButton'
import { INDEX_CLASS_META, type IndexClass } from '@/lib/seo/index-status'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageType = 'blog' | 'product' | 'service' | 'landing' | 'about' | 'contact' | 'other'
type FilterType = PageType | 'all'
/** Orthogonal to page type: filter by whether Google has indexed the page. */
type IndexFilter = 'all' | 'not-indexed'
interface ClientSitePage {
  id: string
  url: string
  title: string | null
  page_type: PageType
  word_count: number | null
  has_geo_block: boolean
  status_code: number | null
  crawled_at: string | null
  index_verdict: string | null
  first_not_indexed_at: string | null
  not_indexed: boolean
  index_class: IndexClass | null
  crawl_status: string | null
}

interface PagesResponse {
  pages: ClientSitePage[]
  total: number
  limit: number
  offset: number
}

interface PageStats {
  total: number
  byType: Record<PageType, number>
  geoCoverage: { withBlock: number; withoutBlock: number; percent: number }
  avgWordCount: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIMIT = 50

const TYPE_LABELS: Record<FilterType, string> = {
  all: '全部',
  blog: 'Blog',
  product: 'Product',
  service: 'Service',
  landing: 'Landing',
  about: 'About',
  contact: 'Contact',
  other: 'Other',
}

const TYPE_COLORS: Record<PageType, string> = {
  blog:    'bg-blue-100 text-blue-700',
  product: 'bg-purple-100 text-purple-700',
  service: 'bg-orange-100 text-orange-700',
  landing: 'bg-green-100 text-green-700',
  about:   'bg-gray-100 text-gray-700',
  contact: 'bg-yellow-100 text-yellow-700',
  other:   'bg-slate-100 text-slate-600',
}

// Per-class badge colour for the 收录状态 column. Wording (label / hint /
// action) comes from seo/index-status INDEX_CLASS_META — the same text the
// 今日待办 not_indexed item uses, so FDE sees one vocabulary everywhere.
const INDEX_CLASS_COLORS: Record<IndexClass, string> = {
  error:         'bg-red-100 text-red-700',
  noindex:       'bg-red-100 text-red-700',
  unknown:       'bg-orange-100 text-orange-700',
  thin:          'bg-amber-100 text-amber-700',
  duplicate:     'bg-amber-100 text-amber-700',
  crawled:       'bg-yellow-100 text-yellow-700',
  discovered:    'bg-sky-100 text-sky-700',
  not_a_problem: 'bg-gray-100 text-gray-500',
  no_verdict:    'bg-gray-100 text-gray-500',
  other:         'bg-slate-100 text-slate-600',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function TypeBadge({ type }: { type: PageType }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[type]}`}>
      {TYPE_LABELS[type]}
    </span>
  )
}

function GeoIcon({ hasGeo }: { hasGeo: boolean }) {
  return hasGeo
    ? <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">✓ 已部署</span>
    : <span className="text-gray-300 text-xs">—</span>
}

/**
 * 收录状态列：未收录页面显示谷歌给的原因（人话）+ 简短动作，悬停看完整说明。已收录 / 未检查各一态。
 * 三态判据与后端一致：not_indexed（first_not_indexed_at 非空）优先，其次看
 * index_verdict 有没有验过。
 */
function IndexStatusCell({ page }: { page: ClientSitePage }) {
  if (page.not_indexed && page.index_class) {
    const cls = page.index_class
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${INDEX_CLASS_COLORS[cls]}`}
          title={`${page.index_verdict ?? ''}${page.index_verdict ? ' — ' : ''}${INDEX_CLASS_META[cls].action}`}
        >
          {INDEX_CLASS_META[cls].label}
        </span>
        <span className="text-xs text-gray-400">{INDEX_CLASS_META[cls].hint}</span>
      </div>
    )
  }
  // 「已收录」只凭 index_verdict 有值 —— 依赖后端不变量：not_indexed 权威看
  // first_not_indexed_at，index_verdict 仅作「验过了」的标记。轮检(index-check.ts)
  // 保证两者同批写入，故走到这里必是真·已收录。
  if (page.index_verdict) {
    return <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">✓ 已收录</span>
  }
  return <span className="text-gray-300 text-xs" title="还没做过收录检查">未检查</span>
}

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-2 mt-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-10 bg-gray-100 rounded" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function SiteAuditPagesPage() {
  const params = useParams()
  const clientId = params.id as string
  const router = useRouter()

  const [selectedType, setSelectedType] = useState<FilterType>('all')
  const [indexFilter, setIndexFilter] = useState<IndexFilter>('all')
  const [offset, setOffset] = useState(0)
  const [pages, setPages] = useState<ClientSitePage[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<PageStats | null>(null)
  const [notIndexedCount, setNotIndexedCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [currentJobStatus, setCurrentJobStatus] = useState<JobStatus | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // Guards against out-of-order fetchPages responses (see fetchPages below):
  // when the deep-link effect flips indexFilter right after mount, the
  // 'all' request from the initial render can resolve after the
  // 'not-indexed' request and must not clobber it.
  const latestRequestId = useRef(0)

  // Deep-link from 今日待办 not_indexed 汇总项: ?filter=not-indexed opens straight
  // to the未收录 view. Read after mount (not in useState init) to avoid a
  // hydration mismatch — the effect runs client-only, post-hydration.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('filter') === 'not-indexed') {
      setIndexFilter('not-indexed')
    }
  }, [])

  // Fetch latest job status on mount
  useEffect(() => {
    fetch(`/api/clients/${clientId}/site-audit/status`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { job?: { id: string; status: JobStatus } | null } | null) => {
        if (data?.job) {
          setCurrentJobId(data.job.id)
          setCurrentJobStatus(data.job.status)
        }
      })
      .catch(() => {})
  }, [clientId])

  // How many pages Google hasn't indexed — powers the「未收录」pill count,
  // independent of the current view. Cheap: limit=1, we only read `total`.
  const fetchNotIndexedCount = useCallback(() => {
    fetch(`/api/clients/${clientId}/site-audit/pages?indexStatus=not-indexed&limit=1`)
      .then(r => r.ok ? r.json() : null)
      .then((d: PagesResponse | null) => { if (d) setNotIndexedCount(d.total ?? 0) })
      .catch(() => {})
  }, [clientId])

  useEffect(() => { fetchNotIndexedCount() }, [fetchNotIndexedCount])

  // Poll job status while active
  useEffect(() => {
    if (!currentJobId) return
    if (currentJobStatus === 'completed' || currentJobStatus === 'failed') return

    const poll = async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/site-audit/status?jobId=${currentJobId}`)
        if (!res.ok) return
        const data = await res.json() as { job?: { id: string; status: JobStatus } | null }
        if (data?.job) setCurrentJobStatus(data.job.status)
        if (data?.job?.status === 'completed') {
          // Refresh stats and page table after crawl completes
          fetch(`/api/clients/${clientId}/site-audit/pages/stats`)
            .then(r => r.ok ? r.json() : null)
            .then(s => { if (s) setStats(s) })
            .catch(() => {})
          fetchNotIndexedCount()
          setOffset(0)
          setRefreshKey(k => k + 1)
        }
      } catch { /* ignore */ }
    }

    const timer = setInterval(poll, 3000)
    return () => clearInterval(timer)
  }, [clientId, currentJobId, currentJobStatus, fetchNotIndexedCount])

  // Fetch aggregated stats once on mount
  useEffect(() => {
    fetch(`/api/clients/${clientId}/site-audit/pages/stats`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStats(data) })
      .catch(() => {})
  }, [clientId])

  // Fetch pages whenever filter or page changes
  const fetchPages = useCallback(async () => {
    const requestId = ++latestRequestId.current
    setLoading(true)
    setError(null)
    try {
      const notIndexed = indexFilter === 'not-indexed'
      const qs = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(offset),
        // In未收录 view, oldest-not-indexed first = most urgent to fix.
        sort: notIndexed ? 'first_not_indexed_at' : 'crawled_at',
        order: notIndexed ? 'asc' : 'desc',
      })
      if (selectedType !== 'all') qs.set('pageType', selectedType)
      if (notIndexed) qs.set('indexStatus', 'not-indexed')

      const res = await fetch(`/api/clients/${clientId}/site-audit/pages?${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: PagesResponse = await res.json()
      // A newer request may have started (and finished) while this one was
      // in flight — e.g. the deep-link effect flips indexFilter right after
      // the initial 'all' fetch starts. Drop stale responses so they can't
      // clobber a more recent, still-relevant result.
      if (requestId !== latestRequestId.current) return
      setPages(data.pages ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      if (requestId !== latestRequestId.current) return
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      if (requestId === latestRequestId.current) setLoading(false)
    }
  }, [clientId, selectedType, indexFilter, offset, refreshKey])

  useEffect(() => { fetchPages() }, [fetchPages])

  const handleTypeChange = (type: FilterType) => {
    setSelectedType(type)
    setOffset(0)
  }

  const handleIndexFilterChange = (f: IndexFilter) => {
    setIndexFilter(f)
    setOffset(0)
    // Keep the URL in sync so refresh/copy-link/tab-restore doesn't silently
    // re-apply a filter the user just switched away from (see mount effect above).
    const url = new URL(window.location.href)
    if (f === 'not-indexed') {
      url.searchParams.set('filter', 'not-indexed')
    } else {
      url.searchParams.delete('filter')
    }
    window.history.replaceState(null, '', url)
  }

  const totalPages = Math.ceil(total / LIMIT)
  const currentPage = Math.floor(offset / LIMIT) + 1

  const typeTabCounts: Partial<Record<FilterType, number>> = stats
    ? { all: stats.total, ...stats.byType }
    : {}

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              ← 返回
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-base font-semibold text-gray-900">页面清单</h1>
          </div>
          <div className="flex items-center gap-3">
            {stats && (
              <p className="text-xs text-gray-400">共 {stats.total} 条记录</p>
            )}
            <CrawlButton
              clientId={clientId}
              currentJobStatus={currentJobStatus}
              onJobStarted={(jobId) => {
                setCurrentJobId(jobId)
                setCurrentJobStatus('pending')
              }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="总页数" value={stats.total} />
            <StatCard
              label="GEO 覆盖率"
              value={`${stats.geoCoverage.percent}%`}
              sub={`${stats.geoCoverage.withBlock} / ${stats.total} 页`}
            />
            <StatCard label="平均字数" value={Math.round(stats.avgWordCount)} />
            <StatCard
              label="未被谷歌收录"
              value={notIndexedCount ?? '—'}
              sub={notIndexedCount ? '点下方「未收录」查看' : '暂无'}
            />
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          {/* Index-status filter (收录状态) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-400 mr-1">收录状态</span>
            {([
              { key: 'all' as const,        label: '全部' },
              { key: 'not-indexed' as const, label: '未收录' },
            ]).map(({ key, label }) => {
              const count = key === 'not-indexed' ? notIndexedCount ?? undefined : undefined
              const active = indexFilter === key
              return (
                <button
                  key={key}
                  onClick={() => handleIndexFilterChange(key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-rose-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                  {count !== undefined && <span className="ml-1 opacity-75">({count})</span>}
                </button>
              )
            })}
          </div>

          {/* Type filter tabs */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-400 mr-1">类型</span>
            {(Object.keys(TYPE_LABELS) as FilterType[]).map(type => {
              const count = typeTabCounts[type]
              return (
                <button
                  key={type}
                  onClick={() => handleTypeChange(type)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    selectedType === type
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {TYPE_LABELS[type]}
                  {count !== undefined && (
                    <span className="ml-1 opacity-75">({count})</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {error ? (
            <div className="p-6 text-center text-sm text-red-600">{error}</div>
          ) : loading ? (
            <div className="p-6"><TableSkeleton /></div>
          ) : pages.length === 0 ? (
            <div className="p-12 text-center text-sm text-gray-400">
              {indexFilter === 'not-indexed'
                ? selectedType === 'all'
                  ? '没有未被谷歌收录的页面 🎉'
                  : `没有未被谷歌收录的 ${TYPE_LABELS[selectedType]} 类型页面（其他类型可能仍有未收录页面）`
                : selectedType === 'all' ? '暂无采集数据' : `暂无 ${TYPE_LABELS[selectedType]} 类型页面`}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">URL / 标题</th>
                  <th className="text-left px-4 py-3 font-medium w-28">类型</th>
                  <th className="text-right px-4 py-3 font-medium w-20">字数</th>
                  <th className="text-left px-4 py-3 font-medium w-40">收录状态</th>
                  <th className="text-center px-4 py-3 font-medium w-24">GEO Block</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pages.map(page => (
                  <tr key={page.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-indigo-600 hover:underline block truncate max-w-xs sm:max-w-sm lg:max-w-xl"
                        title={page.url}
                      >
                        {page.title || page.url}
                      </a>
                      {page.title && (
                        <span className="text-xs text-gray-400 truncate block max-w-xs sm:max-w-sm lg:max-w-xl" title={page.url}>
                          {page.url}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadge type={page.page_type} />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {page.crawl_status === 'antibot_challenged' ? (
                        <span
                          className="text-xs text-amber-600"
                          title="我们读这一页时被网站防火墙挡住，读到的是拦截页，字数不可信"
                        >
                          被防火墙挡住
                        </span>
                      ) : page.word_count != null ? (
                        page.word_count.toLocaleString()
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <IndexStatusCell page={page} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <GeoIcon hasGeo={page.has_geo_block} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-gray-500">
            <span>
              第 {currentPage} / {totalPages} 页（共 {total} 条）
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + LIMIT >= total}
                className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
