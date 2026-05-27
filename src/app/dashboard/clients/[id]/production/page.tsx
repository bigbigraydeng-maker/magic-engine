'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiagnosticDimension = 'seo' | 'ai_visibility' | 'ads' | 'social' | 'reputation' | 'competitor'

type PackageStatus =
  | 'draft' | 'generating' | 'ready_for_review' | 'revision_requested'
  | 'approved' | 'scheduled' | 'published' | 'measured' | 'archived' | 'failed'

interface PackageSummary {
  id: string
  dimension: DiagnosticDimension
  title: string
  brief: string | null
  status: PackageStatus
  campaign_id: string | null
  execution_item_id: string | null
  item_count: number
  created_at: string
  updated_at: string
}

interface ListResponse {
  success: boolean
  packages: PackageSummary[]
  error?: string
}

interface CampaignOption {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_DIMENSIONS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
]

const DIMENSION_LABEL: Record<DiagnosticDimension, string> = {
  seo:           'SEO',
  ai_visibility: 'AI 可见度',
  ads:           '广告',
  social:        '社媒',
  reputation:    '口碑',
  competitor:    '竞品',
}

const DIMENSION_COLOR: Record<DiagnosticDimension, string> = {
  seo:           'bg-blue-100 text-blue-700 border-blue-200',
  ai_visibility: 'bg-purple-100 text-purple-700 border-purple-200',
  ads:           'bg-orange-100 text-orange-700 border-orange-200',
  social:        'bg-pink-100 text-pink-700 border-pink-200',
  reputation:    'bg-yellow-100 text-yellow-700 border-yellow-200',
  competitor:    'bg-gray-100 text-gray-700 border-gray-200',
}

const STATUS_META: Record<PackageStatus, { label: string; cls: string }> = {
  draft:              { label: '草稿',   cls: 'text-gray-500' },
  generating:         { label: '生成中', cls: 'text-blue-600 animate-pulse' },
  ready_for_review:   { label: '待审核', cls: 'text-yellow-600' },
  revision_requested: { label: '待修改', cls: 'text-orange-600' },
  approved:           { label: '已批准', cls: 'text-green-600' },
  scheduled:          { label: '已排期', cls: 'text-indigo-600' },
  published:          { label: '已发布', cls: 'text-green-700' },
  measured:           { label: '已归因', cls: 'text-teal-600' },
  archived:           { label: '已归档', cls: 'text-gray-400' },
  failed:             { label: '失败',   cls: 'text-red-600' },
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------

const DIMENSION_OPTIONS: { value: DiagnosticDimension; label: string }[] = [
  { value: 'seo',           label: 'SEO' },
  { value: 'ai_visibility', label: 'AI 可见度' },
  { value: 'ads',           label: '广告' },
  { value: 'social',        label: '社媒' },
  { value: 'reputation',    label: '口碑' },
  { value: 'competitor',    label: '竞品' },
]

interface CreatePackageModalProps {
  clientId: string
  onClose: () => void
  onCreated: (packageId: string) => void
}

function CreatePackageModal({ clientId, onClose, onCreated }: CreatePackageModalProps) {
  const [dimension,  setDimension]  = useState<DiagnosticDimension>('social')
  const [title,      setTitle]      = useState('')
  const [brief,      setBrief]      = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [campaigns,  setCampaigns]  = useState<CampaignOption[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  useEffect(() => {
    void fetch(`/api/clients/${clientId}/campaign`)
      .then(r => r.json())
      .then((json: { success?: boolean; campaigns?: { id: string; name: string }[] }) => {
        if (json.success && Array.isArray(json.campaigns)) {
          setCampaigns(json.campaigns.map(c => ({ id: c.id, name: c.name })))
        }
      })
      .catch(() => {/* non-critical */})
  }, [clientId])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) { setError('标题不能为空'); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/production`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dimension,
          title: title.trim(),
          brief: brief.trim() || undefined,
          campaign_id: campaignId || undefined,
        }),
      })
      const json = await res.json() as { success: boolean; package?: { id: string }; error?: string }
      if (!json.success || !json.package) {
        setError(json.error ?? '创建失败，请重试')
      } else {
        onCreated(json.package.id)
      }
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSubmitting(false)
    }
  }, [clientId, dimension, title, brief, campaignId, onCreated])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6 space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-900">新建生产包</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Dimension */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">维度</label>
            <div className="flex flex-wrap gap-2">
              {DIMENSION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDimension(opt.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    dimension === opt.value
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">标题 *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="例：CTS Tours 5月社媒批次"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              autoFocus
            />
          </div>

          {/* Brief */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">简报（可选）</label>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              placeholder="本批次的目标、主题或注意事项..."
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Campaign */}
          {campaigns.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">关联 Campaign（可选）</label>
              <select
                value={campaignId}
                onChange={e => setCampaignId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
              >
                <option value="">不关联</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PackageCard({ pkg, clientId }: { pkg: PackageSummary; clientId: string }) {
  const dimColor  = DIMENSION_COLOR[pkg.dimension] ?? 'bg-gray-100 text-gray-700 border-gray-200'
  const statusMeta = STATUS_META[pkg.status] ?? { label: pkg.status, cls: 'text-gray-500' }
  const createdAt = new Date(pkg.created_at).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <Link
      href={`/dashboard/clients/${clientId}/production/${pkg.id}`}
      className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${dimColor}`}>
              {DIMENSION_LABEL[pkg.dimension] ?? pkg.dimension}
            </span>
            <span className={`text-xs font-medium ${statusMeta.cls}`}>{statusMeta.label}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900 truncate">{pkg.title}</p>
          {pkg.brief && (
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{pkg.brief}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-gray-800">{pkg.item_count}</p>
          <p className="text-[10px] text-gray-400">产出物</p>
        </div>
      </div>
      <p className="text-[10px] text-gray-400 mt-2">{createdAt}</p>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ProductionPackageListPage() {
  const params   = useParams<{ id: string }>()
  const clientId = params.id
  const router   = useRouter()

  const [packages,   setPackages]   = useState<PackageSummary[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [dimFilter,  setDimFilter]  = useState<DiagnosticDimension | 'all'>('all')
  const [showModal,  setShowModal]  = useState(false)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const url = new URL(`/api/clients/${clientId}/production`, window.location.origin)
        if (dimFilter !== 'all') url.searchParams.set('dimension', dimFilter)
        const res  = await fetch(url.toString())
        const json = await res.json() as ListResponse
        if (!json.success) {
          setError(json.error ?? '加载失败')
        } else {
          setPackages(json.packages)
        }
      } catch {
        setError('网络错误，请重试')
      } finally {
        setLoading(false)
      }
    })()
  }, [clientId, dimFilter])

  // Group by dimension for display
  const grouped = packages.reduce<Partial<Record<DiagnosticDimension, PackageSummary[]>>>(
    (acc, pkg) => {
      if (!acc[pkg.dimension]) acc[pkg.dimension] = []
      acc[pkg.dimension]!.push(pkg)
      return acc
    },
    {}
  )

  const dimensionsWithData = ALL_DIMENSIONS.filter(d => (grouped[d]?.length ?? 0) > 0)

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <nav className="text-xs text-gray-400 flex items-center gap-1.5 mb-2">
            <Link href="/dashboard/clients" className="hover:text-gray-600">客户</Link>
            <span>/</span>
            <Link href={`/dashboard/clients/${clientId}`} className="hover:text-gray-600 truncate max-w-[120px]">{clientId.slice(0, 8)}…</Link>
            <span>/</span>
            <span className="text-gray-700 font-medium">生产包</span>
          </nav>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">生产包总览</h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                + 新建生产包
              </button>
              <Link
                href={`/dashboard/clients/${clientId}`}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                ← 返回
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Dimension filter tabs */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setDimFilter('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              dimFilter === 'all'
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            全部
          </button>
          {ALL_DIMENSIONS.map(d => (
            <button
              key={d}
              onClick={() => setDimFilter(d)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                dimFilter === d
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {DIMENSION_LABEL[d]}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-600 font-medium">{error}</p>
          </div>
        ) : packages.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-200 p-12 text-center text-gray-400">
            <p className="text-sm font-medium">暂无生产包</p>
            <p className="text-xs mt-1">批准一份 Marketing Plan 后，系统会按维度自动建立生产包；也可点击「新建生产包」手动建立临时批次。</p>
          </div>
        ) : dimFilter !== 'all' ? (
          // Single dimension — flat list
          <div className="grid gap-3 sm:grid-cols-2">
            {packages.map(pkg => (
              <PackageCard key={pkg.id} pkg={pkg} clientId={clientId} />
            ))}
          </div>
        ) : (
          // All — grouped by dimension
          <div className="space-y-8">
            {dimensionsWithData.map(dim => (
              <section key={dim}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${DIMENSION_COLOR[dim]}`}>
                    {DIMENSION_LABEL[dim]}
                  </span>
                  <span className="text-xs text-gray-400">{grouped[dim]!.length} 个包</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {grouped[dim]!.map(pkg => (
                    <PackageCard key={pkg.id} pkg={pkg} clientId={clientId} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

      </div>
    </div>

    {showModal && (
      <CreatePackageModal
        clientId={clientId}
        onClose={() => setShowModal(false)}
        onCreated={(packageId) => {
          setShowModal(false)
          router.push(`/dashboard/clients/${clientId}/production/${packageId}`)
        }}
      />
    )}
    </>
  )
}
