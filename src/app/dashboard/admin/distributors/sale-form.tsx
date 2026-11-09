'use client'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ErrorBox,
  errorText,
  formatMoney,
  parseDollarsToCents,
  postJson,
  toPaidAt,
  todayString,
  type Catalog,
  type Distributor,
  type Sale,
} from './shared'

interface PlanFieldsProps {
  catalog: Catalog | null
  planCode: string
  onPlanCodeChange: (value: string) => void
  months: string
  onMonthsChange: (value: string) => void
}

function PlanFields({ catalog, planCode, onPlanCodeChange, months, onMonthsChange }: PlanFieldsProps) {
  return (
    <>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">套餐</span>
        <select
          value={planCode}
          onChange={(e) => onPlanCodeChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
        >
          {(catalog?.plans ?? []).map((p) => (
            <option key={p.code} value={p.code}>
              每月 {p.videosPerMonth} 条视频 · {formatMoney(p.monthlyCents)}/月
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">月数</span>
        <input
          type="number"
          min={1}
          max={60}
          value={months}
          onChange={(e) => onMonthsChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
        />
      </label>
    </>
  )
}

interface CommonFieldsProps {
  kind: 'plan' | 'addon'
  extraCents: number
  extraAvatars: string
  onExtraAvatarsChange: (value: string) => void
  orderRef: string
  onOrderRefChange: (value: string) => void
  paidDate: string
  onPaidDateChange: (value: string) => void
  amountInput: string
  onAmountInputChange: (value: string) => void
  selfPurchase: boolean
  onSelfPurchaseChange: (value: boolean) => void
}

function CommonFields({
  kind,
  extraCents,
  extraAvatars,
  onExtraAvatarsChange,
  orderRef,
  onOrderRefChange,
  paidDate,
  onPaidDateChange,
  amountInput,
  onAmountInputChange,
  selfPurchase,
  onSelfPurchaseChange,
}: CommonFieldsProps) {
  return (
    <>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
          多加数字人（每个一次性 {formatMoney(extraCents)}）
        </span>
        <input
          type="number"
          min={kind === 'addon' ? 1 : 0}
          value={extraAvatars}
          onChange={(e) => onExtraAvatarsChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
        />
      </label>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">订单号</span>
        <input
          value={orderRef}
          onChange={(e) => onOrderRefChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
        />
      </label>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">付款日期</span>
        <input
          type="date"
          value={paidDate}
          onChange={(e) => onPaidDateChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
        />
      </label>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">
          实收金额（元，留空 = 按价目表）
        </span>
        <input
          type="number"
          step="0.01"
          value={amountInput}
          onChange={(e) => onAmountInputChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-me-charcoal/90">
        <input
          type="checkbox"
          checked={selfPurchase}
          onChange={(e) => onSelfPurchaseChange(e.target.checked)}
        />
        经销商自己买（自购）
      </label>
    </>
  )
}

interface SaleFormProps {
  approved: Distributor[]
  catalog: Catalog | null
  onCreated: () => void
}

export function SaleForm({ approved, catalog, onCreated }: SaleFormProps) {
  const [distributorId, setDistributorId] = useState('')
  const [kind, setKind] = useState<'plan' | 'addon'>('plan')
  const [planCode, setPlanCode] = useState('')
  const [months, setMonths] = useState('1')
  const [extraAvatars, setExtraAvatars] = useState('0')
  const [selfPurchase, setSelfPurchase] = useState(false)
  const [orderRef, setOrderRef] = useState('')
  const [paidDate, setPaidDate] = useState(todayString())
  const [amountInput, setAmountInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (catalog && catalog.plans.length > 0 && !planCode) {
      setPlanCode(catalog.plans[0].code)
    }
  }, [catalog, planCode])

  const extraCents = catalog ? catalog.extraAvatarOneTimeCents : 0
  const selectedPlan = catalog?.plans.find((p) => p.code === planCode) ?? null
  const monthsNum = Math.max(1, Math.min(60, Number(months) || 1))
  const extraNum = Math.max(kind === 'addon' ? 1 : 0, Number(extraAvatars) || 0)

  const listCents = useMemo(() => {
    if (kind === 'plan') {
      const base = selectedPlan ? selectedPlan.monthlyCents * monthsNum : 0
      return base + extraNum * extraCents
    }
    return extraNum * extraCents
  }, [kind, selectedPlan, monthsNum, extraNum, extraCents])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!distributorId) {
      setErr('请选择经销商')
      return
    }
    if (!orderRef.trim()) {
      setErr('请填写订单号')
      return
    }
    let amountCents: number | undefined
    if (amountInput.trim()) {
      const parsed = parseDollarsToCents(amountInput)
      if (parsed === null) {
        setErr('实收金额必须大于 0')
        return
      }
      amountCents = parsed
    }
    const body: Record<string, unknown> = {
      type: 'sale',
      distributor_id: distributorId,
      kind,
      extra_avatars: extraNum,
      is_self_purchase: selfPurchase,
      order_ref: orderRef.trim(),
      paid_at: toPaidAt(paidDate),
    }
    if (kind === 'plan') {
      body.plan_code = planCode
      body.months = monthsNum
    }
    if (amountCents !== undefined) body.amount_cents = amountCents
    setBusy(true)
    const res = await postJson<{ sale: Sale }>('/api/admin/distributors/sales', body)
    setBusy(false)
    if (!res.ok) {
      setErr(errorText(res.err))
      return
    }
    setOrderRef('')
    setAmountInput('')
    setExtraAvatars('0')
    setMonths('1')
    setSelfPurchase(false)
    onCreated()
  }

  return (
    <form onSubmit={submit}>
      <ErrorBox message={err} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">经销商</span>
          <select
            value={distributorId}
            onChange={(e) => setDistributorId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
          >
            <option value="">请选择</option>
            {approved.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">类型</span>
          <div className="mt-2 flex gap-4 text-sm text-me-charcoal/90">
            <label className="flex items-center gap-1">
              <input type="radio" checked={kind === 'plan'} onChange={() => setKind('plan')} />
              套餐
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={kind === 'addon'} onChange={() => setKind('addon')} />
              只加数字人
            </label>
          </div>
        </div>
        {kind === 'plan' && (
          <PlanFields
            catalog={catalog}
            planCode={planCode}
            onPlanCodeChange={setPlanCode}
            months={months}
            onMonthsChange={setMonths}
          />
        )}
        <CommonFields
          kind={kind}
          extraCents={extraCents}
          extraAvatars={extraAvatars}
          onExtraAvatarsChange={setExtraAvatars}
          orderRef={orderRef}
          onOrderRefChange={setOrderRef}
          paidDate={paidDate}
          onPaidDateChange={setPaidDate}
          amountInput={amountInput}
          onAmountInputChange={setAmountInput}
          selfPurchase={selfPurchase}
          onSelfPurchaseChange={setSelfPurchase}
        />
      </div>
      <p className="mt-4 text-sm text-me-charcoal/75">按价目表：{formatMoney(listCents)}</p>
      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-lg bg-me-ochre px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        保存这笔销售
      </button>
    </form>
  )
}
