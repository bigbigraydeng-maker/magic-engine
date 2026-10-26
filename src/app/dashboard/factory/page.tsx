'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { factoryConfigHref } from '@/lib/factory/config-link'
import { ReviewInbox } from './_components/ReviewInbox'
import { RecoveryQueue } from './_components/RecoveryQueue'

interface PendingOrder {
  id: string
  client_id: string
  client_name: string
  status: 'in_review'
}

function WorkerHealth({ lastHeartbeat, activeCount }: { lastHeartbeat: string | null; activeCount: number }) {
  if (activeCount === 0) return null
  const ageMin = lastHeartbeat ? Math.round((Date.now() - new Date(lastHeartbeat).getTime()) / 60000) : null
  const stale = ageMin === null || ageMin > 10
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${stale ? 'bg-red-500' : 'bg-emerald-500'}`} />
      {stale
        ? <span className="text-red-600">worker 疑似离线（生产中 {activeCount} 条，{ageMin === null ? '无心跳' : `${ageMin} 分钟没心跳`}）</span>
        : <span>worker {ageMin} 分钟前还活着</span>}
    </span>
  )
}

export default function FactoryCockpitPage() {
  const lockedClient = useSearchParams().get('client')
  const [orders, setOrders] = useState<PendingOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [worker, setWorker] = useState<{ last_heartbeat_at: string | null; active_count: number }>({ last_heartbeat_at: null, active_count: 0 })
  const [selectedClient, setSelectedClient] = useState<string | null>(lockedClient)
  const manualPick = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/factory/work-orders')
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const json = await res.json()
      setOrders((json.orders ?? []).filter((order: PendingOrder) => order.status === 'in_review'))
      setWorker(json.worker ?? { last_heartbeat_at: null, active_count: 0 })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    const onFocus = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const visibleOrders = useMemo(
    () => lockedClient ? orders.filter(order => order.client_id === lockedClient) : orders,
    [orders, lockedClient],
  )
  const reviewClients = useMemo(() => {
    const clients = new Map<string, { id: string; name: string; count: number }>()
    for (const order of visibleOrders) {
      const client = clients.get(order.client_id) ?? { id: order.client_id, name: order.client_name, count: 0 }
      client.count += 1
      clients.set(order.client_id, client)
    }
    return Array.from(clients.values()).sort((a, b) => b.count - a.count)
  }, [visibleOrders])

  useEffect(() => {
    if (lockedClient) {
      setSelectedClient(lockedClient)
      return
    }
    if (reviewClients.length === 0) {
      setSelectedClient(null)
      return
    }
    if (!selectedClient || !reviewClients.some(client => client.id === selectedClient)) {
      setSelectedClient(reviewClients[0].id)
    } else if (!manualPick.current && reviewClients[0].id !== selectedClient) {
      setSelectedClient(reviewClients[0].id)
    }
  }, [reviewClients, selectedClient, lockedClient])

  const lockedClientName = lockedClient ? reviewClients[0]?.name : null
  const totalPending = visibleOrders.length

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            视频工厂{lockedClientName ? ` · ${lockedClientName}` : ' · 待审核'}
          </h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
            <span>这里只显示需要你审核、通过或打回的视频；页面每 30 秒自动更新。</span>
            <WorkerHealth lastHeartbeat={worker.last_heartbeat_at} activeCount={worker.active_count} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedClient && (
            <Link
              href={factoryConfigHref(selectedClient)}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
            >⚙️ 工厂配置</Link>
          )}
          <button
            onClick={() => { setLoading(true); void load() }}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50"
          >刷新</button>
        </div>
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="text-base font-semibold text-slate-800">待你处理</h2>
          {totalPending > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{totalPending} 条待审</span>
          )}
        </div>

        {loading && visibleOrders.length === 0 ? (
          <p className="text-slate-400 text-sm">加载中…</p>
        ) : lockedClient ? (
          <ReviewInbox key={lockedClient} clientId={lockedClient} onReviewed={() => void load()} />
        ) : reviewClients.length === 0 ? (
          <div className="border border-slate-200 rounded-xl bg-white p-8 text-center text-slate-500 text-sm">
            现在没有待审核的视频。已通过、已打回和被新版替代的记录会自动从待办区收起，原记录仍保留。
          </div>
        ) : (
          <>
            {reviewClients.length > 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {reviewClients.map(client => {
                  const active = client.id === selectedClient
                  return (
                    <button
                      key={client.id}
                      onClick={() => { manualPick.current = true; setSelectedClient(client.id) }}
                      className={`px-3 h-9 rounded-lg text-sm font-medium border transition-colors inline-flex items-center gap-2 ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                    >
                      {client.name}
                      <span className={`text-xs px-1.5 rounded-full ${active ? 'bg-white/20' : 'bg-amber-100 text-amber-800'}`}>{client.count}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {selectedClient && <ReviewInbox key={selectedClient} clientId={selectedClient} onReviewed={() => void load()} />}
          </>
        )}
      </section>
      {!lockedClient && <RecoveryQueue />}
    </div>
  )
}
