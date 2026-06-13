'use client'

/**
 * PublishToWebsitePanel — Draft → Preview → Publish three-step flow.
 *
 * Supported platforms:
 *   • WordPress — uses /api/.../cms/publish-wordpress (action: draft / publish)
 *   • Shopify   — uses /api/.../cms/publish-shopify  (action: draft / publish)
 *   • GitHub    — uses /api/.../cms/publish-blog      (single-step PR creation)
 *
 * Phase 14.A.6
 */

import { useState, useEffect } from 'react'
import type { CmsConnectionStatus, WordpressConnectionStatus, ShopifyConnectionStatus } from '@/lib/cms/vocabulary'
import { ThemeUppercaseWarning } from './ThemeUppercaseWarning'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Providers {
  github:    CmsConnectionStatus | null
  wordpress: WordpressConnectionStatus | null
  shopify:   ShopifyConnectionStatus | null
}

type Platform = 'wordpress' | 'shopify' | 'github'

type PublishPhase =
  | 'idle'
  | 'drafting'
  | 'draft_ready'
  | 'publishing'
  | 'done'
  | 'error'

interface DraftResult {
  job_id:      string
  platform_id: string
  preview_url: string | null
}

interface Props {
  clientId:       string
  postId:         string
  /** P14.B.5: used to show a warning when primary_keyword is missing before WP publish. */
  primaryKeyword?: string | null
  /**
   * P14.E.5: when set, all publish actions are disabled and the panel shows a
   * locked button with the reason as tooltip. Use this for hard-blocked
   * quality checks (e.g. brand mention &lt;3).
   */
  disabledReason?: string
  onSuccess?: (platform: Platform, result: DoneResult) => void
}

interface DoneResult {
  platform:     Platform
  prUrl?:       string
  prNumber?:    number
  jobId?:       string
  platformId?:  string
  /** P14.B.7: published URL returned by the WP/Shopify publish endpoint, used for GSC indexing. */
  publishedUrl?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishToWebsitePanel({ clientId, postId, primaryKeyword, disabledReason, onSuccess }: Props) {
  const [providers,        setProviders]        = useState<Providers | null>(null)
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null)
  const [phase,            setPhase]            = useState<PublishPhase>('idle')
  const [draftResult,      setDraftResult]      = useState<DraftResult | null>(null)
  const [errorMsg,         setErrorMsg]         = useState<string | null>(null)
  const [doneResult,       setDoneResult]       = useState<DoneResult | null>(null)
  // P14.B.7: GSC indexing state
  const [gscIndexing,     setGscIndexing]     = useState(false)
  const [gscResult,       setGscResult]       = useState<{ ok: boolean; msg: string; reauthUrl?: string } | null>(null)
  const [rollingBack,     setRollingBack]     = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res  = await fetch(`/api/clients/${clientId}/cms/providers`)
        const json = await res.json() as { success: boolean; providers?: Providers }
        if (json.success && json.providers) setProviders(json.providers)
      } finally {
        setLoadingProviders(false)
      }
    })()
  }, [clientId])

  const connectedPlatforms: Platform[] = []
  if (providers?.wordpress?.status === 'connected') connectedPlatforms.push('wordpress')
  if (providers?.shopify?.status    === 'connected') connectedPlatforms.push('shopify')
  if (providers?.github?.status     === 'connected') connectedPlatforms.push('github')

  const handleCreateDraft = async (platform: Platform) => {
    setSelectedPlatform(platform)
    setPhase('drafting')
    setErrorMsg(null)

    try {
      if (platform === 'github') {
        // GitHub: single-step PR creation.
        const res  = await fetch(`/api/clients/${clientId}/cms/publish-blog`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ blog_post_id: postId }),
        })
        const json = await res.json() as {
          success: boolean; pr_url?: string; pr_number?: number; error?: string
        }
        if (!json.success) throw new Error(json.error ?? 'PR creation failed')
        const result: DoneResult = { platform: 'github', prUrl: json.pr_url, prNumber: json.pr_number }
        setDoneResult(result)
        setPhase('done')
        onSuccess?.('github', result)
        return
      }

      const endpoint = platform === 'wordpress'
        ? `/api/clients/${clientId}/cms/publish-wordpress`
        : `/api/clients/${clientId}/cms/publish-shopify`

      const targetType = platform === 'wordpress' ? 'post' : 'article'

      const res  = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:      'draft',
          source_type: 'blog_post',
          source_id:   postId,
          target_type: targetType,
        }),
      })
      const json = await res.json() as {
        success: boolean; job_id?: string; platform_id?: string; preview_url?: string; error?: string
      }
      if (!json.success) throw new Error(json.error ?? 'Draft creation failed')

      setDraftResult({
        job_id:      json.job_id!,
        platform_id: json.platform_id!,
        preview_url: json.preview_url ?? null,
      })
      setPhase('draft_ready')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected error')
      setPhase('error')
    }
  }

  const handlePublish = async () => {
    if (!selectedPlatform || !draftResult) return
    setPhase('publishing')
    setErrorMsg(null)

    try {
      const endpoint = selectedPlatform === 'wordpress'
        ? `/api/clients/${clientId}/cms/publish-wordpress`
        : `/api/clients/${clientId}/cms/publish-shopify`

      const res  = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:      'publish',
          job_id:      draftResult.job_id,
          platform_id: draftResult.platform_id,
        }),
      })
      const json = await res.json() as { success: boolean; error?: string; published_url?: string }
      if (!json.success) throw new Error(json.error ?? 'Publish failed')

      const result: DoneResult = {
        platform:     selectedPlatform,
        jobId:        draftResult.job_id,
        platformId:   draftResult.platform_id,
        publishedUrl: json.published_url ?? undefined,
      }
      setDoneResult(result)
      setPhase('done')
      onSuccess?.(selectedPlatform, result)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected error')
      setPhase('error')
    }
  }

  const handleReset = () => {
    setPhase('idle')
    setSelectedPlatform(null)
    setDraftResult(null)
    setErrorMsg(null)
    setDoneResult(null)
    setGscResult(null)
  }

  // P14.B.2 — Delete the remote WP/Shopify draft then reset UI.
  const handleRollback = async () => {
    if (!selectedPlatform || !draftResult || selectedPlatform === 'github') {
      handleReset()
      return
    }
    setRollingBack(true)
    try {
      const endpoint = selectedPlatform === 'wordpress'
        ? `/api/clients/${clientId}/cms/publish-wordpress`
        : `/api/clients/${clientId}/cms/publish-shopify`
      await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:      'rollback',
          job_id:      draftResult.job_id,
          platform_id: draftResult.platform_id,
        }),
      })
    } catch {
      // best-effort: always reset UI even if remote delete fails
    } finally {
      setRollingBack(false)
      handleReset()
    }
  }

  // P14.B.7: request GSC indexing for a published post URL
  const handleGscIndexing = async (publishedUrl: string) => {
    setGscIndexing(true)
    setGscResult(null)
    try {
      const res  = await fetch(`/api/clients/${clientId}/gsc/index-request`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: publishedUrl }),
      })
      const json = await res.json() as {
        success: boolean; url?: string; code?: string; error?: string; reauth_url?: string
      }
      if (json.success) {
        setGscResult({ ok: true, msg: '✅ 已提交 Google 收录请求 — Google 将在数小时内重新抓取' })
      } else if (json.code === 'NEEDS_REAUTH' || json.code === 'NO_OAUTH') {
        setGscResult({ ok: false, msg: '⚠️ Google 账户未授权索引 API，需重新连接', reauthUrl: json.reauth_url })
      } else {
        setGscResult({ ok: false, msg: `❌ ${json.error ?? '提交失败'}` })
      }
    } catch {
      setGscResult({ ok: false, msg: '❌ 网络错误，请稍后重试' })
    } finally {
      setGscIndexing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingProviders) {
    return <span className="text-xs text-gray-400">加载中…</span>
  }

  // P14.E.5: hard-block — show locked publish chip with tooltip.
  if (disabledReason) {
    return (
      <button
        type="button"
        disabled
        title={`Blocked: ${disabledReason}`}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 text-gray-500 cursor-not-allowed"
      >
        🚫 发布已锁定
      </button>
    )
  }

  if (connectedPlatforms.length === 0) {
    return (
      <span className="text-xs text-gray-400" title="在 Settings → 网站连接 中配置">
        无已连接平台
      </span>
    )
  }

  // Done state.
  if (phase === 'done' && doneResult) {
    if (doneResult.platform === 'github' && doneResult.prUrl) {
      return (
        <a href={doneResult.prUrl} target="_blank" rel="noopener noreferrer"
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-50 border border-green-300 text-green-700 hover:bg-green-100 transition-colors">
          ✓ 查看 PR #{doneResult.prNumber} →
        </a>
      )
    }

    // P14.B.7: for WP/Shopify posts that we know the published URL, offer GSC indexing.
    const publishedUrl = doneResult.publishedUrl ?? null

    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-green-600">
          ✓ 已发布到 {PLATFORM_LABELS[doneResult.platform]}
        </span>

        {/* GSC indexing button — only when we have the published URL */}
        {publishedUrl && !gscResult && (
          <button
            onClick={() => void handleGscIndexing(publishedUrl)}
            disabled={gscIndexing}
            className="self-start px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50 transition-colors"
          >
            {gscIndexing ? '提交中…' : '🔍 请求 Google 收录'}
          </button>
        )}

        {gscResult && (
          <div className={`text-xs px-3 py-2 rounded-lg border ${gscResult.ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
            {gscResult.msg}
            {gscResult.reauthUrl && (
              <a href={gscResult.reauthUrl} className="ml-2 underline font-medium">重新连接 Google →</a>
            )}
          </div>
        )}
      </div>
    )
  }

  // Draft-ready state: show preview link + confirm publish button.
  if (phase === 'draft_ready' && draftResult && selectedPlatform) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {draftResult.preview_url && (
          <a href={draftResult.preview_url} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 transition-colors">
            👁 预览草稿 →
          </a>
        )}
        <button onClick={() => void handlePublish()}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors">
          ✓ 确认发布到 {PLATFORM_LABELS[selectedPlatform]}
        </button>
        <button
          onClick={() => void handleRollback()}
          disabled={rollingBack}
          className="px-2 py-1.5 text-xs text-red-500 hover:text-red-700 disabled:opacity-40 transition-colors">
          {rollingBack ? '删除中…' : '🗑 删除草稿'}
        </button>
      </div>
    )
  }

  // Error state.
  if (phase === 'error') {
    return (
      <div className="flex flex-col gap-1.5 max-w-sm">
        <span className="text-xs text-red-600 leading-relaxed">
          ❌ {errorMsg}
        </span>
        <button onClick={handleReset}
          className="text-xs text-indigo-600 hover:underline self-start">
          重试
        </button>
      </div>
    )
  }

  // In-progress states.
  if (phase === 'drafting' || phase === 'publishing') {
    const label = phase === 'drafting' ? '创建草稿中…' : '发布中…'
    return (
      <span className="text-xs text-gray-500 animate-pulse">{label}</span>
    )
  }

  // P14.B.5: show keyword warning chip only when WordPress is available and keyword missing.
  const missingKeyword = !primaryKeyword && connectedPlatforms.includes('wordpress')

  // Idle: show platform selector.
  if (connectedPlatforms.length === 1) {
    const platform = connectedPlatforms[0]
    return (
      <div className="flex flex-col gap-1.5">
        {/* P12.R.A8 — theme uppercase precheck warning */}
        <ThemeUppercaseWarning clientId={clientId} enabled={platform === 'wordpress'} />
        {missingKeyword && platform === 'wordpress' && (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-orange-50 border border-orange-300 text-orange-700 rounded-md">
            ⚠️ 缺少焦点关键词 — Yoast SEO 字段将为空
          </span>
        )}
        <button onClick={() => void handleCreateDraft(platform)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors self-start">
          📤 发布到 {PLATFORM_LABELS[platform]}
        </button>
      </div>
    )
  }

  // Multiple platforms connected: show a dropdown-style set of buttons.
  return (
    <div className="flex flex-col gap-1.5">
      {/* P12.R.A8 — theme uppercase precheck warning */}
      <ThemeUppercaseWarning clientId={clientId} enabled={connectedPlatforms.includes('wordpress')} />
      {missingKeyword && (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-orange-50 border border-orange-300 text-orange-700 rounded-md">
          ⚠️ 缺少焦点关键词 — WordPress Yoast SEO 字段将为空
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500">发布到：</span>
        {connectedPlatforms.map(platform => (
          <button key={platform}
            onClick={() => void handleCreateDraft(platform)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 transition-colors">
            {PLATFORM_LABELS[platform]}
          </button>
        ))}
      </div>
    </div>
  )
}

const PLATFORM_LABELS: Record<Platform, string> = {
  wordpress: 'WordPress',
  shopify:   'Shopify',
  github:    'GitHub (PR)',
}
