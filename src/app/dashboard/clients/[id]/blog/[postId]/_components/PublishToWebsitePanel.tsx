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
  clientId:  string
  postId:    string
  onSuccess?: (platform: Platform, result: DoneResult) => void
}

interface DoneResult {
  platform:   Platform
  prUrl?:     string
  prNumber?:  number
  jobId?:     string
  platformId?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PublishToWebsitePanel({ clientId, postId, onSuccess }: Props) {
  const [providers,        setProviders]        = useState<Providers | null>(null)
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null)
  const [phase,            setPhase]            = useState<PublishPhase>('idle')
  const [draftResult,      setDraftResult]      = useState<DraftResult | null>(null)
  const [errorMsg,         setErrorMsg]         = useState<string | null>(null)
  const [doneResult,       setDoneResult]       = useState<DoneResult | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res  = await fetch(`/api/clients/${clientId}/cms/providers`, {
          headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''}` },
        })
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

  const authHeader = { Authorization: `Bearer ${process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''}` }

  const handleCreateDraft = async (platform: Platform) => {
    setSelectedPlatform(platform)
    setPhase('drafting')
    setErrorMsg(null)

    try {
      if (platform === 'github') {
        // GitHub: single-step PR creation.
        const res  = await fetch(`/api/clients/${clientId}/cms/publish-blog`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
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
        headers: { 'Content-Type': 'application/json', ...authHeader },
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
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body:    JSON.stringify({
          action:      'publish',
          job_id:      draftResult.job_id,
          platform_id: draftResult.platform_id,
        }),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) throw new Error(json.error ?? 'Publish failed')

      const result: DoneResult = {
        platform:   selectedPlatform,
        jobId:      draftResult.job_id,
        platformId: draftResult.platform_id,
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
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingProviders) {
    return <span className="text-xs text-gray-400">加载中…</span>
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
    return (
      <span className="text-xs font-medium text-green-600">
        ✓ 已发布到 {PLATFORM_LABELS[doneResult.platform]}
      </span>
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
        <button onClick={handleReset}
          className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700">
          取消
        </button>
      </div>
    )
  }

  // Error state.
  if (phase === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-600 max-w-xs truncate" title={errorMsg ?? ''}>
          ❌ {errorMsg}
        </span>
        <button onClick={handleReset}
          className="text-xs text-indigo-600 hover:underline">
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

  // Idle: show platform selector.
  if (connectedPlatforms.length === 1) {
    const platform = connectedPlatforms[0]
    return (
      <button onClick={() => void handleCreateDraft(platform)}
        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors">
        📤 发布到 {PLATFORM_LABELS[platform]}
      </button>
    )
  }

  // Multiple platforms connected: show a dropdown-style set of buttons.
  return (
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
  )
}

const PLATFORM_LABELS: Record<Platform, string> = {
  wordpress: 'WordPress',
  shopify:   'Shopify',
  github:    'GitHub (PR)',
}
