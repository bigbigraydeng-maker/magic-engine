'use client'

import { useCallback, useEffect, useState } from 'react'
import { ReviewInbox } from './_components/ReviewInbox'

// P21.J M2 — Content Factory Ops 后台(spec §6.1)
// 工单管线可视 + dead_letter 一键复活。单运营者视图,不做复杂筛选。

interface WorkOrder {
  id: string
  client_name: string
  status: string
  order_type: string
  angle: string
  rationale_one_liner: string
  actual_cost_usd: number
  budget_cap_usd: number
  attempt_count: number
  reclaim_count: number
  reject_reason: string | null
  source_ad_id: string | null
  created_at: string
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  queued: { label: '排队中', color: 'bg-slate-100 text-slate-700' },
  claimed: { label: '已领取', color: 'bg-blue-100 text-blue-700' },
  producing: { label: '生产中', color: 'bg-blue-100 text-blue-700' },
  rendered: { label: '已出片', color: 'bg-indigo-100 text-indigo-700' },
  in_review: { label: '待审核', color: 'bg-amber-100 text-amber-800' },
  review_rejected: { label: '已打回', color: 'bg-orange-100 text-orange-700' },
  approved: { label: '已通过', color: 'bg-emerald-100 text-emerald-700' },
  publishing: { label: '发布中', color: 'bg-teal-100 text-teal-700' },
  publish_failed: { label: '发布失败', color: 'bg-red-100 text-red-700' },
  published: { label: '已发布', color: 'bg-green-100 text-green-700' },
  measuring: { label: '归因中', color: 'bg-cyan-100 text-cyan-700' },
  closed: { label: '已归档', color: 'bg-slate-100 text-slate-500' },
  failed: { label: '失败', color: 'bg-red-100 text-red-700' },
  dead_letter: { label: '死信队列', color: 'bg-red-200 text-red-900' },
  archived: { label: '已归档', color: 'bg-slate-100 text-slate-500' },
  superseded: { label: '已取代', color: 'bg-slate-100 text-slate-500' },
}

const ORDER = [
  'dead_letter', 'publish_failed', 'in_review', 'rendered', 'review_rejected',
  'producing', 'claimed', 'queued', 'approved', 'publishing', 'published',
  'measuring', 'failed', 'closed', 'archived', 'superseded',
]

function WorkerHealth({ lastHeartbeat, activeCount }: { lastHeartbeat: string | null; activeCount: number }) {
  if (activeCount === 0) return null
  const ageMin = lastHeartbeat ? Math.round((Date.now() - new Date(lastHeartbeat).getTime()) / 60000) : null
  const stale = ageMin === null || ageMin > 10 // sweeper 10 分钟收僵死工单,同阈值
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${stale ? 'bg-red-500' : 'bg-emerald-500'}`} />
      {stale
        ? <span className="text-red-600">worker 疑似离线(生产中 {activeCount} 条,{ageMin === null ? '无心跳' : `${ageMin} 分钟没心跳`})</span>
        : <span>worker {ageMin} 分钟前还活着</span>}
    </span>
  )
}

export default function FactoryOpsPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviving, setReviving] = useState<string | null>(null)
  const [worker, setWorker] = useState<{ last_heartbeat_at: string | null; active_count: number }>({ last_heartbeat_at: null, active_count: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/factory/work-orders')
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const json = await res.json()
      setOrders(json.orders ?? [])
      setWorker(json.worker ?? { last_heartbeat_at: null, active_count: 0 })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const revive = useCallback(async (id: string) => {
    setReviving(id)
    try {
      const res = await fetch(`/api/factory/work-orders/${id}/revive`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `复活失败 (${res.status})`)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '复活失败')
    } finally {
      setReviving(null)
    }
  }, [load])

  // in_review 由顶部审核 Inbox 全权接管,下方看板不重复展示
  const grouped = ORDER
    .filter((status) => status !== 'in_review')
    .map((status) => ({ status, items: orders.filter((o) => o.status === status) }))
    .filter((g) => g.items.length > 0)

  const deadCount = orders.filter((o) => o.status === 'dead_letter').length

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">内容工厂 · 工单看板</h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
            <span>共 {orders.length} 条工单{deadCount > 0 ? ` · ⚠️ ${deadCount} 条在死信队列待复活` : ''}</span>
            <WorkerHealth lastHeartbeat={worker.last_heartbeat_at} activeCount={worker.active_count} />
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50"
        >刷新</button>
      </div>

      <ReviewInbox />

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}
      {loading && <p className="text-slate-400 text-sm">加载中…</p>}
      {!loading && orders.length === 0 && (
        <p className="text-slate-400 text-sm">暂无工单。信号进来后会自动生成。</p>
      )}

      <div className="space-y-6">
        {grouped.map((g) => {
          const meta = STATUS_META[g.status] ?? { label: g.status, color: 'bg-slate-100 text-slate-700' }
          return (
            <section key={g.status}>
              <h2 className="text-sm font-medium text-slate-600 mb-2 flex items-center gap-2">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${meta.color}`}>{meta.label}</span>
                <span className="text-slate-400">{g.items.length}</span>
              </h2>
              <div className="space-y-2">
                {g.items.map((o) => (
                  <div key={o.id} className="border border-slate-200 rounded-lg p-3 bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium text-slate-800">{o.client_name}</span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-500">{o.order_type}</span>
                          {o.source_ad_id && <span className="text-xs text-slate-400">({o.source_ad_id})</span>}
                        </div>
                        <p className="text-sm text-slate-700 mt-1">{o.rationale_one_liner}</p>
                        <p className="text-xs text-slate-400 mt-0.5">角度: {o.angle}</p>
                        {o.reject_reason && (
                          <p className="text-xs text-red-600 mt-1">失败原因: {o.reject_reason}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-1">
                          成本 ${Number(o.actual_cost_usd).toFixed(2)} / 上限 ${Number(o.budget_cap_usd).toFixed(2)}
                          {o.attempt_count > 0 ? ` · 尝试 ${o.attempt_count}` : ''}
                          {o.reclaim_count > 0 ? ` · 回收 ${o.reclaim_count}` : ''}
                        </p>
                      </div>
                      {o.status === 'dead_letter' && (
                        <button
                          onClick={() => void revive(o.id)}
                          disabled={reviving === o.id}
                          className="shrink-0 px-3 py-1.5 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
                        >{reviving === o.id ? '复活中…' : '↻ 复活回队列'}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
