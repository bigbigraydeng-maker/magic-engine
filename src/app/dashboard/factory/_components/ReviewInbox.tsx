'use client'

import { useCallback, useEffect, useState } from 'react'
import type { WorkOrderStatus } from '@/lib/factory/types'
import { FactoryChat } from './FactoryChat'

// P21.J ME 原生化 P1 — 审核 Inbox(spec me-native-design v0.2 §2.1)
// 试验田:看片 + 拍板。in_review 工单 → 大号播放器 + 人话理由 +
// 「通过并投放(上限 $50)」一步轻确认 + 一键打回理由。审完自动翻下一条。

interface WorkOrder {
  id: string
  client_id: string
  client_name: string
  status: WorkOrderStatus
  angle: string
  rationale_one_liner: string
  // redline_hits:交付时服务端复扫命中的品牌红线词(complete-work-order.ts)。
  // 设计是「命中不打回,标红让人审有的放矢」——但此前唯一的「标红」实现在 Airtable 审核卡里,
  // 随 Airtable 退役一起没了。成片直连 in_review 后这条护栏必须在这里补上,否则命中红线的片子
  // 和干净片子长得一模一样,人审拿不到任何信息 = 护栏静默失效。
  output: { video_path?: string; redline_hits?: string[] } | null
}

const redlineHitsOf = (o: WorkOrder): string[] =>
  Array.isArray(o.output?.redline_hits) ? o.output.redline_hits.filter((h) => typeof h === 'string' && h) : []

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const publicUrl = (path?: string) =>
  path ? `${SUPABASE_URL}/storage/v1/object/public/content-factory/${path}` : ''

// clientId:只看该客户的待审(客户页概览用);hideWhenEmpty:没待审就不渲染(不占地方)
export function ReviewInbox({ clientId, hideWhenEmpty }: { clientId?: string; hideWhenEmpty?: boolean } = {}) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [hasShown, setHasShown] = useState(false) // 显示过一次就常驻,刷新不卸载(防对话框丢历史)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<WorkOrder | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/factory/work-orders')
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const json = await res.json()
      const pending = (json.orders ?? []).filter(
        (o: WorkOrder & { client_id?: string }) =>
          o.status === 'in_review' && (!clientId || o.client_id === clientId),
      )
      setOrders(pending)
      if (pending.length > 0) setHasShown(true)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const act = useCallback(async (id: string, payload: Record<string, unknown>) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/factory/work-orders/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `操作失败 (${res.status})`)
      }
      setOrders((prev) => prev.filter((o) => o.id !== id)) // 审完自动翻下一条
      setConfirming(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }, [])

  // 只在「从没显示过 + 当前也没待审」时隐藏。一旦显示过就常驻——刷新时绝不整体卸载,
  // 否则右侧对话框(ReviewInbox 的子组件)会被连带卸载,历史 + 正在输入的指令全丢(PM 报的 bug)。
  if (hideWhenEmpty && !hasShown && orders.length === 0) return null
  if (!hasShown && loading) return <p className="text-sm text-slate-400 mb-6">加载待审…</p>

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-slate-600 mb-3">
        待审 {orders.length > 0 ? <span className="text-amber-600">· 今天 {orders.length} 条等你</span> : <span className="text-slate-400">· 都审完了,去忙别的</span>}
      </h2>

      {error && <div className="mb-3 px-4 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      <div className={clientId ? 'grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start' : ''}>
      <div className="space-y-4">
        {orders.map((o) => (
          <div key={o.id} className="border border-slate-200 rounded-xl bg-white p-4 flex flex-col sm:flex-row gap-4">
            <div className="shrink-0 mx-auto sm:mx-0">
              {o.output?.video_path ? (
                <video
                  controls
                  src={publicUrl(o.output.video_path)}
                  className="rounded-lg bg-black w-[180px] max-h-[320px]"
                />
              ) : (
                <div className="w-[180px] h-[320px] rounded-lg bg-slate-100 grid place-items-center text-xs text-slate-400">无成片</div>
              )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex items-center gap-2 text-sm mb-2 flex-wrap">
                <span className="font-medium text-slate-800">{o.client_name}</span>
                <span className="text-xs text-slate-500 border border-slate-200 rounded-full px-2 py-0.5">{o.angle}</span>
              </div>
              <p className="text-sm text-slate-700 bg-blue-50 rounded-lg px-3 py-2 mb-4">{o.rationale_one_liner}</p>

              {redlineHitsOf(o).length > 0 && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-sm font-medium text-red-800">⚠️ 文案命中品牌红线,请逐字核对后再通过</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {redlineHitsOf(o).map((h) => (
                      <span key={h} className="text-xs bg-red-100 text-red-800 rounded px-1.5 py-0.5 font-mono">{h}</span>
                    ))}
                  </p>
                </div>
              )}

              <button
                onClick={() => setConfirming(o)}
                disabled={busy === o.id}
                className="w-full sm:w-auto sm:self-start px-5 h-11 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 mb-2"
              >{busy === o.id ? '处理中…' : '✓ 通过·待发布'}</button>

              <p className="text-xs text-slate-400">要改画面或调预算?在右边跟 Claude 说人话即可。</p>
            </div>
          </div>
        ))}
      </div>

        {clientId && <FactoryChat clientId={clientId} onActed={load} />}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-40 bg-black/45 grid place-items-center p-4" onClick={() => setConfirming(null)}>
          <div className="bg-white rounded-xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium text-slate-900 mb-1">通过并排入发布队列</p>

            {redlineHitsOf(confirming).length > 0 && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-sm font-medium text-red-800">⚠️ 这条命中了品牌红线</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {redlineHitsOf(confirming).map((h) => (
                    <span key={h} className="text-xs bg-red-100 text-red-800 rounded px-1.5 py-0.5 font-mono">{h}</span>
                  ))}
                </p>
              </div>
            )}

            {/* 文案必须跟发布链路的真实状态一致。旧文案写「链路正在建设,通过不会发出去」,而
                publish-worker(facebook-reel-adapter 真打 Graph API)此后已经落地,只是 cron 未注册
                —— 说死「不会发」是骗人的。这里只陈述能保证的事实。 */}
            <p className="text-sm text-slate-600 mb-5">
              通过 = 标记这条合格、<span className="font-medium text-slate-900">排入发布队列</span>。
              发布程序已实现但定时器尚未启用,所以现在通过不会立刻发出;
              <span className="font-medium text-slate-900">一旦启用,队列里的片子会自动发到客户主页</span>,请按「已经会发出去」的标准把关。确定通过?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => void act(confirming.id, { action: 'approve' })}
                disabled={busy === confirming.id}
                className="flex-1 h-10 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >{busy === confirming.id ? '处理中…' : '确定通过'}</button>
              <button onClick={() => setConfirming(null)} className="px-5 h-10 rounded-lg border border-slate-200 text-sm">再想想</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
