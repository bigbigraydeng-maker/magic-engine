'use client'

/**
 * Phase 31 M3.5 — Backlog Migrator
 *
 * 嵌入 Goal 详情页底部。FDE 选若干 "Unassigned Backlog" 里的 actions，
 * 一键批量挂到一个 Initiative 下。
 *
 * 设计：默认收起 + 显示 backlog 总数，FDE 点开后才加载 actions 列表。
 */

import { useState } from 'react'
import type { InitiativeRow, GoalRow } from '@/types/strategy'

interface BacklogAction {
  id: string
  title: string
  dimension: string
  status: string
  created_at: string
}

interface Props {
  clientId: string
  goal: GoalRow
}

export function BacklogMigrator({ clientId, goal }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [actions, setActions] = useState<BacklogAction[]>([])
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [targetInitiativeId, setTargetInitiativeId] = useState('')
  const [terminals, setTerminals] = useState<InitiativeRow[]>([])
  const [migrating, setMigrating] = useState(false)
  const [error, setError] = useState('')

  async function loadOnce() {
    setLoading(true)
    try {
      const [actionsRes, initsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/unassigned-actions`),
        fetch(`/api/goals/${goal.id}/initiatives`),
      ])
      const actionsJson = await actionsRes.json()
      const initsJson = await initsRes.json()
      setActions(actionsJson.actions ?? [])
      setCount(actionsJson.count ?? 0)
      // Only show non-unassigned initiatives as migration targets
      setTerminals((initsJson.initiatives ?? []).filter((i: InitiativeRow) => i.initiative_type !== 'unassigned'))
    } finally {
      setLoading(false)
    }
  }

  function toggleExpand() {
    if (!expanded && count === null) loadOnce()
    setExpanded(!expanded)
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedIds(next)
  }

  async function handleMigrate() {
    if (selectedIds.size === 0 || !targetInitiativeId) return
    setMigrating(true)
    setError('')
    try {
      const res = await fetch(`/api/initiatives/${targetInitiativeId}/bulk-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execution_item_ids: Array.from(selectedIds) }),
      })
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Migrate failed')
        return
      }
      const j = await res.json()
      alert(`Migrated ${j.updated_count} action(s). Skipped: ${j.skipped_count}`)
      setSelectedIds(new Set())
      setTargetInitiativeId('')
      await loadOnce()
    } finally {
      setMigrating(false)
    }
  }

  // Hide entirely when no backlog exists (count === 0)
  if (count === 0) return null

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
      <button
        type="button"
        onClick={toggleExpand}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-amber-300">
            ⚠️ Unassigned Backlog
            {count !== null && <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px]">{count}</span>}
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            老 actions 还未归类到 Initiative — FDE 选择性迁移到上方的 Initiative。
          </p>
        </div>
        <span className="text-slate-500 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {loading && <p className="text-xs text-slate-500">Loading backlog…</p>}

          {!loading && actions.length === 0 && (
            <p className="text-xs text-slate-500">Backlog 已清空 — 不需要操作。</p>
          )}

          {actions.length > 0 && (
            <>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-white/5 bg-slate-900/40 divide-y divide-white/5">
                {actions.map(a => (
                  <label key={a.id} className="flex items-start gap-3 px-3 py-2 hover:bg-white/[0.03] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-slate-200 truncate">{a.title}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {a.dimension} · {a.status}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-end gap-2 pt-2 border-t border-white/10">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-slate-500">Migrate to Initiative</label>
                  <select
                    value={targetInitiativeId}
                    onChange={e => setTargetInitiativeId(e.target.value)}
                    className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-1.5 text-xs text-white"
                  >
                    <option value="">— Choose target initiative —</option>
                    {terminals.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.title} ({t.tier})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleMigrate}
                  disabled={migrating || selectedIds.size === 0 || !targetInitiativeId}
                  className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-30 px-4 py-1.5 text-xs font-medium text-white"
                >
                  {migrating ? 'Migrating…' : `Migrate ${selectedIds.size}`}
                </button>
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
