'use client'

/**
 * WeeklyBlogPanel — per-client weekly auto-blog switch (22.E.S16).
 *
 * Single write entry for clients.seo_config.weekly_blog via
 * /api/clients/[id]/seo-config. Consumed by the blog-weekly cron
 * (Tuesday 03:00 UTC): one auto-topic draft per week, review-gated —
 * the switch controls generation only, never publishing.
 *
 * Mirrors BrandAliasesPanel.tsx.
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; weeklyBlog: boolean }

export function WeeklyBlogPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/seo-config`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { config } = (await res.json()) as { config?: { weekly_blog?: boolean } }
      setState({ phase: 'ready', weeklyBlog: config?.weekly_blog === true })
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleToggle = async (next: boolean) => {
    if (state.phase !== 'ready') return
    setSaving(true)
    setErrMsg(null)
    // 乐观更新：先翻开关，失败再回退
    const prev = state.weeklyBlog
    setState({ phase: 'ready', weeklyBlog: next })
    try {
      const res = await fetch(`/api/clients/${clientId}/seo-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekly_blog: next }),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
    } catch (err) {
      setState({ phase: 'ready', weeklyBlog: prev })
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={load}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-800">每周自动出 1 篇 Blog 草稿</p>
          <p className="mt-1 text-xs text-slate-500">
            每周二自动选题（AI 可见度弱项 × 关键词机会）并生成草稿。
            草稿只进 Blog Studio 等审核，<span className="font-bold">不会自动发布</span>。
            近 7 天内已有文章时自动跳过（生成失败的不算）。
          </p>
        </div>
        <button
          role="switch"
          aria-checked={state.weeklyBlog}
          disabled={saving}
          onClick={() => handleToggle(!state.weeklyBlog)}
          className={`relative ml-4 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            state.weeklyBlog ? 'bg-cyan-600' : 'bg-slate-300'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              state.weeklyBlog ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {errMsg && <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>}
    </div>
  )
}
