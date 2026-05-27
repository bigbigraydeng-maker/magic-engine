'use client'

/**
 * StudioArticleTab — SEO article generation inside the Content Studio drawer.
 *
 * Pre-generation channels:
 *   - keyword/topic (pre-filled from the execution item)
 *   - FDE free-text "customer feedback" — knowledge from real customer
 *     conversations that the Master Brief / Campaign cannot capture
 * Master Brief + active Campaign are auto-injected server-side.
 *
 * Post-generation: hands off to StudioArticleWorkbench — editable fields plus
 * an AI conversation panel — so the FDE always keeps a manual + AI channel.
 *
 * Reference: Content Studio MVP — diagnosis-driven content generation.
 */

import { useState } from 'react'
import Link from 'next/link'
import type { ExecutionItem } from '@/types/diagnostic'
import { StudioArticleWorkbench, toArticlePost, type ArticlePost } from './StudioArticleWorkbench'

const WORD_COUNT_OPTIONS = [800, 1000, 1200, 1500, 2000] as const

interface UpgradeNotice {
  existing_url: string | null
  existing_title: string | null
  reason: string
}

interface Props {
  clientId: string
  item: ExecutionItem
  hasActiveCampaign: boolean
  /** Called after a draft is queued/persisted — lets the drawer log it back to the execution item. */
  onGenerated: (summary: string, blogPostId?: string) => void
}

export function StudioArticleTab({ clientId, item, hasActiveCampaign, onGenerated }: Props) {
  const [keyword, setKeyword]       = useState(item.title)
  const [fdeContext, setFdeContext] = useState('')
  const [mode, setMode]             = useState<'unified' | 'geo_only'>(
    item.dimension === 'ai_visibility' ? 'geo_only' : 'unified',
  )
  const [wordCount, setWordCount]   = useState<number>(1200)
  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState('')
  const [post, setPost]             = useState<ArticlePost | null>(null)
  const [upgrade, setUpgrade]       = useState<UpgradeNotice | null>(null)
  const [queuedPostId, setQueuedPostId] = useState<string | null>(null)

  const generate = async (skipAudit = false) => {
    const kw = keyword.trim()
    if (!kw) return
    setGenerating(true)
    setError('')
    setUpgrade(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/blog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          topic: kw,
          source_query_text: kw,
          word_count_target: wordCount,
          skip_audit: skipAudit,
          fde_context: fdeContext.trim() || undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok || !j.success) throw new Error(j.error ?? '生成失败')

      if (j.action === 'upgrade' && j.audit) {
        setUpgrade({
          existing_url:   j.audit.existing_url ?? null,
          existing_title: j.audit.existing_title ?? null,
          reason:         j.audit.reason ?? '检测到相似的已有内容，建议升级而非新建',
        })
      } else if (j.action === 'queued' && j.post_id) {
        // Background generation queued — log immediately, show link to blog page
        setQueuedPostId(j.post_id as string)
        onGenerated(`🤖 已在内容工作台生成 SEO 文章草稿：「${kw}」`, j.post_id as string)
      } else if (j.post) {
        const article = toArticlePost(j.post)
        setPost(article)
        onGenerated(`🤖 已在内容工作台生成 SEO 文章草稿：「${article.title}」`, article.id)
      } else {
        throw new Error('生成返回为空，请重试')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  // ── Post-generation → editable + AI-conversation workbench ──────────────────
  if (post) {
    return (
      <StudioArticleWorkbench
        clientId={clientId}
        post={post}
        executionItemId={item.id}
        onPostUpdated={setPost}
        onRegenerate={() => setPost(null)}
      />
    )
  }

  // ── Queued: background generation in progress ──────────────────────────────
  if (queuedPostId) {
    return (
      <div className="max-w-2xl rounded-xl border border-green-200 bg-green-50 p-5 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⏳</span>
          <div>
            <p className="text-sm font-semibold text-green-800">文章已提交后台生成</p>
            <p className="text-xs text-green-700 mt-0.5">
              AI 正在撰写中（约 30–60 秒），完成后可在 Blog Posts 页面查看。
            </p>
          </div>
        </div>
        <Link
          href={`/dashboard/clients/${clientId}/blog/${queuedPostId}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
        >
          前往查看文章 →
        </Link>
        <div className="pt-1">
          <button
            onClick={() => setQueuedPostId(null)}
            className="text-xs text-green-700 hover:text-green-900 underline"
          >
            再生成一篇
          </button>
        </div>
      </div>
    )
  }

  // ── Pre-generation form ─────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-2xl">
      {/* Keyword / topic */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">
          关键词 / 话题 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !generating) void generate() }}
          placeholder='例如 "best guided tours New Zealand"'
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-[11px] text-gray-400">话题已自动预填充自当前执行项，可按需修改。</p>
      </div>

      {/* FDE context — the manual input channel for customer-conversation knowledge */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">
          客户反馈 / 补充要求 <span className="text-gray-400">（选填）</span>
        </label>
        <textarea
          value={fdeContext}
          onChange={e => setFdeContext(e.target.value)}
          rows={3}
          placeholder="把你从客户对话里了解到的写在这里 —— 例：客户强调主打小团、家庭友好，不要写得太官方"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
        />
        <p className="mt-1 text-[11px] text-gray-400">
          这段会作为<strong className="text-gray-500">高优先级要求</strong>写进文章 —— 生成后还能继续用 AI 对话调整。
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        {/* Mode */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-gray-600 mb-1">生成模式</label>
          <div className="flex gap-2">
            {([['unified', '🔀 SEO + GEO'], ['geo_only', '🤖 GEO only']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setMode(val)}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${
                  mode === val
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">
            {mode === 'unified' ? 'SEO 关键词 + AI 实体信号' : '仅 AI 可见度信号'}
          </p>
        </div>

        {/* Word count */}
        <div className="flex-1 min-w-[140px]">
          <label className="block text-xs font-semibold text-gray-600 mb-1">目标字数</label>
          <select
            value={wordCount}
            onChange={e => setWordCount(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none"
          >
            {WORD_COUNT_OPTIONS.map(w => (
              <option key={w} value={w}>~{w.toLocaleString()}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Context assurance */}
      <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2 text-[11px] text-indigo-700">
        ✓ 生成时自动注入 <strong>Master Brief</strong>（客户 DNA）
        {hasActiveCampaign
          ? <> 与 <strong>当前 Campaign</strong> —— 内容会贴合品牌与本期推广。</>
          : <> —— 当前无活跃 Campaign，内容仅依据品牌 DNA。</>}
      </div>

      {/* Upgrade notice */}
      {upgrade && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-xl shrink-0">🔄</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">检测到相似的已有内容</p>
              <p className="text-xs text-amber-700 mt-1">{upgrade.reason}</p>
              {upgrade.existing_url && (
                <a
                  href={upgrade.existing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline mt-1 block truncate"
                >
                  📄 {upgrade.existing_title ?? upgrade.existing_url}
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void generate(true)}
              disabled={generating}
              className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors"
            >
              {generating ? '⏳ 生成中…' : '仍然生成新文章'}
            </button>
            <button
              onClick={() => setUpgrade(null)}
              className="px-4 py-2 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {!upgrade && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => void generate()}
            disabled={generating || !keyword.trim()}
            className="px-5 py-2.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors"
          >
            {generating ? '⏳ 生成中…（约 20–30 秒）' : '✨ 生成 SEO 文章'}
          </button>
        </div>
      )}
    </div>
  )
}
