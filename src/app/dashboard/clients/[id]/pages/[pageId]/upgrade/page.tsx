'use client'

import { useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import type { PageUpgradeOutput } from '@/lib/blog/upgrade-generator'

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DiffSection({
  label,
  original,
  enhanced,
}: {
  label: string
  original: string
  enhanced: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-red-50 border border-red-100 p-3">
          <p className="text-xs text-red-500 font-medium mb-1">原内容</p>
          <p className="text-sm text-gray-700 line-clamp-3">{original || '（无）'}</p>
        </div>
        <div className="rounded-lg bg-green-50 border border-green-100 p-3">
          <p className="text-xs text-green-600 font-medium mb-1">升级后</p>
          <p className="text-sm text-gray-700 line-clamp-3">{enhanced}</p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function UpgradePage() {
  const params = useParams()
  const clientId = params.id as string
  const pageId = params.pageId as string
  const router = useRouter()
  const searchParams = useSearchParams()

  const topic = searchParams.get('topic') ?? ''
  const mode = (searchParams.get('mode') ?? 'unified') as 'unified' | 'geo_only' | 'seo_only'
  const strategyItemId = searchParams.get('strategy_item_id') ?? undefined

  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<PageUpgradeOutput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/pages/${pageId}/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, mode }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as PageUpgradeOutput
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const handleApprove = async () => {
    if (!result) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/blog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          mode,
          skip_audit: true,
          title: result.enhanced_title,
          html_body: result.enhanced_html_body,
          meta_title: result.enhanced_meta_title,
          meta_description: result.enhanced_meta_description,
          word_count: result.word_count,
          source_page_id: pageId,
          strategy_item_id: strategyItemId,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

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
            <h1 className="text-base font-semibold text-gray-900">升级现有页面</h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
        {/* Topic + mode info */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex flex-wrap gap-3 items-start justify-between">
            <div>
              <p className="text-xs text-gray-500 mb-1">目标话题</p>
              <p className="text-sm font-medium text-gray-900">{topic || '（未指定）'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">模式</p>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                mode === 'unified' ? 'bg-indigo-100 text-indigo-700' :
                mode === 'geo_only' ? 'bg-green-100 text-green-700' :
                'bg-blue-100 text-blue-700'
              }`}>
                {mode === 'unified' ? 'SEO + GEO' : mode === 'geo_only' ? 'GEO 优先' : 'SEO 优先'}
              </span>
            </div>
            {!result && (
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? '分析并生成升级版本…' : '生成升级版本'}
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {generating && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 bg-white rounded-xl border border-gray-200 animate-pulse" />
            ))}
          </div>
        )}

        {/* Upgrade result */}
        {result && !generating && (
          <>
            {/* Changes summary */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-amber-800 mb-1">变更摘要</p>
              <p className="text-sm text-amber-900">{result.changes_summary}</p>
              <p className="text-xs text-amber-600 mt-2">
                字数：原 {result.original_excerpt.split(/\s+/).length} 词 → 升级后 {result.word_count.toLocaleString()} 词
                {result.cost_usd > 0 && ` · Strategy Engine 消耗 $${result.cost_usd.toFixed(4)}`}
              </p>
            </div>

            {/* Diff comparison */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-900">内容对比</h2>

              <DiffSection
                label="标题"
                original={result.source_page_url.split('/').pop() ?? ''}
                enhanced={result.enhanced_title}
              />

              <DiffSection
                label="Meta 描述"
                original="（原页面无结构化 Meta 数据）"
                enhanced={result.enhanced_meta_description}
              />

              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">原始内容摘录</p>
                <div className="rounded-lg bg-red-50 border border-red-100 p-3">
                  <p className="text-xs text-red-500 font-medium mb-1">原内容（前 500 字符）</p>
                  <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
                    {result.original_excerpt}
                  </pre>
                </div>
              </div>

              {result.geo_block_html && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">新增 GEO 信号块</p>
                  <div className="rounded-lg bg-green-50 border border-green-100 p-3">
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
                      {result.geo_block_html}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            {/* Approve / reject */}
            {saved ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-sm font-semibold text-green-800">已保存为博客草稿 ✓</p>
                <button
                  onClick={() => router.push(`/dashboard/clients/${clientId}/strategy`)}
                  className="mt-3 text-sm text-green-700 underline"
                >
                  返回策略面板
                </button>
              </div>
            ) : (
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => router.back()}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  放弃
                </button>
                <button
                  onClick={handleApprove}
                  disabled={saving}
                  className="rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? '保存中…' : '批准并保存为草稿'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Info box */}
        {!result && !generating && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
            <p className="text-xs text-orange-900">
              <strong>升级流程说明</strong><br />
              Strategy Engine（Claude）将：① 通过 Site Analyzer 抓取原页面内容 ② 识别薄弱点（字数不足、缺少 GEO 信号块）
              ③ 生成 SEO + GEO 双重优化的升级版本 ④ 提供变更摘要供你审核。
              批准后保存为博客草稿，可在内容看板继续编辑后发布。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
