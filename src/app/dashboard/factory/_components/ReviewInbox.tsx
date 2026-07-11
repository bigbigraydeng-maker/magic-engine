'use client'

import { useCallback, useEffect, useState } from 'react'

// P21.J ME 原生化 P1 — 审核 Inbox(spec me-native-design v0.2 §2.1)
// 试验田:看片 + 拍板。in_review 工单 → 大号播放器 + 人话理由 +
// 「通过并投放(上限 $50)」一步轻确认 + 一键打回理由。审完自动翻下一条。

interface WorkOrder {
  id: string
  client_id: string
  client_name: string
  status: string
  angle: string
  rationale_one_liner: string
  output: { video_path?: string } | null
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const publicUrl = (path?: string) =>
  path ? `${SUPABASE_URL}/storage/v1/object/public/content-factory/${path}` : ''

// 打回理由:画面/品牌走 reject_quality(重开工单);预算走 reject_budget(只改预算)
const REJECT_CHIPS = [
  { label: '画面质量', action: 'reject_quality' as const },
  { label: '不像品牌', action: 'reject_quality' as const },
  { label: '不喜欢', action: 'reject_quality' as const },
  { label: '预算节奏', action: 'reject_budget' as const },
]

// clientId:只看该客户的待审(客户页概览用);hideWhenEmpty:没待审就不渲染(不占地方)
export function ReviewInbox({ clientId, hideWhenEmpty }: { clientId?: string; hideWhenEmpty?: boolean } = {}) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<WorkOrder | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)

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
      setRejectingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }, [])

  const reject = useCallback((id: string, chip: (typeof REJECT_CHIPS)[number]) => {
    if (chip.action === 'reject_budget') {
      const input = window.prompt('新的投放预算(美元,上限 $50):', '20')
      if (input == null) return
      const n = Number(input)
      if (!Number.isFinite(n) || n <= 0 || n > 50) { setError('预算需在 $0–$50 之间'); return }
      void act(id, { action: 'reject_budget', new_budget_usd: n })
    } else {
      void act(id, { action: 'reject_quality', feedback: chip.label })
    }
  }, [act])

  // 嵌客户页概览:没待审(或加载中)就不占地方,只在有片要审时冒出来
  if (hideWhenEmpty && (loading || orders.length === 0)) return null
  if (loading) return <p className="text-sm text-slate-400 mb-6">加载待审…</p>

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-slate-600 mb-3">
        待审 {orders.length > 0 ? <span className="text-amber-600">· 今天 {orders.length} 条等你</span> : <span className="text-slate-400">· 都审完了,去忙别的</span>}
      </h2>

      {error && <div className="mb-3 px-4 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

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

              <button
                onClick={() => setConfirming(o)}
                disabled={busy === o.id}
                className="w-full sm:w-auto sm:self-start px-5 h-11 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 mb-3"
              >{busy === o.id ? '处理中…' : '✓ 通过并投放(上限 $50)'}</button>

              {rejectingId === o.id ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-400 mr-1">点一下即打回:</span>
                  {REJECT_CHIPS.map((c) => (
                    <button
                      key={c.label}
                      onClick={() => reject(o.id, c)}
                      disabled={busy === o.id}
                      className="text-sm text-slate-600 border border-slate-300 rounded-full px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50"
                    >{c.label}</button>
                  ))}
                  <button onClick={() => setRejectingId(null)} className="text-xs text-slate-400 px-2">取消</button>
                </div>
              ) : (
                <button onClick={() => setRejectingId(o.id)} className="text-sm text-slate-500 self-start hover:text-slate-700">打回</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-40 bg-black/45 grid place-items-center p-4" onClick={() => setConfirming(null)}>
          <div className="bg-white rounded-xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium text-slate-900 mb-1">这条会开始花钱投放</p>
            <p className="text-sm text-slate-600 mb-5">投放上限 <span className="font-medium text-slate-900">$50</span>,超了系统自动停。确定投?</p>
            <div className="flex gap-3">
              <button
                onClick={() => void act(confirming.id, { action: 'approve' })}
                disabled={busy === confirming.id}
                className="flex-1 h-10 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >{busy === confirming.id ? '投放中…' : '确定投放'}</button>
              <button onClick={() => setConfirming(null)} className="px-5 h-10 rounded-lg border border-slate-200 text-sm">再想想</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
