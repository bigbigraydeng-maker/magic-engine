'use client'

/**
 * BrandAliasesPanel — FDE-managed brand alias list.
 *
 * Single write entry for clients.brand_aliases. Consumed by
 * @/lib/strategy/auto-fetch.ts:fetchBrandSearchVolume when resolving
 * Goal primary_metric `brand_search_volume` from GSC top_queries.
 *
 * Critical for multi-word brands ("CTS Tours" → GSC queries are "cts tours",
 * "china travel service nz" etc; domain root "ctstours" matches none of
 * them, leaving CTS with ~5 brand clicks instead of ~170).
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
  | { phase: 'ready';   aliases: string[] }

const MAX_ALIASES = 20

export function BrandAliasesPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/brand-aliases`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { aliases } = (await res.json()) as { aliases?: string[] }
      const list = aliases ?? []
      setState({ phase: 'ready', aliases: list })
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
      const aliases = draft
        .split(/\r?\n/)
        .map(a => a.trim())
        .filter(a => a.length > 0)

      const res = await fetch(`/api/clients/${clientId}/brand-aliases`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ aliases }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const { aliases: saved } = (await res.json()) as { aliases: string[] }
      setState({ phase: 'ready', aliases: saved })
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

  const currentCount = draft.split(/\r?\n/).filter(a => a.trim().length > 0).length
  const dirty        = draft.trim() !== state.aliases.join('\n').trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm text-slate-600">
          每行一个品牌词别名（带空格的多词形式也可以），最多 {MAX_ALIASES} 个。保存后统一小写、合并多余空白、去重，至少 2 字符。
        </p>
        <span className={`text-xs font-bold ${currentCount > MAX_ALIASES ? 'text-red-600' : 'text-slate-500'}`}>
          {currentCount} / {MAX_ALIASES}
        </span>
      </div>

      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={'cts tours\ncts travel\nchina travel service\nctsnz'}
        rows={Math.max(5, Math.min(12, currentCount + 1))}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
      />

      {errMsg && (
        <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving || currentCount > MAX_ALIASES}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(state.aliases.join('\n'))}
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
        别名用 substring 匹配 GSC top_queries 里的真实搜索词，命中即算品牌搜索。
        消费方：Goal 主指标 <code className="rounded bg-slate-100 px-1">brand_search_volume</code>（GSC clicks · 近 28 天）。
        留空时降级到域名根 + DataForSEO 估算。
      </p>
    </div>
  )
}
