'use client'
import { LEVEL_LABELS, STATUS_LABELS, SkeletonRow, formatMoney, type Distributor } from './shared'

interface DistributorTableProps {
  distributors: Distributor[]
  loading: boolean
  onDecision: (d: Distributor, decision: 'approve' | 'reject' | 'suspend' | 'reinstate') => void
  busyId: string | null
}

export function DistributorTable({ distributors, loading, onDecision, busyId }: DistributorTableProps) {
  const actionsFor = (d: Distributor) => {
    if (d.status === 'pending') {
      return (
        <>
          <button
            type="button"
            disabled={busyId === d.id}
            onClick={() => onDecision(d, 'approve')}
            className="mr-2 rounded-lg bg-me-ochre px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
          >
            批准
          </button>
          <button
            type="button"
            disabled={busyId === d.id}
            onClick={() => onDecision(d, 'reject')}
            className="rounded-lg bg-[#C2453A] px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
          >
            拒绝
          </button>
        </>
      )
    }
    if (d.status === 'approved') {
      return (
        <button
          type="button"
          disabled={busyId === d.id}
          onClick={() => onDecision(d, 'suspend')}
          className="rounded-lg bg-me-charcoal/70 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          停用
        </button>
      )
    }
    if (d.status === 'suspended') {
      return (
        <button
          type="button"
          disabled={busyId === d.id}
          onClick={() => onDecision(d, 'reinstate')}
          className="rounded-lg bg-me-ochre px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          恢复
        </button>
      )
    }
    return <span className="text-xs text-me-charcoal/45">—</span>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-me-ivory">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">名字</th>
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">上线</th>
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">等级</th>
            <th className="px-6 py-3 text-left text-xs font-bold uppercase tracking-wide text-me-charcoal/55">状态</th>
            <th className="px-6 py-3 text-right text-xs font-bold uppercase tracking-wide text-me-charcoal/55">累计销售(净额)</th>
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
          ) : distributors.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-6 py-10 text-center text-sm text-me-charcoal/45">
                还没有经销商
              </td>
            </tr>
          ) : (
            distributors.map((d) => (
              <tr key={d.id} className="hover:bg-me-ivory/60 transition-colors">
                <td className="px-6 py-4 text-sm font-medium text-me-charcoal/90">{d.display_name}</td>
                <td className="px-6 py-4 text-sm text-me-charcoal/75">{d.parent_name ?? '—'}</td>
                <td className="px-6 py-4 text-sm text-me-charcoal/75">
                  {d.level ? LEVEL_LABELS[d.level] : '—'}
                </td>
                <td className="px-6 py-4 text-sm text-me-charcoal/75">{STATUS_LABELS[d.status]}</td>
                <td className="px-6 py-4 text-right text-sm font-bold tabular-nums text-me-charcoal/90">
                  {formatMoney(d.net_sales_cents)}
                </td>
                <td className="px-6 py-4">{actionsFor(d)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
