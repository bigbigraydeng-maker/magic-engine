'use client'

/**
 * AdsAuditSection — P18.A.3
 *
 * Collapsible section in the execution board showing the history of
 * real Meta Ads actions (pause / adjust_bid) with before/after details
 * and an undo button.
 *
 * Data: GET /api/clients/[id]/meta-ads/actions
 * Undo: POST /api/clients/[id]/meta-ads/execute with action_type=ads.reactivate_campaign
 */

import { useState, useEffect, useCallback } from 'react'

interface AdsAction {
  id:                 string
  action_type:        string
  vendor:             string | null
  executed_at:        string
  execution_item_id:  string | null
  payload: {
    campaign_id?: string
    before?: { status: string; name?: string; daily_budget?: string | null }
    after?:  { status: string; name?: string; daily_budget?: string | null }
  } | null
}

interface Props {
  clientId: string
}

const ACTION_LABEL: Record<string, string> = {
  'ads.pause_campaign':     '暂停广告系列',
  'ads.reactivate_campaign': '恢复广告系列',
  'ads.adjust_bid':         '调整日预算',
}

export function AdsAuditSection({ clientId }: Props) {
  const [open, setOpen]           = useState(false)
  const [actions, setActions]     = useState<AdsAction[]>([])
  const [loading, setLoading]     = useState(false)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [undoMsg, setUndoMsg]     = useState<{ id: string; ok: boolean; msg: string } | null>(null)

  const fetchActions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/meta-ads/actions?limit=20`)
      if (!res.ok) return
      const json = await res.json() as { success: boolean; actions?: AdsAction[] }
      setActions(json.actions ?? [])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    if (open) void fetchActions()
  }, [open, fetchActions])

  async function handleUndo(action: AdsAction) {
    const campaignId = action.payload?.campaign_id
    const beforeStatus = action.payload?.before?.status
    if (!campaignId) return

    // Only undo pause → reactivate (not budget changes, which are irreversible)
    if (action.action_type !== 'ads.pause_campaign') return

    setUndoingId(action.id)
    setUndoMsg(null)

    try {
      const res = await fetch(`/api/clients/${clientId}/meta-ads/execute`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action_type: 'ads.reactivate_campaign',
          campaign_id: campaignId,
        }),
      })
      const data = await res.json() as { success?: boolean; error?: string }
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`)
      setUndoMsg({ id: action.id, ok: true, msg: '已恢复为 ACTIVE' })
      void fetchActions()
    } catch (err) {
      setUndoMsg({
        id:  action.id,
        ok:  false,
        msg: err instanceof Error ? err.message : '撤销失败',
      })
    } finally {
      setUndoingId(null)
    }

    void beforeStatus // satisfies linter — not needed but documents intent
  }

  const budgetFromCents = (s: string | null | undefined) =>
    s ? `$${(parseInt(s, 10) / 100).toFixed(2)}` : null

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', {
      timeZone: 'Pacific/Auckland',
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })

  return (
    <div className="rounded-xl border border-orange-200 bg-white overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-orange-50 transition-colors"
      >
        <span className="text-base">📋</span>
        <span className="flex-1 text-left text-sm font-black text-slate-900">
          广告操作历史
        </span>
        {actions.length > 0 && !open && (
          <span className="text-xs font-semibold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
            {actions.length} 条记录
          </span>
        )}
        <span className="text-xs text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-orange-100 px-4 py-4">
          {loading && (
            <div className="space-y-2">
              {[1, 2].map(i => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          )}

          {!loading && actions.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">
              暂无广告系列执行记录 — 使用"直接执行"按钮操作后会出现在此处
            </p>
          )}

          {!loading && actions.length > 0 && (
            <div className="space-y-2">
              {actions.map(action => {
                const label       = ACTION_LABEL[action.action_type] ?? action.action_type
                const campaignName = action.payload?.before?.name ?? action.payload?.campaign_id ?? '未知广告系列'
                const beforeStatus = action.payload?.before?.status
                const afterStatus  = action.payload?.after?.status
                const afterBudget  = budgetFromCents(action.payload?.after?.daily_budget)
                const beforeBudget = budgetFromCents(action.payload?.before?.daily_budget)
                const canUndo      = action.action_type === 'ads.pause_campaign'
                const thisUndoMsg  = undoMsg?.id === action.id ? undoMsg : null

                return (
                  <div
                    key={action.id}
                    className="rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black text-slate-900">{label}</span>
                          <span className="text-[10px] text-slate-400">{fmtTime(action.executed_at)}</span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5 truncate">{campaignName}</p>

                        {/* Before / after status */}
                        {beforeStatus && afterStatus && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <StatusBadge status={beforeStatus} />
                            <span className="text-[10px] text-slate-400">→</span>
                            <StatusBadge status={afterStatus} />
                          </div>
                        )}

                        {/* Budget change */}
                        {action.action_type === 'ads.adjust_bid' && afterBudget && (
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {beforeBudget ? `${beforeBudget} → ` : ''}<strong>{afterBudget}</strong> /天
                          </p>
                        )}

                        {thisUndoMsg && (
                          <p className={`text-xs mt-1 font-medium ${thisUndoMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                            {thisUndoMsg.ok ? '✓ ' : '✗ '}{thisUndoMsg.msg}
                          </p>
                        )}
                      </div>

                      {canUndo && (
                        <button
                          onClick={() => void handleUndo(action)}
                          disabled={undoingId === action.id}
                          title="撤销此操作（恢复广告系列为 ACTIVE）"
                          className="shrink-0 text-xs px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-40 transition-colors"
                        >
                          {undoingId === action.id ? '撤销中…' : '撤销'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'ACTIVE'   ? 'bg-green-100 text-green-700' :
    status === 'PAUSED'   ? 'bg-yellow-100 text-yellow-700' :
    status === 'DELETED'  ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>
      {status}
    </span>
  )
}
