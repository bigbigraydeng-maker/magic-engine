'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CrawlButton, type JobStatus } from '../_components/CrawlButton'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageType = 'blog' | 'product' | 'service' | 'landing' | 'about' | 'contact' | 'other'
type FilterType = PageType | 'all'

interface ClientSitePage {
  id: string
  url: string
  title: string | null
  page_type: PageType
  word_count: number | null
  has_geo_block: boolean
  status_code: number | null
  crawled_at: string | null
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
  const [offset, setOffset] = useState(0)
  const [pages, setPages] = useState<ClientSitePage[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<PageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [currentJobStatus, setCurrentJobStatus] = useState<JobStatus | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

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
          setOffset(0)
          setRefreshKey(k => k + 1)
        }
      } catch { /* ignore */ }
    }

    const timer = setInterval(poll, 3000)
    return () => clearInterval(timer)
  }, [clientId, currentJobId, currentJobStatus])

  // Fetch aggregated stats once on mount
  useEffect(() => {
    fetch(`/api/clients/${clientId}/site-audit/pages/stats`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStats(data) })
      .catch(() => {})
  }, [clientId])

  // Fetch pages whenever filter or page changes
  const fetchPages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(offset),
        sort: 'crawled_at',
        order: 'desc',
      })
      if (selectedType !== 'all') qs.set('pageType', selectedType)

      const res = await fetch(`/api/clients/${clientId}/site-audit/pages?${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: PagesResponse = await res.json()
      setPages(data.pages ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId, selectedType, offset, refreshKey])

  useEffect(() => { fetchPages() }, [fetchPages])

  const handleTypeChange = (type: FilterType) => {
    setSelectedType(type)
    setOffset(0)
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
              label="Blog 页"
              value={stats.byType.blog ?? 0}
              sub={`Product: ${stats.byType.product ?? 0}`}
            />
          </div>
        )}

        {/* Type filter tabs */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex flex-wrap gap-2 mb-0">
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
              {selectedType === 'all' ? '暂无采集数据' : `暂无 ${TYPE_LABELS[selectedType]} 类型页面`}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">URL / 标题</th>
                  <th className="text-left px-4 py-3 font-medium w-28">类型</th>
                  <th className="text-right px-4 py-3 font-medium w-20">字数</th>
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
                      {page.word_count != null ? page.word_count.toLocaleString() : '—'}
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
