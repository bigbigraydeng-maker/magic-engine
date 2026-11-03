'use client'
import React from 'react'
import type { BudgetChangePlan } from '@/lib/ads-strategy/budget-change/plan'

export interface BudgetChangeDialogUnit {
  level: 'adset' | 'campaign'
  id: string
  adAccountId: string
  name: string | null
}

interface BudgetChangeResponse {
  plan: BudgetChangePlan
  target: unknown
  spendGateReady: boolean
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: BudgetChangeResponse }

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'pending' }
  | { kind: 'done'; beforeCents: number | null; afterCents: number | null; warnings: string[] }
  | { kind: 'failed'; message: string }

function money(currency: string | null, cents: number | null): string {
  if (cents === null) return '读不到'
  return `${currency ?? ''} ${(cents / 100).toFixed(2)}`.trim()
}

function buildUrl(clientId: string, unit: BudgetChangeDialogUnit): string {
  const q = `level=${unit.level}&unit_id=${unit.id}&ad_account_id=${encodeURIComponent(unit.adAccountId)}`
  return `/api/clients/${clientId}/ad-health/budget-change?${q}`
}

function postUrl(clientId: string): string {
  return `/api/clients/${clientId}/ad-health/budget-change`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function readString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function readNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

/** 预览接口是本仓库自己的路由（`budget-change/route.ts` GET），形状由它保证；这里只挡掉明显不对的回包。 */
function parseReady(body: unknown): BudgetChangeResponse | null {
  if (!isRecord(body) || !isRecord(body.plan) || !isRecord(body.plan.reduce) || !Array.isArray(body.plan.notChecked)) return null
  const typed = body as { plan: BudgetChangePlan; target: unknown; spendGateReady?: unknown }
  return { plan: typed.plan, target: typed.target, spendGateReady: typed.spendGateReady === true }
}

function errorMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    const e = readString(body.error)
    if (e !== null) return e
    const r = readString(body.reason)
    if (r !== null) return r
  }
  return fallback
}

function useLoadPlan(clientId: string, unit: BudgetChangeDialogUnit): LoadState {
  const [state, setState] = React.useState<LoadState>({ kind: 'loading' })
  React.useEffect(() => {
    let alive = true
    setState({ kind: 'loading' })
    fetch(buildUrl(clientId, unit))
      .then(async res => {
        const body: unknown = await res.json().catch(() => null)
        if (!alive) return
        if (!res.ok) {
          setState({ kind: 'error', message: errorMessage(body, `读不到（HTTP ${res.status}）`) })
          return
        }
        const parsed = parseReady(body)
        if (parsed === null) {
          setState({ kind: 'error', message: '返回的数据看不懂' })
          return
        }
        setState({ kind: 'ready', data: parsed })
      })
      .catch((err: unknown) => {
        if (!alive) return
        const msg = err instanceof Error ? err.message : '网络出错'
        setState({ kind: 'error', message: msg })
      })
    return () => {
      alive = false
    }
  }, [clientId, unit])
  return state
}

function useSubmit(clientId: string, unit: BudgetChangeDialogUnit) {
  const [state, setState] = React.useState<SubmitState>({ kind: 'idle' })

  const submit = React.useCallback(
    async (payload: Record<string, unknown>) => {
      setState({ kind: 'submitting' })
      try {
        const res = await fetch(postUrl(clientId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: unit.level, unit_id: unit.id, ad_account_id: unit.adAccountId, ...payload }),
        })
        const body: unknown = await res.json().catch(() => null)
        if (res.status === 202) {
          setState({ kind: 'pending' })
          return
        }
        if (res.status === 200 && isRecord(body)) {
          setState({
            kind: 'done',
            beforeCents: readNumber(body.beforeCents),
            afterCents: readNumber(body.afterCents),
            warnings: readStringArray(body.warnings),
          })
          return
        }
        setState({ kind: 'failed', message: errorMessage(body, `提交失败（HTTP ${res.status}）`) })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '网络出错'
        setState({ kind: 'failed', message: msg })
      }
    },
    [clientId, unit],
  )

  return { state, submit }
}

function ScaleButton(props: {
  label: string
  option: { allowed: boolean; reasons: string[] }
  spendGateReady: boolean
  disabled: boolean
  onClick: () => void
}) {
  const { label, option, spendGateReady, disabled, onClick } = props
  const isDisabled = disabled || !option.allowed || !spendGateReady
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={isDisabled}
        onClick={onClick}
        className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {label}
      </button>
      {isDisabled && option.reasons.map((r, i) => (
        <p key={i} className="text-xs text-gray-500">{r}</p>
      ))}
      {isDisabled && !spendGateReady && (
        <p className="text-xs text-gray-500">加钱的闸还没装好，暂时不能加</p>
      )}
    </div>
  )
}

function ScaleSection(props: {
  plan: BudgetChangePlan
  spendGateReady: boolean
  disabled: boolean
  onUp10: () => void
  onUp20: () => void
}) {
  const { plan, spendGateReady, disabled, onUp10, onUp20 } = props
  const cur = plan.currency
  return (
    <div className="space-y-2">
      <ScaleButton
        label={`加 10%（到 ${money(cur, plan.up10.afterCents)}）`}
        option={plan.up10}
        spendGateReady={spendGateReady}
        disabled={disabled}
        onClick={onUp10}
      />
      <ScaleButton
        label={`加 20%（到 ${money(cur, plan.up20.afterCents)}）`}
        option={plan.up20}
        spendGateReady={spendGateReady}
        disabled={disabled}
        onClick={onUp20}
      />
      <p className="text-xs text-gray-500">加预算只是提交，要 PM 本人批了才会真改。</p>
    </div>
  )
}

function ReduceSection(props: {
  plan: BudgetChangePlan
  disabled: boolean
  onSubmit: (targetCents: number) => void
}) {
  const { plan, disabled, onSubmit } = props
  const [dollars, setDollars] = React.useState('')
  const cur = plan.currency
  const parsed = Number.parseFloat(dollars)
  const canSubmit = plan.reduce.allowed && !disabled && Number.isFinite(parsed) && parsed > 0
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.01"
          min="0"
          value={dollars}
          onChange={e => setDollars(e.target.value)}
          disabled={disabled || !plan.reduce.allowed}
          className="w-28 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-50"
          placeholder="美元"
        />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit(Math.round(parsed * 100))}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          减到这个数
        </button>
      </div>
      <p className="text-xs text-gray-500">
        最低能减到 {money(cur, plan.reduce.minAfterCents)}（一次最多减 20%）
      </p>
      <p className="text-xs text-gray-500">减预算点了就会改，跟止损一样。</p>
      {!plan.reduce.allowed && plan.reduce.reasons.map((r, i) => (
        <p key={i} className="text-xs text-gray-500">{r}</p>
      ))}
    </div>
  )
}

function NotCheckedSection({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-gray-600">系统没法自动核对的几条（请自己看一眼）</p>
      {items.map((item, i) => (
        <p key={i} className="text-xs text-gray-500">没核对：{item}</p>
      ))}
    </div>
  )
}

function ReadyView(props: {
  unit: BudgetChangeDialogUnit
  data: BudgetChangeResponse
  submitState: SubmitState
  onUp10: () => void
  onUp20: () => void
  onReduce: (targetCents: number) => void
  onClose: () => void
}) {
  const { unit, data, submitState, onUp10, onUp20, onReduce, onClose } = props
  const { plan, spendGateReady } = data
  const cur = plan.currency
  const busy = submitState.kind === 'submitting'
  const headroom = plan.capHeadroomCents === null ? '读不到' : money(cur, plan.capHeadroomCents)
  const lastMod = plan.hoursSinceMetaUpdate === null ? '读不到' : `${plan.hoursSinceMetaUpdate} 小时前`

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="max-w-md w-full rounded-xl bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">调「{unit.name ?? unit.id}」的每天预算</h3>
        <p className="text-xs text-gray-600">
          现在每天 {money(cur, plan.currentCents)}；客户每天上限还剩 {headroom}；Meta 上次修改：{lastMod}
        </p>
        <ScaleSection
          plan={plan}
          spendGateReady={spendGateReady}
          disabled={busy}
          onUp10={onUp10}
          onUp20={onUp20}
        />
        <ReduceSection plan={plan} disabled={busy} onSubmit={onReduce} />
        <NotCheckedSection items={plan.notChecked} />
        {submitState.kind === 'failed' && (
          <p className="text-xs text-red-700">{submitState.message}</p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

function ResultView(props: { state: SubmitState; onClose: () => void }) {
  const { state, onClose } = props
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="max-w-md w-full rounded-xl bg-white p-4 space-y-3">
        {state.kind === 'pending' && (
          <p className="text-xs text-gray-700">已提交，等 PM 本人批（在本页「O1 预算建议」那一栏批）</p>
        )}
        {state.kind === 'done' && (
          <div className="space-y-1">
            <p className="text-xs text-gray-700">
              已改：{money(null, state.beforeCents)} → {money(null, state.afterCents)}
            </p>
            {state.warnings.map((w, i) => (
              <p key={i} className="text-xs text-gray-500">{w}</p>
            ))}
          </div>
        )}
        {state.kind === 'failed' && (
          <p className="text-xs text-red-700">{state.message}</p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BudgetChangeDialog(props: {
  clientId: string
  unit: BudgetChangeDialogUnit
  onClose: () => void
}): JSX.Element {
  const { clientId, unit, onClose } = props
  const load = useLoadPlan(clientId, unit)
  const { state: submitState, submit } = useSubmit(clientId, unit)

  if (submitState.kind === 'pending' || submitState.kind === 'done' || submitState.kind === 'failed') {
    return <ResultView state={submitState} onClose={onClose} />
  }

  if (load.kind === 'loading') {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
        <div className="max-w-md w-full rounded-xl bg-white p-4 space-y-3">
          <p className="text-xs text-gray-600">正在当场读 Meta 和加钱规则…</p>
        </div>
      </div>
    )
  }

  if (load.kind === 'error') {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
        <div className="max-w-md w-full rounded-xl bg-white p-4 space-y-3">
          <p className="text-xs text-red-700">{load.message}</p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ReadyView
      unit={unit}
      data={load.data}
      submitState={submitState}
      onUp10={() => submit({ kind: 'up10' })}
      onUp20={() => submit({ kind: 'up20' })}
      onReduce={targetCents =>
        submit({ kind: 'down_to', target_cents: targetCents, request_id: crypto.randomUUID() })
      }
      onClose={onClose}
    />
  )
}
