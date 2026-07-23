'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { WorkOrderStatus } from '@/lib/factory/types'
import { STATUS_META, STATUS_ORDER } from './_components/statusMeta'
import { ReviewInbox } from './_components/ReviewInbox'

// P21.J 驾驶舱 — 看片 + 对话框 + 全局工单状态,一页搞定(PM:factory 页 = 驾驶舱)
// 顶部审片区复用 ReviewInbox(clientId)= 视频审核(左)+ 问 Claude 对话框(右)合体屏;
// 客户切换 chip 选看谁;底部折叠全局工单状态(死信复活/worker 健康)。

interface WorkOrder {
  id: string
  client_id: string
  client_name: string
  status: WorkOrderStatus
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

export default function FactoryCockpitPage() {
  // ?client=<id> = 锁定单客户视图。客户导航里的「视频工厂」走这条路径 ——
  // PM 的实际工作方式是一个窗口锁一个客户,不跨客户串;不锁的话每次进来还要先点一遍
  // 客户 chip,而且底部工单列表混着别的客户,看着乱。
  // 不带参数 = 跨客户总览(内部导航 Create 组那个入口)。
  const lockedClient = useSearchParams().get('client')
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviving, setReviving] = useState<string | null>(null)
  const [worker, setWorker] = useState<{ last_heartbeat_at: string | null; active_count: number }>({ last_heartbeat_at: null, active_count: 0 })
  const [selectedClient, setSelectedClient] = useState<string | null>(null)

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

  // 锁定客户时,整页(审片区 + 底部工单状态)都只看这一个客户
  const visibleOrders = useMemo(
    () => (lockedClient ? orders.filter((o) => o.client_id === lockedClient) : orders),
    [orders, lockedClient],
  )

  // 待审客户(有 in_review 成片的)→ 顶部审片区的客户切换
  const reviewClients = useMemo(() => {
    const m = new Map<string, { id: string; name: string; count: number }>()
    for (const o of visibleOrders) {
      if (o.status !== 'in_review') continue
      const e = m.get(o.client_id) ?? { id: o.client_id, name: o.client_name, count: 0 }
      e.count += 1
      m.set(o.client_id, e)
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count)
  }, [visibleOrders])

  // 自动选中第一个有待审的客户;当前选中的客户没待审了 → 跳到下一个
  useEffect(() => {
    // 锁定视图:恒等于锁定的客户。即便当前没有待审成片,页头的「该客户工厂配置」
    // 链接也要指得对 —— 没片子的时候恰恰最需要去检查配置。
    if (lockedClient) { setSelectedClient(lockedClient); return }
    if (reviewClients.length === 0) { setSelectedClient(null); return }
    if (!reviewClients.some((c) => c.id === selectedClient)) setSelectedClient(reviewClients[0].id)
  }, [reviewClients, selectedClient, lockedClient])

  const grouped = STATUS_ORDER
    .map((status) => ({ status, items: visibleOrders.filter((o) => o.status === status) }))
    .filter((g) => g.items.length > 0)

  const deadCount = visibleOrders.filter((o) => o.status === 'dead_letter').length
  // 客户名只能从工单里拿。该客户一条工单都没有时拿不到 —— 标题退回「驾驶舱」而不是显示空白。
  const lockedClientName = lockedClient ? (visibleOrders[0]?.client_name ?? null) : null
  const totalPending = reviewClients.reduce((s, c) => s + c.count, 0)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            视频工厂{lockedClientName ? ` · ${lockedClientName}` : ' · 驾驶舱'}
          </h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
            <span>
              {lockedClient
                ? '只看这个客户。看片拍板 + 跟 Claude 说人话改片,都在这一页'
                : '看片拍板 + 跟 Claude 说人话改片,都在这一页'}
            </span>
            <WorkerHealth lastHeartbeat={worker.last_heartbeat_at} activeCount={worker.active_count} />
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 配置是一次性的(发布主页/目标/自动排产),放客户设置页跟其他客户配置在一起。
              但从这里得能一步跳过去 —— 否则日常在这页发现配置不对,要绕回客户列表再翻设置。 */}
          {selectedClient && (
            <Link
              href={`/dashboard/clients/${selectedClient}/settings`}
              className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
            >⚙️ 该客户工厂配置</Link>
          )}
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50"
          >刷新</button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {/* ── 审片驾驶舱:客户切换 + 视频审核 + 对话框 ───────────────────────────── */}
      <section className="mb-10">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="text-base font-semibold text-slate-800">看片 · 拍板</h2>
          {totalPending > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{totalPending} 条待审</span>
          )}
        </div>

        {loading && visibleOrders.length === 0 ? (
          <p className="text-slate-400 text-sm">加载中…</p>
        ) : reviewClients.length === 0 ? (
          <div className="border border-slate-200 rounded-xl bg-white p-8 text-center text-slate-400 text-sm">
            暂无待审成片。信号进来、片子做好后会出现在这里。
          </div>
        ) : (
          <>
            {!lockedClient && reviewClients.length > 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {reviewClients.map((c) => {
                  const active = c.id === selectedClient
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedClient(c.id)}
                      className={`px-3 h-9 rounded-lg text-sm font-medium border transition-colors inline-flex items-center gap-2 ${
                        active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {c.name}
                      <span className={`text-xs px-1.5 rounded-full ${active ? 'bg-white/20' : 'bg-amber-100 text-amber-800'}`}>{c.count}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* ReviewInbox(clientId)= 视频审核(左)+ 问 Claude 对话框(右)。key 切客户时重挂,刷新历史 */}
            {selectedClient && <ReviewInbox key={selectedClient} clientId={selectedClient} />}
          </>
        )}
      </section>

      {/* ── 全局工单状态(次要,折叠)────────────────────────────────────────────── */}
      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-slate-600 flex items-center gap-2 select-none">
          <span className="text-slate-400 group-open:rotate-90 transition-transform inline-block">▸</span>
          全部工单状态 · {visibleOrders.length} 条
          {deadCount > 0 && <span className="text-red-600">· ⚠️ {deadCount} 条卡住了,需你手动重试</span>}
        </summary>

        <div className="mt-4 space-y-6">
          {visibleOrders.length === 0 && (
            <p className="text-slate-400 text-sm">暂无工单。信号进来后会自动生成。</p>
          )}
          {grouped.map((g) => {
            const meta = STATUS_META[g.status]
            return (
              <section key={g.status}>
                <h3 className="text-sm font-medium text-slate-600 mb-2 flex items-center gap-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${meta.color}`}>{meta.label}</span>
                  <span className="text-slate-400">{g.items.length}</span>
                </h3>
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
                          >{reviving === o.id ? '重试中…' : '↻ 重新排队重试'}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </details>
    </div>
  )
}
