'use client'

/**
 * ExcludedTopicsPanel — FDE-managed list of product categories this client does NOT sell.
 *
 * Writes to master_briefs.excluded_topics (active brief) via excluded-topics API route.
 * Consumed by competitors-gap to filter gap keywords so irrelevant categories
 * (e.g. shutters/blinds for a flooring-only retailer) don't fill the 100-slot results.
 *
 * Mirrors PrimaryKeywordsPanel.tsx pattern.
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   topics: string[] }

const MAX_TOPICS = 30

export function ExcludedTopicsPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/excluded-topics`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { topics } = (await res.json()) as { topics?: string[] }
      const list = topics ?? []
      setState({ phase: 'ready', topics: list })
      setDraft(list.join('\n'))
    } catch (err) {
      setState({
        phase:   'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      const topics = draft
        .split(/\r?\n/)
        .map(t => t.trim())
        .filter(t => t.length > 0)

      const res = await fetch(`/api/clients/${clientId}/excluded-topics`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ topics }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const { topics: saved } = (await res.json()) as { topics: string[] }
      setState({ phase: 'ready', topics: saved })
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

  const currentCount = draft.split(/\r?\n/).filter(t => t.trim().length > 0).length
  const dirty        = draft.trim() !== state.topics.join('\n').trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm text-slate-600">
          每行填一个品类词根（单数），系统自动匹配复数形式。最多 {MAX_TOPICS} 条。
        </p>
        <span className={`text-xs font-bold ${currentCount > MAX_TOPICS ? 'text-red-600' : 'text-slate-500'}`}>
          {currentCount} / {MAX_TOPICS}
        </span>
      </div>

      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={'shutter\nblind\ncurtain\nplantation\nwindow treatment'}
        rows={Math.max(4, Math.min(10, currentCount + 1))}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
      />

      {errMsg && (
        <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving || currentCount > MAX_TOPICS}
          className="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(state.topics.join('\n'))}
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
        填写客户<strong>不卖</strong>的品类词根，竞品关键词 gap 分析会自动排除这些词。
        例：Oztop 只卖地板，填 shutter / blind / curtain → gap 词不再出现 shutters 系列。
        数据存在 Brand Brief（active）的 <code>excluded_topics</code> 字段。
      </p>
    </div>
  )
}
