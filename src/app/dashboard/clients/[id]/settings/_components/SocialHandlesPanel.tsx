'use client'

/**
 * SocialHandlesPanel — FDE-managed social platform identifiers.
 *
 * Single write entry for clients.{instagram_handle, facebook_page_url,
 * tiktok_handle}. Consumed by src/lib/diagnostic/collectors/social-collector.ts
 * to drive the `social` diagnostic dimension.
 *
 * When all three are null the collector returns score=null and the run lists
 * `social` in dimensions_skipped — that's why every client across the
 * platform was missing social score until this panel + matching API route
 * landed. Configure at least one to make the dimension produce a real score.
 *
 * Independent fields (not a chip+input list like CompetitorDomains) — uses a
 * 3-row form. Mirrors GbpPanel's load/error/ready three-state pattern.
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface Handles {
  instagram_handle:   string | null
  facebook_page_url:  string | null
  tiktok_handle:      string | null
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   handles: Handles }

export function SocialHandlesPanel({ clientId }: Props) {
  const [state,    setState]    = useState<PanelState>({ phase: 'loading' })
  const [draft,    setDraft]    = useState<Handles>({
    instagram_handle:  '',
    facebook_page_url: '',
    tiktok_handle:     '',
  } as unknown as Handles)
  const [saving,   setSaving]   = useState(false)
  const [savedAt,  setSavedAt]  = useState<string | null>(null)
  const [errMsg,   setErrMsg]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/social-handles`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Handles
      setState({ phase: 'ready', handles: data })
      setDraft({
        instagram_handle:  data.instagram_handle  ?? '',
        facebook_page_url: data.facebook_page_url ?? '',
        tiktok_handle:     data.tiktok_handle     ?? '',
      } as unknown as Handles)
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/social-handles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instagram_handle:  draft.instagram_handle  || null,
          facebook_page_url: draft.facebook_page_url || null,
          tiktok_handle:     draft.tiktok_handle     || null,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(error)
      }
      const fresh = (await res.json()) as Handles & { success: boolean }
      setState({ phase: 'ready', handles: fresh })
      setSavedAt(new Date().toLocaleTimeString('zh-CN'))
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const isDirty =
    state.phase === 'ready' &&
    ((draft.instagram_handle  || null) !== state.handles.instagram_handle  ||
     (draft.facebook_page_url || null) !== state.handles.facebook_page_url ||
     (draft.tiktok_handle     || null) !== state.handles.tiktok_handle)

  // ── Loading ─────────────────────────────────────────────────────────────
  if (state.phase === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
        正在加载社媒账号…
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-bold">加载失败</p>
        <p>{state.message}</p>
        <button onClick={load} className="mt-2 font-medium underline">
          重试
        </button>
      </div>
    )
  }

  // ── Ready ────────────────────────────────────────────────────────────────
  const configuredCount =
    (state.handles.instagram_handle  ? 1 : 0) +
    (state.handles.facebook_page_url ? 1 : 0) +
    (state.handles.tiktok_handle     ? 1 : 0)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="text-xs text-slate-500">
          配置后驱动诊断引擎的「社媒」维度评分。至少配置一个平台才能让 social 维度产出真实分数。
        </p>
        <span
          className={[
            'flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
            configuredCount === 0
              ? 'border border-amber-200 bg-amber-50 text-amber-700'
              : 'border border-emerald-200 bg-emerald-50 text-emerald-700',
          ].join(' ')}
        >
          {configuredCount} / 3 已配置
        </span>
      </div>

      <div className="space-y-4">
        {/* Instagram */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            Instagram 用户名
          </label>
          <input
            type="text"
            value={draft.instagram_handle ?? ''}
            onChange={e => setDraft(d => ({ ...d, instagram_handle: e.target.value } as Handles))}
            placeholder="例：ctstours （不需要 @）"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            disabled={saving}
          />
          <p className="mt-1 text-xs text-slate-400">仅字母数字 . _ -，最长 64 字符</p>
        </div>

        {/* Facebook */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            Facebook 主页 URL
          </label>
          <input
            type="url"
            value={draft.facebook_page_url ?? ''}
            onChange={e => setDraft(d => ({ ...d, facebook_page_url: e.target.value } as Handles))}
            placeholder="例：https://facebook.com/ctstours"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            disabled={saving}
          />
          <p className="mt-1 text-xs text-slate-400">完整的 https:// URL</p>
        </div>

        {/* TikTok */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
            TikTok 用户名
          </label>
          <input
            type="text"
            value={draft.tiktok_handle ?? ''}
            onChange={e => setDraft(d => ({ ...d, tiktok_handle: e.target.value } as Handles))}
            placeholder="例：ctstours_nz （不需要 @）"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            disabled={saving}
          />
          <p className="mt-1 text-xs text-slate-400">仅字母数字 . _ -，最长 64 字符</p>
        </div>
      </div>

      {/* Save row */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {savedAt && !isDirty && (
            <span className="text-emerald-700">
              ✓ 已保存 · {savedAt}
            </span>
          )}
          {errMsg && (
            <span className="text-red-700">⚠ {errMsg}</span>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
