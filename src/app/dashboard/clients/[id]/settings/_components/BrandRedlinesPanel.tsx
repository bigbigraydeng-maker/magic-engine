'use client'

/**
 * BrandRedlinesPanel — FDE-managed brand redline phrase list.
 *
 * Single write entry for clients.brand_redline_phrases. Consumed by the
 * P21.J content factory strategist (闸 1 副闸): signal text or angle
 * candidates containing any phrase here are rejected (`brand_redline_hit`)
 * before a work order is created. Matching is case-insensitive substring —
 * phrases here are "forbidden claims" (e.g. "Auckland since 1928"), not
 * excluded product categories (that's ExcludedTopicsPanel).
 *
 * Mirrors PrimaryKeywordsPanel.tsx.
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   phrases: string[] }

const MAX_PHRASES = 50

export function BrandRedlinesPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/brand-redlines`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { phrases } = (await res.json()) as { phrases?: string[] }
      const list = phrases ?? []
      setState({ phase: 'ready', phrases: list })
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
      const phrases = draft
        .split(/\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0)

      const res = await fetch(`/api/clients/${clientId}/brand-redlines`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phrases }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const { phrases: saved } = (await res.json()) as { phrases: string[] }
      setState({ phase: 'ready', phrases: saved })
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

  const currentCount = draft.split(/\r?\n/).filter(p => p.trim().length > 0).length
  const dirty        = draft.trim() !== state.phrases.join('\n').trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm text-slate-600">
          每行一条红线短语，最多 {MAX_PHRASES} 条。内容工厂在出工单前扫描信号与角度文本，
          命中任意一条即拒单（大小写不敏感）。
        </p>
        <span className={`text-xs font-bold ${currentCount > MAX_PHRASES ? 'text-red-600' : 'text-slate-500'}`}>
          {currentCount} / {MAX_PHRASES}
        </span>
      </div>

      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={'Auckland since 1928\nsince 1928\n1928 heritage'}
        rows={Math.max(5, Math.min(12, currentCount + 1))}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
      />

      {errMsg && (
        <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving || currentCount > MAX_PHRASES}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(state.phrases.join('\n'))}
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
        与「排除品类词」的区别：红线是禁止出现的品牌表述（误导性口径），
        排除品类词是不做的产品类目。消费方：内容工厂 strategist（闸 1）。
      </p>
    </div>
  )
}
