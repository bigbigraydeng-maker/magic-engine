'use client'

import { useCallback, useEffect, useState } from 'react'

interface RecoveryOrder {
  id: string
  client_name: string
  order_type: string
  angle: string | null
  rationale_one_liner: string | null
  attempt_count: number
  reclaim_count: number
  reject_reason: string | null
  created_at: string
  recipe_replan_required: boolean | 'true' | null
}

function needsNewPlan(order: RecoveryOrder): boolean {
  return order.recipe_replan_required === true || order.recipe_replan_required === 'true'
}

/** Operational exceptions stay separate from the video review inbox. */
export function RecoveryQueue() {
  const [orders, setOrders] = useState<RecoveryOrder[]>([])
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/factory/work-orders?view=recovery')
      if (res.status === 403) {
        setAvailable(false)
        return
      }
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const json = await res.json()
      setOrders(Array.isArray(json.orders) ? json.orders : [])
      setAvailable(true)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const retry = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/factory/work-orders/${id}/revive`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `重试失败 (${res.status})`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '重试失败')
    } finally {
      setBusy(null)
    }
  }

  if (!available || (orders.length === 0 && !error)) return null

  return (
    <details className="mt-8 rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700">
        出片异常（{orders.length}）· 展开查看恢复办法
      </summary>
      <div className="border-t border-slate-100 p-4 space-y-3">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {orders.map((order) => (
          <article key={order.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{order.client_name} · {order.angle || order.rationale_one_liner || order.order_type}</p>
                <p className="mt-1 text-xs text-slate-500">{order.reject_reason || '工单已停止自动重试'}</p>
                {needsNewPlan(order) && (
                  <p className="mt-2 text-xs text-amber-800">这条需要先重新生成制作方案，普通重试会再次失败。</p>
                )}
              </div>
              {!needsNewPlan(order) && (
                <button
                  onClick={() => void retry(order.id)}
                  disabled={busy === order.id}
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >{busy === order.id ? '正在重试…' : '重新排队'}</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </details>
  )
}
