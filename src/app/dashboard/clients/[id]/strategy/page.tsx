'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type {
  ContentStrategyItem,
  StrategyActionType,
  StrategyContentMode,
  StrategyPriority,
  StrategyStatus,
} from '@/types/magic-engine'

const ACTION_LABEL: Record<StrategyActionType, string> = {
  upgrade_page: '🔄 升级现有页面',
  new_blog: '✨ 新建博客',
  social_content: '📱 社媒内容',
}

const MODE_LABEL: Record<StrategyContentMode, string> = {
  unified: 'Unified (SEO×GEO)',
  geo_only: 'GEO only',
  seo_only: 'SEO only',
}

const PRIORITY_COLORS: Record<StrategyPriority, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-amber-100 text-amber-700 border-amber-200',
  medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
}

const STATUS_COLORS: Record<StrategyStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  approved: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-purple-100 text-purple-700',
  done: 'bg-emerald-100 text-emerald-700',
  dismissed: 'bg-gray-100 text-gray-400 line-through',
}

interface RunSummary {
  candidates_generated: number
  strategy_run_id: string
  unified_count: number
  geo_only_count: number
  seo_only_count: number
  upgrade_pages: number
  new_blogs: number
}

/**
 * /dashboard/clients/[id]/strategy
 *
 * 3D content strategy panel — see ROADMAP.md P8.D.1.6.
 */
export default function StrategyPage() {
  const params = useParams()
  const clientId = params.id as string

  const [items, setItems] = useState<ContentStrategyItem[]>([])
  const [counts, setCounts] = useState<Partial<Record<StrategyStatus, number>>>({})
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StrategyStatus | ''>('')
  const [actionFilter, setActionFilter] = useState<StrategyActionType | ''>('')
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [actionMsg, setActionMsg] = useState('')
  const [actionOk, setActionOk] = useState<boolean | null>(null)
  const [clientName, setClientName] = useState('')

  const flash = (msg: string, ok: boolean) => {
    setActionMsg(msg)
    setActionOk(ok)
    setTimeout(() => {
      setActionMsg('')
      setActionOk(null)
    }, 6000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (statusFilter) sp.set('status', statusFilter)
      if (actionFilter) sp.set('action_type', actionFilter)
      const res = await fetch(`/api/clients/${clientId}/strategy?${sp.toString()}`)
      if (res.ok) {
        const j = await res.json()
        setItems(j.items ?? [])
        setCounts(j.status_counts ?? {})
      }
    } finally {
      setLoading(false)
    }
  }, [clientId, statusFilter, actionFilter])

  const loadClient = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}`)
      if (res.ok) {
        const j = await res.json()
        setClientName(j.client?.name ?? clientId)
      }
    } catch {}
  }, [clientId])

  useEffect(() => {
    loadClient()
  }, [loadClient])

  useEffect(() => {
    load()
  }, [load])

  async function runAnalysis() {
    if (running) return
    setRunning(true)
    setSummary(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/strategy/generate`, {
        method: 'POST',
      })
      const j = await res.json()
      if (!res.ok || !j.success) {
        flash(j.error ?? '分析失败', false)
        return
      }
      setSummary(j.summary as RunSummary)
      flash(`分析完成：生成 ${j.summary.candidates_generated} 条策略机会`, true)
      await load()
    } catch (err) {
      flash((err as Error).message, false)
    } finally {
      setRunning(false)
    }
  }

  async function patchStatus(itemId: string, status: StrategyStatus) {
    // optimistic
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, status } : i)))
    try {
      const res = await fetch(`/api/clients/${clientId}/strategy/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        flash(j.error ?? '更新失败', false)
        await load()
      }
    } catch (err) {
      flash((err as Error).message, false)
      await load()
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link
          href={`/dashboard/clients/${clientId}`}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          ← {clientName || clientId}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">📋 Content Strategy</h1>
        <p className="text-sm text-slate-500 mt-1">
          基于 AI Tracker 弱项 × 关键词缺口 × 站点内容快照三维交叉的策略建议
        </p>
      </div>

      {actionMsg && (
        <div
          className={`mb-3 px-3 py-2 rounded text-sm ${
            actionOk
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {actionMsg}
        </div>
      )}

      {/* Status counts */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {(['pending', 'approved', 'in_progress', 'done', 'dismissed'] as StrategyStatus[]).map(
          (s) => (
            <div
              key={s}
              className="bg-white border rounded p-3 text-center cursor-pointer hover:shadow-sm"
              onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            >
              <div
                className={`text-xs uppercase tracking-wide ${
                  statusFilter === s ? 'text-indigo-600 font-semibold' : 'text-slate-500'
                }`}
              >
                {s}
              </div>
              <div className="text-2xl font-semibold mt-1 tabular-nums">
                {counts[s] ?? 0}
              </div>
            </div>
          )
        )}
      </div>

      {/* Run panel */}
      <div className="bg-white border rounded-lg p-4 mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={runAnalysis}
          disabled={running}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
        >
          {running ? '分析中…' : '⚡ Generate Strategy'}
        </button>
        <span className="text-xs text-slate-500">
          需先完成 Site Audit + 至少跑过一次 AI Tracker
        </span>
        {summary && (
          <span className="text-xs text-slate-700 ml-auto">
            最新 run：{summary.candidates_generated} 条 ·{' '}
            unified {summary.unified_count} / geo {summary.geo_only_count} / seo{' '}
            {summary.seo_only_count}
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as StrategyActionType | '')}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="">All actions</option>
          <option value="upgrade_page">🔄 Upgrade page</option>
          <option value="new_blog">✨ New blog</option>
          <option value="social_content">📱 Social</option>
        </select>
        {statusFilter && (
          <button
            onClick={() => setStatusFilter('')}
            className="text-xs text-slate-500 underline"
          >
            清除状态筛选
          </button>
        )}
        <span className="text-xs text-slate-500 ml-auto">
          显示 {items.length} 条
        </span>
      </div>

      {/* Items list */}
      <div className="bg-white border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            还没有策略建议。点击 ⚡ Generate Strategy 触发一次分析。
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((it) => (
              <li key={it.id} className="p-4 hover:bg-slate-50">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                    {ACTION_LABEL[it.action_type]}
                  </span>
                  <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">
                    {MODE_LABEL[it.content_mode]}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded border ${PRIORITY_COLORS[it.priority]}`}
                  >
                    {it.priority} · {Math.round(it.priority_score)}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded ml-auto ${STATUS_COLORS[it.status]}`}>
                    {it.status}
                  </span>
                </div>
                <div className="font-medium text-slate-800">
                  {it.proposed_title || '(no title)'}
                </div>
                {it.rationale && (
                  <div className="text-sm text-slate-600 mt-1">{it.rationale}</div>
                )}
                <div className="text-xs text-slate-500 mt-2 flex flex-wrap gap-3">
                  {it.source_keyword && (
                    <span>
                      🔑 <strong>{it.source_keyword}</strong>
                      {it.keyword_volume != null && ` · vol ${it.keyword_volume}`}
                      {it.keyword_kd != null && ` · KD ${it.keyword_kd}`}
                    </span>
                  )}
                  {it.source_query_id && <span>🤖 query #{it.source_query_id.slice(0, 8)}</span>}
                  {it.source_page_id && <span>📄 page #{it.source_page_id.slice(0, 8)}</span>}
                </div>
                {it.status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => patchStatus(it.id, 'approved')}
                      className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => patchStatus(it.id, 'dismissed')}
                      className="text-xs px-3 py-1 border border-slate-300 hover:bg-slate-100 rounded text-slate-600"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
