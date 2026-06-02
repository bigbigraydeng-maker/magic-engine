'use client'

/**
 * Phase 31 M3 — Initiative 列表 + 配置弹窗
 *
 * 嵌入 Goal 详情页，替代之前的 "Initiative configuration coming in M3" 占位。
 *
 * Features:
 *   - 列出该 Goal 下的所有 Initiative（按 sort_order）
 *   - "+ Add Initiative" 按钮打开配置弹窗
 *   - 点 Initiative 卡片打开编辑（同一弹窗）
 *   - 显示总预算 % 余量
 *   - "Archive" 按钮
 */

import { useCallback, useEffect, useState } from 'react'
import type {
  InitiativeRow,
  InitiativeType,
  InitiativePosture,
  GoalRow,
} from '@/types/strategy'
import { INITIATIVE_TYPE_LABEL, INITIATIVE_TYPE_TIER } from '@/types/strategy'
import { InitiativeFormDrawer } from './InitiativeFormDrawer'

const ALL_INITIATIVE_TYPES: InitiativeType[] = [
  'demand_generation',
  'conversion_optimization',
  'trust_building',
  'competitive_defense',
  'market_education',
  'content_asset_production',
]

const TIER_COLOR: Record<string, string> = {
  terminal: 'bg-me-ochre/15 text-me-ochre',
  supporting: 'bg-status-sched/15 text-status-sched',
}

const POSTURE_COLOR: Record<string, string> = {
  offensive: 'bg-status-rej/15 text-status-rej',
  defensive: 'bg-status-track/15 text-status-track',
  fast:      'bg-status-exec/15 text-status-exec',
  slow:      'bg-me-stone text-me-charcoal/55',
}

interface Props {
  goal: GoalRow
  canEdit: boolean   // false when goal status is archived/expired
}

export function InitiativeList({ goal, canEdit }: Props) {
  const [items, setItems] = useState<InitiativeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<InitiativeRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/goals/${goal.id}/initiatives`)
      if (!res.ok) return
      const j = await res.json()
      setItems(j.initiatives ?? [])
    } finally {
      setLoading(false)
    }
  }, [goal.id])

  useEffect(() => { load() }, [load])

  // Hide the migration placeholder bucket from the list
  const realInitiatives = items.filter(i => i.initiative_type !== 'unassigned')

  const totalBudgetPct = realInitiatives.reduce((s, i) => s + (i.budget_percent ?? 0), 0)
  const remainingBudgetPct = Math.max(0, 100 - totalBudgetPct)

  const terminalInitiatives = realInitiatives.filter(i => i.tier === 'terminal')

  async function handleArchive(id: string) {
    if (!confirm('Archive this initiative? Its actions remain visible under archived items.')) return
    const res = await fetch(`/api/initiatives/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const j = await res.json()
      alert(`Archive failed: ${j.error}`)
      return
    }
    load()
  }

  return (
    <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-base font-bold text-me-charcoal">Initiatives</h3>
          <p className="mt-0.5 text-xs font-semibold text-me-charcoal/55">
            {realInitiatives.length} initiative(s) · {totalBudgetPct.toFixed(0)}% of budget allocated · {remainingBudgetPct.toFixed(0)}% remaining
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => { setEditing(null); setDrawerOpen(true) }}
            className="rounded-lg bg-me-ochre px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre/90"
          >
            + Add Initiative
          </button>
        )}
      </div>

      {loading && <p className="text-sm font-semibold text-me-charcoal/55">Loading…</p>}

      {!loading && realInitiatives.length === 0 && (
        <div className="rounded-lg border border-dashed border-black/15 bg-me-ivory p-6 text-center">
          <p className="text-sm font-semibold text-me-charcoal/55">
            No initiatives yet. Add 2-5 initiatives spanning multiple workstreams to drive this goal.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {realInitiatives.map(item => {
          const label = INITIATIVE_TYPE_LABEL[item.initiative_type]
          const tier = INITIATIVE_TYPE_TIER[item.initiative_type]
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => canEdit ? (setEditing(item), setDrawerOpen(true)) : null}
              className={`w-full rounded-lg border border-black/10 bg-white p-4 text-left transition-colors hover:border-me-ochre/40 hover:bg-me-ivory ${
                canEdit ? 'cursor-pointer' : 'cursor-default'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-me-charcoal">{item.title}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TIER_COLOR[tier]}`}>
                      {tier}
                    </span>
                    {item.posture && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${POSTURE_COLOR[item.posture]}`}>
                        {item.posture}
                      </span>
                    )}
                    {item.hypothesis_polished_by_ai && (
                      <span className="rounded-full bg-me-ochre/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-me-ochre">
                        AI润色
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-me-charcoal/55">
                    {label?.zh ?? item.initiative_type} · {label?.en ?? ''}
                  </div>
                  {item.hypothesis && (
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs font-semibold text-me-charcoal/55">
                      {item.hypothesis.length > 220
                        ? item.hypothesis.slice(0, 220) + '…'
                        : item.hypothesis}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div className="text-right">
                    <div className="text-sm font-black text-me-charcoal">
                      {item.budget_percent != null ? `${item.budget_percent}%` : '—'}
                    </div>
                    {item.budget_amount != null && (
                      <div className="text-[10px] font-semibold text-me-charcoal/45">
                        {goal.budget_currency} {item.budget_amount.toLocaleString()}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleArchive(item.id) }}
                      className="text-[10px] font-bold text-me-charcoal/45 hover:text-status-rej"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {drawerOpen && (
        <InitiativeFormDrawer
          goal={goal}
          initiative={editing}
          terminals={terminalInitiatives}
          remainingBudgetPct={remainingBudgetPct + (editing?.budget_percent ?? 0)}
          availableTypes={ALL_INITIATIVE_TYPES}
          onClose={() => { setDrawerOpen(false); setEditing(null) }}
          onSaved={() => { setDrawerOpen(false); setEditing(null); load() }}
        />
      )}
    </div>
  )
}
