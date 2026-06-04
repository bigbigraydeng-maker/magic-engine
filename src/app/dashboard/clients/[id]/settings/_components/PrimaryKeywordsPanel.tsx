'use client'

/**
 * PrimaryKeywordsPanel — FDE-managed primary keyword list.
 *
 * Single write entry for clients.primary_keywords. Will be consumed downstream
 * by SEO Intelligence (main metrics), AI Tracker (question generation), GEO
 * Composer, Blog topic selection — all via @/lib/keywords/resolver.
 *
 * Mirrors CompetitorDomainsPanel.tsx.
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   keywords: string[] }

const MAX_KEYWORDS = 20

export function PrimaryKeywordsPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/primary-keywords`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { keywords } = (await res.json()) as { keywords?: string[] }
      const list = keywords ?? []
      setState({ phase: 'ready', keywords: list })
      setDraft(list.join('\n'))
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      const keywords = draft
        .split(/\r?\n/)
        .map(k => k.trim())
        .filter(k => k.length > 0)

      const res = await fetch(`/api/clients/${clientId}/primary-keywords`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ keywords }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const { keywords: saved } = (await res.json()) as { keywords: string[] }
      setState({ phase: 'ready', keywords: saved })
      setDraft(saved.join('\n'))
      setSavedAt(new Date().toLocaleTimeString())
    } catch (err) {
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

  const currentCount = draft.split(/\r?\n/).filter(k => k.trim().length > 0).length
  const dirty        = draft.trim() !== state.keywords.join('\n').trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm text-slate-600">
          每行一个关键词，最多 {MAX_KEYWORDS} 个。保存后自动统一小写、去除前后空白。
        </p>
        <span className={`text-xs font-bold ${currentCount > MAX_KEYWORDS ? 'text-red-600' : 'text-slate-500'}`}>
          {currentCount} / {MAX_KEYWORDS}
        </span>
      </div>

      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={'flooring\nvinyl flooring\ncarpet\ntiles'}
        rows={Math.max(5, Math.min(12, currentCount + 1))}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
      />

      {errMsg && (
        <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving || currentCount > MAX_KEYWORDS}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(state.keywords.join('\n'))}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            撤销修改
          </button>
        )}
        {!dirty && savedAt && (
          <span className="text-xs text-emerald-600">✓ 已保存（{savedAt}）</span>
        )}
      </div>

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        该列表为最高优先级，覆盖 Brand Brief 的 keyword_seeds 推断。
        消费方（迁移中）：SEO Intelligence · AI Tracker · GEO Composer · Blog 选题。
      </p>
    </div>
  )
}
