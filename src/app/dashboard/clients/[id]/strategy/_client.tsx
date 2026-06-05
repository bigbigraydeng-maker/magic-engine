'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { StrategyItem, ActionType, ContentMode, StrategyPriority } from '@/lib/strategy/types'
import { buildStrategyBlogRequest } from '@/lib/blog/request-builders'

interface BlogGenerationResponse {
  success: boolean
  action?: 'new' | 'upgrade' | 'queued'
  post_id?: string
  post?: { id: string; cost_usd?: number | null } | null
  audit?: { reason?: string } | null
  error?: string
  cost_usd?: number | null
}

interface StrategyGenerateResponse {
  count?: number
  skipped_duplicates?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

const ACTION_LABEL: Record<ActionType, string> = {
  upgrade_page:   '🔄 升级现有页面',
  new_blog:       '✨ 新建博客文章',
  social_content: '📱 社媒内容',
}

const MODE_LABEL: Record<ContentMode, string> = {
  unified:  'SEO + GEO',
  geo_only: 'GEO 优先',
  seo_only: 'SEO 优先',
}

const PRIORITY_COLOR: Record<StrategyPriority, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high:     'bg-orange-100 text-orange-700 border-orange-200',
  medium:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  low:      'bg-gray-100 text-gray-600 border-gray-200',
}

const PRIORITY_LABEL: Record<StrategyPriority, string> = {
  critical: '紧急',
  high:     '高',
  medium:   '中',
  low:      '低',
}

const MODE_COLOR: Record<ContentMode, string> = {
  unified:  'bg-indigo-100 text-indigo-700',
  geo_only: 'bg-green-100 text-green-700',
  seo_only: 'bg-blue-100 text-blue-700',
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

function StrategyCard({
  item,
  clientId,
  onDismiss,
  onGenerateBlog,
  generatingBlogId,
}: {
  item: StrategyItem
  clientId: string
  onDismiss: (id: string) => void
  onGenerateBlog: (item: StrategyItem) => void
  generatingBlogId: string | null
}) {
  const isGeneratingBlog = generatingBlogId === item.id

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-200 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${PRIORITY_COLOR[item.priority]}`}>
              {PRIORITY_LABEL[item.priority]}
            </span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${MODE_COLOR[item.content_mode]}`}>
              {MODE_LABEL[item.content_mode]}
            </span>
            <span className="text-xs text-gray-400">
              {ACTION_LABEL[item.action_type]}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-gray-900 mb-1 truncate" title={item.proposed_title}>
            {item.proposed_title}
          </h3>

          {/* Rationale */}
          <p className="text-xs text-gray-500 mb-2">{item.rationale}</p>

          {/* Content angle */}
          {item.content_angle && (
            <p className="text-xs text-indigo-600 italic">{item.content_angle}</p>
          )}

          {/* Social platform badge — only for social_content items */}
          {item.action_type === 'social_content' && (() => {
            const r = item.rationale ?? ''
            const badge =
              r.startsWith('FACEBOOK:') ? { label: 'Facebook', cls: 'bg-blue-100 text-blue-700' } :
              r.startsWith('INSTAGRAM:') ? { label: 'Instagram', cls: 'bg-purple-100 text-purple-700' } :
              r.startsWith('LINKEDIN:') ? { label: 'LinkedIn', cls: 'bg-sky-100 text-sky-700' } :
              null
            return badge ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
                {item.linked_blog_post_id && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs">
                    📝 来自博客
                  </span>
                )}
              </div>
            ) : null
          })()}

          {/* Keyword signal */}
          {item.source_keyword && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-400">
              <span>🔑 {item.source_keyword}</span>
              {item.keyword_volume != null && <span>月搜量 {item.keyword_volume.toLocaleString()}</span>}
              {item.keyword_kd != null && <span>难度 {item.keyword_kd}</span>}
            </div>
          )}

          {/* Action CTA — upgrade_page links to upgrade detail page */}
          {item.action_type === 'upgrade_page' && item.source_page_id && (
            <div className="mt-3">
              <Link
                href={`/dashboard/clients/${clientId}/pages/${item.source_page_id}/upgrade?strategy_item_id=${item.id}&topic=${encodeURIComponent(item.proposed_title)}&mode=${item.content_mode}`}
                className="inline-flex items-center gap-1 rounded-lg bg-orange-50 border border-orange-200 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition-colors"
              >
                升级此页面 →
              </Link>
            </div>
          )}

          {item.action_type === 'new_blog' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {item.linked_blog_post_id ? (
                <Link
                  href={`/dashboard/clients/${clientId}/blog/${item.linked_blog_post_id}`}
                  className="inline-flex items-center gap-1 rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors"
                >
                  查看博客 →
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onGenerateBlog(item)}
                  disabled={!!generatingBlogId}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:bg-indigo-300 transition-colors"
                >
                  {isGeneratingBlog ? '生成中…' : '生成博客'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Score badge + dismiss */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <div className="text-center">
            <p className="text-lg font-bold text-gray-900">{Math.round(item.priority_score)}</p>
            <p className="text-xs text-gray-400">分</p>
          </div>
          <button
            onClick={() => onDismiss(item.id)}
            className="text-xs text-gray-300 hover:text-gray-500 transition-colors"
            title="忽略此建议"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onGenerate, isGenerating }: { onGenerate: () => void; isGenerating: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-4xl mb-4">📊</div>
      <h3 className="text-base font-semibold text-gray-900 mb-2">暂无策略建议</h3>
      <p className="text-sm text-gray-500 mb-6 max-w-xs">
        运行三维分析，Magic Engine 将根据网站现状、AI 排名弱项和关键词缺口，生成个性化内容策略。
      </p>
      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {isGenerating ? '分析中…' : '生成内容策略'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type FilterMode = ActionType | 'all'

export function StrategyClient() {
  const params = useParams()
  const clientId = params.id as string
  const router = useRouter()

  const [items, setItems] = useState<StrategyItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [generatingBlogId, setGeneratingBlogId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const [actionOk, setActionOk] = useState<boolean | null>(null)
  const [filterMode, setFilterMode] = useState<FilterMode>('all')

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // P14.C.2: 忽略状态的候选项不应回到看板（持久化 dismissed 通过 PATCH 实现）
      const res = await fetch(`/api/clients/${clientId}/strategy?limit=100&exclude_status=dismissed`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { fetchItems() }, [fetchItems])

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/strategy/generate`, { method: 'POST' })
      const data = await res.json().catch(() => ({})) as StrategyGenerateResponse
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      await fetchItems()
      flash(`Strategy refreshed: ${data.count ?? 0} new, ${data.skipped_duplicates ?? 0} duplicate candidates skipped.`, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleDismiss = async (itemId: string) => {
    // P14.C.2: 乐观更新 + API 持久化。回滚条件：API 失败则恢复 UI 状态并提示。
    const prevItems = items
    const prevTotal = total
    setItems(p => p.filter(i => i.id !== itemId))
    setTotal(p => Math.max(0, p - 1))

    try {
      const res = await fetch(`/api/clients/${clientId}/strategy/${itemId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'dismissed' }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
    } catch (e) {
      // Rollback on failure
      setItems(prevItems)
      setTotal(prevTotal)
      flash(e instanceof Error ? `忽略失败：${e.message}` : '忽略失败', false)
    }
  }

  const flash = (msg: string, ok: boolean) => {
    setActionMsg(msg)
    setActionOk(ok)
    setTimeout(() => { setActionMsg(''); setActionOk(null) }, 7000)
  }

  const handleGenerateBlog = async (item: StrategyItem) => {
    setGeneratingBlogId(item.id)
    flash('正在生成博客草稿…', true)
    try {
      const res = await fetch(`/api/clients/${clientId}/blog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildStrategyBlogRequest(item)),
      })
      const data = await res.json() as BlogGenerationResponse
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Generation failed')

      if (data.action === 'upgrade') {
        flash(data.audit?.reason ?? '已有内容可升级，未新建博客。', false)
        return
      }

      const postId = data.post_id ?? data.post?.id ?? null
      setItems(prev => prev.map(i =>
        i.id === item.id
          ? { ...i, status: 'done', linked_blog_post_id: postId ?? i.linked_blog_post_id }
          : i
      ))
      flash(`博客草稿已生成${data.cost_usd != null ? ` ($${data.cost_usd.toFixed(4)})` : ''}`, true)
      await fetchItems()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Generation failed', false)
    } finally {
      setGeneratingBlogId(null)
    }
  }

  const displayed = filterMode === 'all'
    ? items
    : items.filter(i => i.action_type === filterMode)

  // Summary counts
  const counts: Record<ActionType, number> = {
    upgrade_page:   items.filter(i => i.action_type === 'upgrade_page').length,
    new_blog:       items.filter(i => i.action_type === 'new_blog').length,
    social_content: items.filter(i => i.action_type === 'social_content').length,
  }
  const criticalCount = items.filter(i => i.priority === 'critical' || i.priority === 'high').length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              ← 返回
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-base font-semibold text-gray-900">内容策略</h1>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {generating ? '分析中…' : '重新生成策略'}
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        {/* Error banner */}
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

        {/* Stats */}
        {items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="总建议数" value={total} />
            <StatCard label="紧急 / 高优先" value={criticalCount} />
            <StatCard label="升级现有页面" value={counts.upgrade_page} />
            <StatCard label="新建博客" value={counts.new_blog} />
          </div>
        )}

        {/* Filter tabs */}
        {items.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(['all', 'upgrade_page', 'new_blog', 'social_content'] as FilterMode[]).map(mode => {
              const count = mode === 'all' ? items.length : counts[mode as ActionType]
              const label = mode === 'all' ? '全部' : ACTION_LABEL[mode as ActionType]
              return (
                <button
                  key={mode}
                  onClick={() => setFilterMode(mode)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filterMode === mode
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {label} ({count})
                </button>
              )
            })}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-28 bg-white rounded-xl border border-gray-200 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState onGenerate={handleGenerate} isGenerating={generating} />
        ) : displayed.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            该分类下暂无建议
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map(item => (
              <StrategyCard
                key={item.id}
                item={item}
                clientId={clientId}
                onDismiss={handleDismiss}
                onGenerateBlog={handleGenerateBlog}
                generatingBlogId={generatingBlogId}
              />
            ))}
          </div>
        )}

        {/* Info box */}
        {items.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <p className="text-xs text-indigo-900">
              <strong>❓ 三维策略分析原理</strong>
              <br />
              综合三个维度：① AI Tracker 弱项（哪些查询中品牌排名低于第3位）
              ② SEMrush 关键词缺口（竞品有排名的词，客户缺少对应页面）
              ③ 现有页面薄弱点（字数不足 / 未部署 GEO Block）。三个维度同时满足的机会优先级最高。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
