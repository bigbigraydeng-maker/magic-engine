'use client'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ErrorBox,
  SkeletonRow,
  errorText,
  formatDate,
  formatMoney,
  parseDollarsToCents,
  postJson,
  toPaidAt,
  todayString,
  type Catalog,
  type Distributor,
  type Sale,
} from './shared'

function saleContent(sale: Sale, catalog: Catalog | null): string {
  if (sale.kind === 'refund') return '退款'
  if (sale.kind === 'addon') return `加 ${sale.extra_avatars} 个数字人`
  const plan = catalog?.plans.find((p) => p.code === sale.plan_code) ?? null
  const videos = plan ? plan.videosPerMonth : 0
  let text = `${videos}条/月 × ${sale.months ?? 0} 个月`
  if (sale.extra_avatars > 0) text += ` +${sale.extra_avatars} 个数字人`
  if (sale.is_self_purchase) text += ' · 自购'
  return text
}

interface RefundFormProps {
  sale: Sale
  onDone: () => void
  onCancel: () => void
}

function RefundForm({ sale, onDone, onCancel }: RefundFormProps) {
  const [amount, setAmount] = useState((sale.amount_cents / 100).toFixed(2))
  const [orderRef, setOrderRef] = useState(`${sale.order_ref}-退款`)
  const [paidDate, setPaidDate] = useState(todayString())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    const cents = parseDollarsToCents(amount)
    if (cents === null) {
      setErr('退款金额必须大于 0')
      return
    }
    if (!orderRef.trim()) {
      setErr('请填写订单号')
      return
    }
    if (!window.confirm(`确定给订单 ${sale.order_ref} 退款 ${formatMoney(cents)}？经销商的相关收益会被倒扣。`)) return
    setBusy(true)
    const res = await postJson<{ sale: Sale }>('/api/admin/distributors/sales', {
      type: 'refund',
      refund_of_sale_id: sale.id,
      amount_cents: cents,
      order_ref: orderRef.trim(),
      paid_at: toPaidAt(paidDate),
    })
    setBusy(false)
    if (!res.ok) {
      setErr(errorText(res.err))
      return
    }
    onDone()
  }

  return (
    <form onSubmit={submit} className="mt-2 rounded-lg bg-me-ivory p-3">
      <ErrorBox message={err} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-xs text-me-charcoal/55">金额（元）</span>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-28 rounded-lg border border-black/[0.1] px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-me-charcoal/55">订单号</span>
          <input
            value={orderRef}
            onChange={(e) => setOrderRef(e.target.value)}
            className="mt-1 w-40 rounded-lg border border-black/[0.1] px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-me-charcoal/55">付款日期</span>
          <input
            type="date"
            value={paidDate}
            onChange={(e) => setPaidDate(e.target.value)}
            className="mt-1 rounded-lg border border-black/[0.1] px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-[#C2453A] px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          确认退款
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-me-charcoal/10 px-3 py-1 text-xs font-bold text-me-charcoal/75"
        >
          取消
        </button>
      </div>
    </form>
  )
}

interface SalesTableProps {
  sales: Sale[]
  distributors: Distributor[]
  catalog: Catalog | null
  loading: boolean
  onRefunded: () => void
}

export function SalesTable({ sales, distributors, catalog, loading, onRefunded }: SalesTableProps) {
  const [refundFor, setRefundFor] = useState<string | null>(null)
  const nameById = useMemo(() => {
    const map = new Map<string, string>()
    distributors.forEach((d) => map.set(d.id, d.display_name))
    return map
  }, [distributors])

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-me-ivory">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">付款日期</th>
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">经销商</th>
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">内容</th>
            <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">金额</th>
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">订单号</th>
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.06]">
          {loading ? (
            <>
              <SkeletonRow cols={6} />
              <SkeletonRow cols={6} />
              <SkeletonRow cols={6} />
            </>
          ) : sales.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-6 py-10 text-center text-sm text-me-charcoal/45">
                还没有销售记录
              </td>
            </tr>
          ) : (
            sales.map((s) => (
              <tr key={s.id} className="hover:bg-me-ivory/60 transition-colors align-top">
                <td className="px-6 py-4 text-sm text-me-charcoal/75">{formatDate(s.paid_at)}</td>
                <td className="px-6 py-4 text-sm font-medium text-me-charcoal/90">
                  {nameById.get(s.distributor_id) ?? '—'}
                </td>
                <td className="px-6 py-4 text-sm text-me-charcoal/75">{saleContent(s, catalog)}</td>
                <td
                  className={`px-6 py-4 text-right text-sm font-bold tabular-nums ${
                    s.kind === 'refund' ? 'text-[#C2453A]' : 'text-me-charcoal/90'
                  }`}
                >
                  {formatMoney(s.amount_cents)}
                </td>
                <td className="px-6 py-4 text-sm text-me-charcoal/75">{s.order_ref}</td>
                <td className="px-6 py-4">
                  {s.kind !== 'refund' && (
                    <>
                      {refundFor === s.id ? (
                        <RefundForm
                          sale={s}
                          onDone={() => {
                            setRefundFor(null)
                            onRefunded()
                          }}
                          onCancel={() => setRefundFor(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRefundFor(s.id)}
                          className="rounded-lg bg-me-charcoal/10 px-3 py-1 text-xs font-bold text-me-charcoal/75"
                        >
                          退款
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
