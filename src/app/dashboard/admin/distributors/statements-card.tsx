'use client'
import { useCallback, useEffect, useState } from 'react'
import {
  ErrorBox,
  SkeletonRow,
  errorText,
  formatMoney,
  formatDate,
  postJson,
  todayString,
  type ApiError,
  type Distributor,
} from './shared'

type StatementStatus = 'computed' | 'approved' | 'paid' | 'voided'

interface Balance {
  distributor_id: string
  opening_cents: number
  period_cents: number
  payout_cents: number
  closing_cents: number
}

interface Statement {
  id: string
  period_month: string
  status: StatementStatus
  total_payable_cents: number
  computed_at: string
  approved_by: string | null
  approved_at: string | null
  paid_at: string | null
  balances: Balance[]
}

interface ComputeResult {
  month: string
  dryRun: boolean
  statementId: string | null
  totalPayableCents: number
  salesSettled: number
  lines: number
  distributorsPaid: number
}

const STATUS_LABELS: Record<StatementStatus, string> = {
  computed: '已算好，待批准',
  approved: '已批准，待付款',
  paid: '已付',
  voided: '已作废',
}

function previousMonth(): string {
  const today = todayString()
  const [y, m] = today.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  d.setUTCMonth(d.getUTCMonth() - 1)
  const yy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${yy}-${mm}`
}

interface ComputeBarProps {
  onComputed: () => void
  onError: (msg: string) => void
}

function ComputeBar({ onComputed, onError }: ComputeBarProps) {
  const [month, setMonth] = useState(previousMonth())
  const [busy, setBusy] = useState(false)
  const [dryResult, setDryResult] = useState<ComputeResult | null>(null)

  const run = async (dryRun: boolean) => {
    if (!month) {
      onError('请选择月份')
      return
    }
    if (!dryRun && !window.confirm(`确定生成 ${month} 的月结？生成后要作废才能重算。`)) return
    onError('')
    setBusy(true)
    const res = await postJson<{ result: ComputeResult }>(
      '/api/admin/distributors/statements',
      { month, dry_run: dryRun }
    )
    setBusy(false)
    if (!res.ok) {
      onError(errorText(res.err))
      return
    }
    if (dryRun) {
      setDryResult(res.data ? res.data.result : null)
    } else {
      setDryResult(null)
      onComputed()
    }
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-xs text-me-charcoal/55">月份</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="mt-1 rounded-lg border border-black/[0.1] px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(true)}
          className="rounded-lg bg-me-charcoal/10 px-3 py-1 text-xs font-bold text-me-charcoal/75 disabled:opacity-50"
        >
          试算（不保存）
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          className="rounded-lg bg-me-charcoal px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          生成月结
        </button>
      </div>
      {dryResult && (
        <div className="mt-3 rounded-lg bg-[#5B7A5B]/10 px-3 py-2 text-sm text-[#3F5A3F]">
          试算 {dryResult.month}：应付合计 {formatMoney(dryResult.totalPayableCents)}，
          {dryResult.distributorsPaid} 位经销商有钱拿，结算 {dryResult.salesSettled} 笔销售/退款。没有保存。
        </div>
      )}
    </div>
  )
}

interface BalancesTableProps {
  balances: Balance[]
  distributors: Distributor[]
}

function BalancesTable({ balances, distributors }: BalancesTableProps) {
  const nameById = new Map<string, string>()
  distributors.forEach((d) => nameById.set(d.id, d.display_name))
  const rows = balances.filter(
    (b) =>
      b.opening_cents !== 0 ||
      b.period_cents !== 0 ||
      b.payout_cents !== 0 ||
      b.closing_cents !== 0
  )
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">经销商</th>
          <th className="px-4 py-2 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">上期欠款</th>
          <th className="px-4 py-2 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">本期</th>
          <th className="px-4 py-2 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">本期实付</th>
          <th className="px-4 py-2 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">结转欠款</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-black/[0.06]">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-4 py-4 text-center text-sm text-me-charcoal/45">
              没有明细
            </td>
          </tr>
        ) : (
          rows.map((b) => (
            <tr key={b.distributor_id}>
              <td className="px-4 py-2 text-sm text-me-charcoal/90">{nameById.get(b.distributor_id) ?? b.distributor_id}</td>
              <td className="px-4 py-2 text-right text-sm tabular-nums text-me-charcoal/75">{formatMoney(b.opening_cents)}</td>
              <td className="px-4 py-2 text-right text-sm tabular-nums text-me-charcoal/75">{formatMoney(b.period_cents)}</td>
              <td className="px-4 py-2 text-right text-sm tabular-nums text-me-charcoal/75">{formatMoney(b.payout_cents)}</td>
              <td className="px-4 py-2 text-right text-sm font-bold tabular-nums text-me-charcoal/90">{formatMoney(b.closing_cents)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

interface StatementRowProps {
  statement: Statement
  distributors: Distributor[]
  busy: boolean
  onAction: (statement: Statement, action: 'approve' | 'mark_paid' | 'void') => void
}

function StatementRow({ statement, distributors, busy, onAction }: StatementRowProps) {
  const [open, setOpen] = useState(false)
  const month = statement.period_month.slice(0, 7)
  const voided = statement.status === 'voided'
  return (
    <>
      <tr className={`hover:bg-me-ivory/60 transition-colors align-top ${voided ? 'opacity-50' : ''}`}>
        <td className="px-6 py-4 text-sm font-medium text-me-charcoal/90">{month}</td>
        <td className="px-6 py-4 text-sm text-me-charcoal/75">{STATUS_LABELS[statement.status]}</td>
        <td className="px-6 py-4 text-right text-sm font-bold tabular-nums text-me-charcoal/90">
          {formatMoney(statement.total_payable_cents)}
        </td>
        <td className="px-6 py-4 text-sm text-me-charcoal/75">{statement.approved_by ?? '—'}</td>
        <td className="px-6 py-4">
          <div className="flex flex-wrap gap-2">
            {statement.status === 'computed' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAction(statement, 'approve')}
                  className="rounded-lg bg-me-charcoal px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                >
                  批准付款
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAction(statement, 'void')}
                  className="rounded-lg bg-[#C2453A]/10 px-3 py-1 text-xs font-bold text-[#C2453A] disabled:opacity-50"
                >
                  作废
                </button>
              </>
            )}
            {statement.status === 'approved' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAction(statement, 'mark_paid')}
                  className="rounded-lg bg-me-charcoal px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                >
                  标记已付
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAction(statement, 'void')}
                  className="rounded-lg bg-[#C2453A]/10 px-3 py-1 text-xs font-bold text-[#C2453A] disabled:opacity-50"
                >
                  作废
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-lg bg-me-charcoal/10 px-3 py-1 text-xs font-bold text-me-charcoal/75"
            >
              明细
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr className={voided ? 'opacity-50' : ''}>
          <td colSpan={5} className="bg-me-ivory/60 px-6 py-3">
            <BalancesTable balances={statement.balances} distributors={distributors} />
          </td>
        </tr>
      )}
    </>
  )
}

export function StatementsCard({ distributors }: { distributors: Distributor[] }) {
  const [statements, setStatements] = useState<Statement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/distributors/statements')
      const json: unknown = await res.json()
      if (res.ok) {
        const data = json as { statements: Statement[] }
        setStatements(data.statements)
        setError('')
      } else {
        setError(errorText(json as ApiError) || '加载月结失败')
      }
    } catch {
      setError('加载月结失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleAction = async (statement: Statement, action: 'approve' | 'mark_paid' | 'void') => {
    const month = statement.period_month.slice(0, 7)
    const message =
      action === 'approve'
        ? `确定批准 ${month} 的月结？合计 ${formatMoney(statement.total_payable_cents)}。`
        : action === 'mark_paid'
        ? `确认 ${month} 的钱已经在系统外付完了？`
        : `确定作废 ${month} 的月结？作废后可以重新生成。`
    if (!window.confirm(message)) return
    setError('')
    setBusyId(statement.id)
    const res = await postJson<{ statement: Statement }>(
      `/api/admin/distributors/statements/${statement.id}`,
      { action }
    )
    setBusyId(null)
    if (!res.ok) {
      setError(errorText(res.err))
      return
    }
    void load()
  }

  return (
    <div>
      <p className="mb-4 text-sm text-me-charcoal/55">
        每月 1 日上午 9 点自动算上个月。算好只是记账，要「批准」才代表同意付款；钱在系统外转完后再点「已付」。
      </p>
      <ErrorBox message={error} />
      <ComputeBar onComputed={() => void load()} onError={setError} />
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-me-ivory">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">月份</th>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">状态</th>
              <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">应付合计</th>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">批准人</th>
              <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.06]">
            {loading ? (
              <>
                <SkeletonRow cols={5} />
                <SkeletonRow cols={5} />
                <SkeletonRow cols={5} />
              </>
            ) : statements.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-sm text-me-charcoal/45">
                  还没有月结
                </td>
              </tr>
            ) : (
              statements.map((s) => (
                <StatementRow
                  key={s.id}
                  statement={s}
                  distributors={distributors}
                  busy={busyId === s.id}
                  onAction={handleAction}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
