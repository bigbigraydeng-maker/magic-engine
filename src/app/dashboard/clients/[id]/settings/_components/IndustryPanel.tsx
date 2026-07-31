'use client'

/**
 * IndustryPanel — FDE-managed clients.industry.
 *
 * Single write entry for the field that decides whether this client's agents
 * read industry-scoped cross-client lessons (lib/memory/service.ts >
 * loadGlobalLessons). Empty or free-text values silently match nothing, so the
 * panel calls that out instead of just showing a blank select.
 *
 * Mirrors BrandAliasesPanel.tsx.
 */

import { useState, useEffect, useCallback } from 'react'
import { INDUSTRY_OPTIONS, industryLabel } from '@/lib/clients/industries'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   industry: string | null; isKnown: boolean }

export function IndustryPanel({ clientId }: Props) {
  const [state,   setState]   = useState<PanelState>({ phase: 'loading' })
  const [draft,   setDraft]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg,  setErrMsg]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/industry`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { industry, is_known } = (await res.json()) as {
        industry?: string | null
        is_known?: boolean
      }
      const value   = industry ?? null
      const isKnown = is_known ?? false
      setState({ phase: 'ready', industry: value, isKnown })
      // 存量自由文本不预选进下拉（它不是合法选项），让 FDE 明确挑一个
      setDraft(isKnown && value ? value : '')
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
      const res = await fetch(`/api/clients/${clientId}/industry`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ industry: draft === '' ? null : draft }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const { industry: saved } = (await res.json()) as { industry: string | null }
      setState({ phase: 'ready', industry: saved, isKnown: saved !== null })
      setDraft(saved ?? '')
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

  const dirty      = draft !== (state.isKnown && state.industry ? state.industry : '')
  const needsFixup = state.industry !== null && !state.isKnown

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        决定这个客户的 AI 能不能读到<strong>同行踩过的坑</strong>。没选行业 → 只读得到全行业通用经验。
      </p>

      {state.industry === null && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ 还没选行业 —— 本行业的经验一条都读不到。
        </p>
      )}

      {needsFixup && (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          当前存的是旧的自由填写值「<strong>{industryLabel(state.industry)}</strong>」，
          它匹配不上行业经验（通用经验不受影响）。改成正式分类可以让 AI 多读到同行的坑；
          <strong>但这段描述文字同时被关键词工具当作业务线索用</strong>，覆盖前请确认不需要它。
        </p>
      )}

      <select
        value={draft}
        onChange={e => setDraft(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
      >
        <option value="">— 未选择 —</option>
        {INDUSTRY_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {errMsg && (
        <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(state.isKnown && state.industry ? state.industry : '')}
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
        消费方：所有 agent 的记忆注入（发现 / 诊断 / 处方 / 每日建议 / 内容生成）。
        行业相符时会额外读到 <code className="rounded bg-slate-100 px-1">global_learned_lessons</code> 里
        标着同行业的经验；全行业通用的经验则不受此项影响，始终注入。
      </p>
    </div>
  )
}
