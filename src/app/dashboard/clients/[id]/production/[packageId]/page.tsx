'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { findSlots } from '@/lib/scheduling/slot-finder'
import type { SchedulingPlatform } from '@/lib/scheduling/slot-finder'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiagnosticDimension = 'seo' | 'ai_visibility' | 'ads' | 'social' | 'reputation' | 'competitor'

type PackageStatus =
  | 'draft' | 'generating' | 'ready_for_review' | 'revision_requested'
  | 'approved' | 'scheduled' | 'published' | 'measured' | 'archived' | 'failed'

type ItemStatus = 'pending' | 'generating' | 'ready' | 'failed' | 'archived'
type ContentType = 'content_post' | 'blog_post' | 'reel' | 'visual_asset'

interface ContentPost {
  id: string; title: string; caption: string | null; status: string
  platforms: string[] | null; scheduled_at: string | null; visual_brief: string | null
}
interface BlogPost {
  id: string; title: string; slug: string | null; status: string
  featured_image_url: string | null; word_count: number | null
}
interface ReelDraft { id: string; title: string; status: string }
interface VisualAsset { id: string; title: string; status: string; image_url: string | null }

type ContentPreview = ContentPost | BlogPost | ReelDraft | VisualAsset | null

interface ProductionItem {
  id: string; content_type: ContentType
  content_post_id: string | null; blog_post_id: string | null
  reel_id: string | null; visual_asset_id: string | null
  sort_order: number; status: ItemStatus; created_at: string
  content: ContentPreview
}

interface ProductionPackage {
  id: string; client_id: string; master_brief_id: string
  dimension: DiagnosticDimension
  campaign_id: string | null; diagnostic_run_id: string | null
  diagnostic_finding_id: string | null; prescription_id: string | null
  execution_item_id: string | null
  source_payload: Record<string, unknown>
  generation_context_snapshot: Record<string, unknown>
  title: string; brief: string | null; status: PackageStatus
  created_at: string; updated_at: string
}

interface CampaignMeta { id: string; name: string; theme: string | null; dimension: string | null }
interface ExecutionItemMeta { id: string; title: string; dimension: string; status: string; fix_type: string; phase: number }

interface PackageDetailResponse {
  success: boolean
  package: ProductionPackage
  campaign: CampaignMeta | null
  execution_item: ExecutionItemMeta | null
  items: ProductionItem[]
  error?: string
}

// Slot suggestion per content_post (one post = one platform)
interface PostScheduleEntry {
  post_id: string
  platform: SchedulingPlatform
  suggested_at: string | null  // null = user hasn't confirmed
  confirmed_at: string | null  // what user chose (may differ from suggested)
  title: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const PKG_STATUS_META: Record<PackageStatus, { label: string; cls: string }> = {
  draft:              { label: '草稿',     cls: 'bg-gray-100 text-gray-600' },
  generating:         { label: '生成中',   cls: 'bg-blue-100 text-blue-700 animate-pulse' },
  ready_for_review:   { label: '待审核',   cls: 'bg-yellow-100 text-yellow-700' },
  revision_requested: { label: '待修改',   cls: 'bg-orange-100 text-orange-700' },
  approved:           { label: '已批准',   cls: 'bg-green-100 text-green-700' },
  scheduled:          { label: '已排期',   cls: 'bg-indigo-100 text-indigo-700' },
  published:          { label: '已发布',   cls: 'bg-green-200 text-green-800' },
  measured:           { label: '已归因',   cls: 'bg-teal-100 text-teal-700' },
  archived:           { label: '已归档',   cls: 'bg-gray-200 text-gray-500' },
  failed:             { label: '失败',     cls: 'bg-red-100 text-red-700' },
}

const ITEM_STATUS_META: Record<ItemStatus, { label: string; cls: string }> = {
  pending:    { label: '待处理', cls: 'bg-gray-100 text-gray-500' },
  generating: { label: '生成中', cls: 'bg-blue-100 text-blue-600 animate-pulse' },
  ready:      { label: '就绪',   cls: 'bg-green-100 text-green-700' },
  failed:     { label: '失败',   cls: 'bg-red-100 text-red-700' },
  archived:   { label: '已归档', cls: 'bg-gray-200 text-gray-500' },
}

const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  content_post:  '📱 社媒帖子',
  blog_post:     '📝 博客文章',
  reel:          '🎬 短视频',
  visual_asset:  '🖼️ 视觉素材',
}

const PLATFORM_DISPLAY: Record<SchedulingPlatform, string> = {
  facebook:  'Facebook',
  instagram: 'Instagram',
  linkedin:  'LinkedIn',
  tiktok:    'TikTok',
  google:    'Google',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtAest(isoUtc: string): string {
  return new Date(isoUtc).toLocaleString('en-NZ', {
    timeZone: 'Australia/Sydney',
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) + ' AEST'
}

function toDateInputValue(isoUtc: string): string {
  // Convert to AEST local date string for <input type="datetime-local">
  const aestDate = new Date(new Date(isoUtc).toLocaleString('en-US', { timeZone: 'Australia/Sydney' }))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${aestDate.getFullYear()}-${pad(aestDate.getMonth() + 1)}-${pad(aestDate.getDate())}T${pad(aestDate.getHours())}:${pad(aestDate.getMinutes())}`
}

function fromDateInputValue(localAest: string): string {
  // Parse AEST datetime-local string back to UTC ISO
  const [datePart, timePart] = localAest.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  // AEST = UTC+10
  const utcMs = Date.UTC(year, month - 1, day, hour, minute) - 10 * 60 * 60 * 1000
  return new Date(utcMs).toISOString()
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${cls}`}>
      {children}
    </span>
  )
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-gray-400 w-28 shrink-0">{label}</span>
      <span className="text-gray-900">{children}</span>
    </div>
  )
}

function ContextSnapshot({ snapshot }: { snapshot: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const keys = Object.keys(snapshot)
  if (keys.length === 0) return null
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
      >
        <span>生成上下文快照 ({keys.length} 字段)</span>
        <span className="text-gray-400 text-xs">{open ? '▲ 收起' : '▼ 展开'}</span>
      </button>
      {open && (
        <div className="bg-white px-4 py-3 overflow-x-auto">
          <pre className="text-xs text-gray-600 font-mono leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function ContentPostCard({ post }: { post: ContentPost }) {
  const platforms = Array.isArray(post.platforms) ? post.platforms.join(', ') : '—'
  const scheduled = post.scheduled_at
    ? new Date(post.scheduled_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-gray-900 truncate">{post.title || '(无标题)'}</p>
      {post.caption && (
        <p className="text-xs text-gray-500 line-clamp-2">{post.caption}</p>
      )}
      <div className="flex flex-wrap gap-2 text-xs text-gray-400">
        <span>平台: {platforms}</span>
        {scheduled && <span>排期: {scheduled}</span>}
      </div>
    </div>
  )
}

function BlogPostCard({ post }: { post: BlogPost }) {
  return (
    <div className="flex gap-3 items-start">
      {post.featured_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.featured_image_url} alt={post.title} className="w-12 h-12 rounded object-cover border border-gray-200 shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded bg-gray-100 border border-dashed border-gray-300 shrink-0 flex items-center justify-center text-gray-300 text-xl">📝</div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{post.title || '(无标题)'}</p>
        <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
          {post.slug && <span>/{post.slug}</span>}
          {post.word_count != null && <span>{post.word_count.toLocaleString()} 字</span>}
        </div>
      </div>
    </div>
  )
}

function ReelCard({ reel }: { reel: ReelDraft }) {
  return <p className="text-sm font-medium text-gray-900 truncate">{reel.title || '(无标题)'}</p>
}

function VisualAssetCard({ asset }: { asset: VisualAsset }) {
  return (
    <div className="flex gap-3 items-center">
      {asset.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={asset.image_url} alt={asset.title} className="w-12 h-12 rounded object-cover border border-gray-200 shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded bg-gray-100 border border-dashed border-gray-300 shrink-0 flex items-center justify-center text-gray-300 text-xl">🖼️</div>
      )}
      <p className="text-sm font-medium text-gray-900 truncate flex-1 min-w-0">{asset.title || '(无标题)'}</p>
    </div>
  )
}

const QUICK_ACTIONS: Record<DiagnosticDimension, { label: string; desc: string; path: string }> = {
  social:        { label: '去社媒工作台', desc: '在 Content Hub 生成社媒帖子，完成后归入此包', path: '/pages' },
  seo:           { label: '去博客工作台', desc: '在 Blog Studio 生成 SEO 博客，完成后归入此包', path: '/blog' },
  ai_visibility: { label: '去博客工作台', desc: '在 Blog Studio 生成 GEO 博客，完成后归入此包', path: '/blog' },
  ads:           { label: '去广告看板',   desc: '同步广告快照或新建广告系列，完成后归入此包', path: '/ads' },
  competitor:    { label: '去竞品分析',   desc: '在 SEO Intelligence 拉取竞品关键词数据',      path: '/seo-intelligence' },
  reputation:    { label: '去口碑评估',   desc: '执行口碑评估，完成后归入此包',               path: '/reviews' },
}

function QuickActions({
  dimension, clientId, packageId,
}: { dimension: DiagnosticDimension; clientId: string; packageId: string }) {
  const action = QUICK_ACTIONS[dimension]
  if (!action) return null
  const href = `/dashboard/clients/${clientId}${action.path}?pkg=${packageId}`
  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-indigo-900">暂无产出物 — 准备好开始生成了吗？</p>
        <p className="text-xs text-indigo-600 mt-0.5">{action.desc}</p>
      </div>
      <Link
        href={href}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
      >
        {action.label} →
      </Link>
    </div>
  )
}

function ItemCard({ item, clientId, packageId }: { item: ProductionItem; clientId: string; packageId: string }) {
  const statusMeta  = ITEM_STATUS_META[item.status] ?? { label: item.status, cls: 'bg-gray-100 text-gray-600' }
  const typeLabel   = CONTENT_TYPE_LABEL[item.content_type]

  const contentLink = (() => {
    switch (item.content_type) {
      case 'content_post':
        return item.content_post_id
          ? `/dashboard/content?client=${clientId}&pkg=${packageId}&highlight=${item.content_post_id}`
          : null
      case 'blog_post':    return item.blog_post_id    ? `/dashboard/clients/${clientId}/blog` : null
      default:             return null
    }
  })()

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{typeLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${statusMeta.cls}`}>
            {statusMeta.label}
          </span>
          {contentLink && (
            <Link href={contentLink} className="text-[10px] text-indigo-600 hover:underline">
              查看 →
            </Link>
          )}
        </div>
      </div>
      {item.content != null ? (
        (() => {
          switch (item.content_type) {
            case 'content_post':  return <ContentPostCard post={item.content as ContentPost} />
            case 'blog_post':     return <BlogPostCard post={item.content as BlogPost} />
            case 'reel':          return <ReelCard reel={item.content as ReelDraft} />
            case 'visual_asset':  return <VisualAssetCard asset={item.content as VisualAsset} />
            default:              return null
          }
        })()
      ) : (
        <p className="text-xs text-gray-400 italic">内容加载失败或已删除</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Smart Scheduling Panel
// ---------------------------------------------------------------------------

function SchedulingPanel({
  items,
  clientId,
  packageId,
  onScheduled,
}: {
  items: ProductionItem[]
  clientId: string
  packageId: string
  onScheduled: (newStatus: string) => void
}) {
  // Only schedulable items are content_posts with platforms
  const schedulablePosts = items
    .filter(i => i.content_type === 'content_post' && i.content != null)
    .flatMap(i => {
      const post = i.content as ContentPost
      const platforms = (post.platforms ?? []) as SchedulingPlatform[]
      return platforms.map(platform => ({
        post_id: post.id,
        platform,
        title: post.title || '(无标题)',
        existing_scheduled_at: post.scheduled_at,
      }))
    })

  // Base date: tomorrow AEST 00:00
  const [baseDate, setBaseDate] = useState<string>(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toISOString().slice(0, 10)
  })

  const [entries, setEntries] = useState<PostScheduleEntry[]>([])
  const [suggested, setSuggested] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ scheduled: number; failed: number } | null>(null)

  const generateSuggestions = useCallback(() => {
    const base = new Date(`${baseDate}T00:00:00+10:00`)
    const existing = schedulablePosts
      .filter(p => p.existing_scheduled_at)
      .map(p => ({ platform: p.platform, scheduled_at: p.existing_scheduled_at! }))

    const { suggestions } = findSlots({
      posts: schedulablePosts.map(p => ({ id: p.post_id + '::' + p.platform, platform: p.platform })),
      existingSchedule: existing,
      baseDate: base,
      windowDays: 14,
    })

    const suggestionMap = new Map(suggestions.map(s => [s.post_id, s.suggested_at]))

    setEntries(schedulablePosts.map(p => ({
      post_id: p.post_id,
      platform: p.platform,
      suggested_at: suggestionMap.get(p.post_id + '::' + p.platform) ?? null,
      confirmed_at: suggestionMap.get(p.post_id + '::' + p.platform) ?? null,
      title: p.title,
    })))
    setSuggested(true)
  }, [baseDate, schedulablePosts])

  const updateEntry = (postId: string, platform: SchedulingPlatform, newUtcIso: string) => {
    setEntries(prev => prev.map(e =>
      e.post_id === postId && e.platform === platform
        ? { ...e, confirmed_at: newUtcIso }
        : e
    ))
  }

  const handleConfirmAll = async () => {
    const assignments = entries
      .filter(e => e.confirmed_at !== null)
      .map(e => ({ post_id: e.post_id, scheduled_at: e.confirmed_at! }))

    if (assignments.length === 0) return

    setSubmitting(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/production/${packageId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments, approve: true }),
      })
      const data = await res.json() as { success: boolean; scheduled: number; failed: number; packageStatus: string }
      setResult({ scheduled: data.scheduled, failed: data.failed })
      if (data.packageStatus) {
        onScheduled(data.packageStatus)
      }
    } catch {
      setResult({ scheduled: 0, failed: assignments.length })
    } finally {
      setSubmitting(false)
    }
  }

  if (schedulablePosts.length === 0) {
    return (
      <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-5 text-center">
        <p className="text-sm text-gray-500">此生产包中没有可排期的社媒帖子。</p>
      </div>
    )
  }

  if (result) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center space-y-2">
        <p className="text-sm font-semibold text-green-800">
          ✅ 排期完成：{result.scheduled} 条已确认
          {result.failed > 0 && `，${result.failed} 条失败`}
        </p>
        <p className="text-xs text-green-600">内容状态已更新为「已批准」，可在 Content Hub 中查看发布状态。</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Base date picker */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">从哪天开始排期（AEST 日期）</label>
          <input
            type="date"
            value={baseDate}
            onChange={e => { setBaseDate(e.target.value); setSuggested(false) }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          onClick={generateSuggestions}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          ✨ AI 建议排期
        </button>
      </div>

      {/* Suggestions table */}
      {suggested && entries.length > 0 && (
        <>
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">帖子</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">平台</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">建议时间 (AEST)</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">调整</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry, idx) => (
                  <tr key={`${entry.post_id}-${entry.platform}-${idx}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900 text-xs truncate max-w-[180px]">{entry.title}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                        {PLATFORM_DISPLAY[entry.platform]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {entry.suggested_at ? fmtAest(entry.suggested_at) : (
                        <span className="text-orange-500">⚠ 14 天内无空位</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {entry.suggested_at && (
                        <input
                          type="datetime-local"
                          defaultValue={toDateInputValue(entry.suggested_at)}
                          onChange={e => {
                            if (e.target.value) {
                              updateEntry(entry.post_id, entry.platform, fromDateInputValue(e.target.value))
                            }
                          }}
                          className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {entries.filter(e => e.confirmed_at).length}/{entries.length} 条可排期（平台高峰时段，最多 14 天，TikTok 每天 2 条）
            </p>
            <button
              onClick={handleConfirmAll}
              disabled={submitting || entries.every(e => !e.confirmed_at)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  提交中...
                </>
              ) : '✅ 全部确认排期'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ProductionPackageDetailPage() {
  const params = useParams<{ id: string; packageId: string }>()
  const clientId  = params.id
  const packageId = params.packageId

  const [data, setData] = useState<PackageDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pkgStatus, setPkgStatus] = useState<PackageStatus>('draft')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/production/${packageId}`)
        const json = await res.json() as PackageDetailResponse
        if (!json.success) {
          setError(json.error ?? '加载失败')
        } else {
          setData(json)
          setPkgStatus(json.package.status)
        }
      } catch {
        setError('网络错误，请重试')
      } finally {
        setLoading(false)
      }
    })()
  }, [clientId, packageId])

  const handleApprove = async () => {
    setApproving(true)
    setApproveError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/production/${packageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      const json = await res.json() as { success: boolean; package?: { status: string }; error?: string }
      if (json.success && json.package) {
        setPkgStatus(json.package.status as PackageStatus)
      } else {
        setApproveError(json.error ?? '操作失败')
      }
    } catch {
      setApproveError('网络错误，请重试')
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-500">加载生产包...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-600 font-medium">{error ?? '未找到生产包'}</p>
          <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-indigo-600 hover:underline">
            ← 返回客户主页
          </Link>
        </div>
      </div>
    )
  }

  const { package: pkg, campaign, execution_item, items } = data
  const dimColor  = DIMENSION_COLOR[pkg.dimension] ?? 'bg-gray-100 text-gray-700 border-gray-200'
  const statusMeta = PKG_STATUS_META[pkgStatus] ?? { label: pkgStatus, cls: 'bg-gray-100 text-gray-600' }
  const createdAt = new Date(pkg.created_at).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const updatedAt = new Date(pkg.updated_at).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const itemsByType = items.reduce<Record<ContentType, number>>(
    (acc, i) => { acc[i.content_type] = (acc[i.content_type] ?? 0) + 1; return acc },
    {} as Record<ContentType, number>
  )
  const firstContentPost = items.find(item => item.content_type === 'content_post' && item.content_post_id)?.content_post_id ?? null
  const quickLinks = [
    { label: '客户概览', href: `/dashboard/clients/${clientId}` },
    { label: 'Execution', href: `/dashboard/clients/${clientId}/execution` },
    { label: 'Launch Hub', href: `/dashboard/content?client=${clientId}${firstContentPost ? `&highlight=${firstContentPost}` : ''}` },
  ]

  const canApprove = ['ready_for_review', 'revision_requested', 'draft'].includes(pkgStatus)
  const socialPostCount = items.filter(i => i.content_type === 'content_post').length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <nav className="text-xs text-gray-400 flex items-center gap-1.5 mb-2">
            <Link href="/dashboard/clients" className="hover:text-gray-600">客户</Link>
            <span>/</span>
            <Link href={`/dashboard/clients/${clientId}`} className="hover:text-gray-600 truncate max-w-[120px]">{clientId.slice(0, 8)}…</Link>
            <span>/</span>
            <span className="text-gray-700 font-medium">生产包</span>
          </nav>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{pkg.title}</h1>
              <Badge cls={dimColor}>{DIMENSION_LABEL[pkg.dimension] ?? pkg.dimension}</Badge>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusMeta.cls}`}>
                {statusMeta.label}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {canApprove && (
                <button
                  onClick={handleApprove}
                  disabled={approving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {approving ? '处理中...' : '✅ 批准此包'}
                </button>
              )}
              <Link
                href={`/dashboard/clients/${clientId}`}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 shrink-0"
              >
                ← 返回
              </Link>
            </div>
          </div>
          {approveError && (
            <p className="mt-2 text-xs text-red-600">{approveError}</p>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">

        {/* Meta card */}
        <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">基本信息</h2>
          <div className="space-y-2.5">
            <MetaRow label="维度">{DIMENSION_LABEL[pkg.dimension] ?? pkg.dimension}</MetaRow>
            <MetaRow label="状态">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusMeta.cls}`}>
                {statusMeta.label}
              </span>
            </MetaRow>
            <MetaRow label="Campaign">
              {campaign ? (
                <span className="font-medium">{campaign.name}</span>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </MetaRow>
            <MetaRow label="执行项">
              {execution_item ? (
                <span className="font-medium">{execution_item.title}</span>
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </MetaRow>
            <MetaRow label="创建时间">{createdAt}</MetaRow>
            <MetaRow label="更新时间">{updatedAt}</MetaRow>
          </div>
          {pkg.brief && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1">简报</p>
              <p className="text-sm text-gray-700 leading-relaxed">{pkg.brief}</p>
            </div>
          )}
        </section>

        {/* Items summary */}
        {items.length > 0 && (
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(Object.entries(itemsByType) as [ContentType, number][]).map(([type, count]) => (
              <div key={type} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">{count}</p>
                <p className="text-xs text-gray-500 mt-1">{CONTENT_TYPE_LABEL[type]}</p>
              </div>
            ))}
          </section>
        )}

        {/* P21.10 — Smart Scheduling Panel (only for social posts) */}
        {socialPostCount > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">智能排期</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  AI 根据平台高峰时段 + 14 天日历自动规避内容撞车，可手动调整
                </p>
              </div>
            </div>
            <SchedulingPanel
              items={items}
              clientId={clientId}
              packageId={packageId}
              onScheduled={newStatus => setPkgStatus(newStatus as PackageStatus)}
            />
          </section>
        )}

        {/* Items list */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              产出物 ({items.length})
            </h2>
          </div>
          {items.length === 0 ? (
            <QuickActions dimension={pkg.dimension} clientId={clientId} packageId={packageId} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map(item => (
                <ItemCard key={item.id} item={item} clientId={clientId} packageId={packageId} />
              ))}
            </div>
          )}
        </section>

        {/* Context snapshot */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">生成上下文</h2>
          <ContextSnapshot snapshot={pkg.generation_context_snapshot} />
        </section>

        {/* Raw IDs (debug strip) */}
        <section className="bg-gray-50 rounded-xl border border-dashed border-gray-200 p-4 text-xs font-mono text-gray-400 space-y-1">
          <p>package_id: {pkg.id}</p>
          {pkg.campaign_id         && <p>campaign_id: {pkg.campaign_id}</p>}
          {pkg.execution_item_id   && <p>execution_item_id: {pkg.execution_item_id}</p>}
          {pkg.diagnostic_run_id   && <p>diagnostic_run_id: {pkg.diagnostic_run_id}</p>}
          {pkg.prescription_id     && <p>prescription_id: {pkg.prescription_id}</p>}
        </section>

      </div>
      <ZhugeWorkbenchFab
        clientId={clientId}
        currentHref={`/dashboard/clients/${clientId}/production/${packageId}`}
        clientLabel={clientId.slice(0, 8)}
        currentAreaLabel="Production Package"
        campaignLabel={campaign?.name ?? null}
        taskLabel={execution_item?.title ?? null}
        packageLabel={pkg.title}
        quickLinks={quickLinks}
        onOpenChat={() => setWorkbenchChatOpen(true)}
      />
      <ZhugeWorkbenchDrawer
        clientId={clientId}
        isOpen={workbenchChatOpen}
        onClose={() => setWorkbenchChatOpen(false)}
      />
    </div>
  )
}
