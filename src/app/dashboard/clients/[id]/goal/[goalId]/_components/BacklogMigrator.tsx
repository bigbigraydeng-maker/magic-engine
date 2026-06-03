'use client'

/**
 * Phase 31 M3.5 — Backlog Migrator
 *
 * 嵌入 Goal 详情页底部。FDE 选若干 "Unassigned Backlog" 里的 actions，
 * 一键批量挂到一个 Initiative 下。
 *
 * 设计：默认收起 + 显示 backlog 总数，FDE 点开后才加载 actions 列表。
 */

import { useEffect, useState } from 'react'
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

  // On mount: prime count + actions so FDE sees the backlog total
  // (and can expand instantly). Without this, the section stays
  // "collapsed with no number" and is easy to miss.
  useEffect(() => {
    loadOnce()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, goal.id])

  function toggleExpand() {
    // First expand still triggers full action list load; count may already be set
    // by the mount-time effect above.
    if (!expanded && actions.length === 0) loadOnce()
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
    <div className="rounded-xl border border-status-exec/30 bg-status-exec/10 p-4">
      <button
        type="button"
        onClick={toggleExpand}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h3 className="text-sm font-black text-status-exec">
            ⚠️ Unassigned Backlog
            {count !== null && <span className="ml-2 rounded-full bg-status-exec/20 px-1.5 py-0.5 text-[10px] font-bold">{count}</span>}
          </h3>
          <p className="mt-0.5 text-[11px] font-semibold text-me-charcoal/55">
            老 actions 还未归类到 Initiative — FDE 选择性迁移到上方的 Initiative。
          </p>
        </div>
        <span className="text-xs text-me-charcoal/55">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          {loading && <p className="text-xs font-semibold text-me-charcoal/55">Loading backlog…</p>}

          {!loading && actions.length === 0 && (
            <p className="text-xs font-semibold text-me-charcoal/55">Backlog 已清空 — 不需要操作。</p>
          )}

          {actions.length > 0 && (
            <>
              <div className="max-h-72 divide-y divide-black/5 overflow-y-auto rounded-lg border border-black/10 bg-white">
                {actions.map(a => (
                  <label key={a.id} className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-me-ivory">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-me-charcoal">{a.title}</div>
                      <div className="mt-0.5 text-[10px] font-semibold text-me-charcoal/55">
                        {a.dimension} · {a.status}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-end gap-2 border-t border-black/10 pt-2">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] font-black uppercase tracking-wide text-me-charcoal/55">Migrate to Initiative</label>
                  <select
                    value={targetInitiativeId}
                    onChange={e => setTargetInitiativeId(e.target.value)}
                    className="w-full rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none"
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
                  className="rounded-lg bg-me-ochre px-4 py-1.5 text-xs font-black text-white transition-colors hover:bg-me-ochre/90 disabled:opacity-30"
                >
                  {migrating ? 'Migrating…' : `Migrate ${selectedIds.size}`}
                </button>
              </div>

              {error && <p className="text-xs font-semibold text-status-rej">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
