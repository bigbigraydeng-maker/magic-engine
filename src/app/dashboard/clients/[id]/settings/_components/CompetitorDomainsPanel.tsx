'use client'

/**
 * CompetitorDomainsPanel — FDE-managed competitor domain list.
 *
 * Single write entry for clients.competitor_domains. Consumed downstream by
 * SEO Intelligence (gap analysis), AI Tracker (question generation), GEO
 * Composer, CompetitorSnapshotAdapter (weekly traffic snapshot), and future
 * Competitor Monitor module — all via @/lib/competitors/resolver.
 *
 * Phase A — competitor configuration follow-up (2026-06-04).
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   domains: string[] }

const MAX_DOMAINS = 20

export function CompetitorDomainsPanel({ clientId }: Props) {
  const [state,      setState]      = useState<PanelState>({ phase: 'loading' })
  const [draft,      setDraft]      = useState('')
  const [saving,     setSaving]     = useState(false)
  const [savedAt,    setSavedAt]    = useState<string | null>(null)
  const [errMsg,     setErrMsg]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/competitor-domains`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { domains } = (await res.json()) as { domains?: string[] }
      const list = domains ?? []
      setState({ phase: 'ready', domains: list })
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
      const domains = draft
        .split(/\r?\n/)
        .map(d => d.trim())
        .filter(d => d.length > 0)

      const res = await fetch(`/api/clients/${clientId}/competitor-domains`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ domains }),
      })

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }

      const { domains: saved } = (await res.json()) as { domains: string[] }
      setState({ phase: 'ready', domains: saved })
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

  const currentCount = draft.split(/\r?\n/).filter(d => d.trim().length > 0).length
  const dirty        = draft.trim() !== state.domains.join('\n').trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm text-slate-600">
          每行一个域名，最多 {MAX_DOMAINS} 个。保存后自动去除 <code className="rounded bg-slate-100 px-1 text-xs">https://</code>、尾部斜杠、统一小写。
        </p>
        <span className={`text-xs font-bold ${currentCount > MAX_DOMAINS ? 'text-red-600' : 'text-slate-500'}`}>
          {currentCount} / {MAX_DOMAINS}
        </span>
      </div>

      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={'theflooringguys.com.au\ncarpetcourt.com.au\nfloorworld.com.au'}
        rows={Math.max(5, Math.min(12, currentCount + 1))}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
      />

      {errMsg && (
        <p className="mt-2 text-xs text-red-600">⚠ {errMsg}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={!dirty || saving || currentCount > MAX_DOMAINS}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {dirty && !saving && (
          <button
            onClick={() => setDraft(state.domains.join('\n'))}
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
        该列表为最高优先级，覆盖 Brand Brief 推断和 DataForSEO 自动发现。
        消费方：SEO Intelligence · AI Tracker · GEO Composer · 飞轮竞品快照 · 未来 Competitor Monitor。
      </p>
    </div>
  )
}
