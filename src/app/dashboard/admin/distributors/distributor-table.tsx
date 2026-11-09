'use client'
import { useState } from 'react'
import {
  LEVEL_LABELS,
  STATUS_LABELS,
  SkeletonRow,
  errorText,
  formatMoney,
  postJson,
  type ApiError,
  type Distributor,
} from './shared'

interface DistributorTableProps {
  distributors: Distributor[]
  loading: boolean
  onDecision: (d: Distributor, decision: 'approve' | 'reject' | 'suspend' | 'reinstate') => void
  busyId: string | null
}

export function DistributorTable({ distributors, loading, onDecision, busyId }: DistributorTableProps) {
  const [linkBusyId, setLinkBusyId] = useState<string | null>(null)
  const [linkUrlById, setLinkUrlById] = useState<Record<string, string>>({})
  const [linkErrById, setLinkErrById] = useState<Record<string, string>>({})

  const generateLink = async (d: Distributor) => {
    if (!window.confirm(`给「${d.display_name}」生成一条 24 小时有效、只能用一次的登录链接？`)) return
    setLinkBusyId(d.id)
    setLinkErrById((prev) => {
      const next = { ...prev }
      delete next[d.id]
      return next
    })
    const res = await postJson<{ url: string }>(`/api/admin/distributors/${d.id}/access-link`, {})
    setLinkBusyId(null)
    if (!res.ok || !res.data) {
      const err: ApiError | null = res.err
      setLinkErrById((prev) => ({ ...prev, [d.id]: errorText(err) || '生成失败' }))
      return
    }
    setLinkUrlById((prev) => ({ ...prev, [d.id]: res.data!.url }))
  }

  const revokeLinks = async (d: Distributor) => {
    if (!window.confirm(`撤销「${d.display_name}」的全部登录？对方已经打开的后台会马上退出，没用过的链接也会作废。`)) return
    setLinkBusyId(d.id)
    let message = ''
    try {
      const res = await fetch(`/api/admin/distributors/${d.id}/access-link`, { method: 'DELETE' })
      const json: unknown = await res.json()
      message = res.ok ? '已撤销全部登录' : errorText(json as ApiError) || '撤销失败'
    } catch {
      message = '撤销失败'
    }
    setLinkBusyId(null)
    setLinkUrlById((prev) => {
      const next = { ...prev }
      delete next[d.id]
      return next
    })
    setLinkErrById((prev) => ({ ...prev, [d.id]: message }))
  }

  const actionsFor = (d: Distributor) => {
    const canLink = d.status === 'approved' || d.status === 'suspended'
    const linkButton = canLink ? (
      <button
        type="button"
        disabled={linkBusyId === d.id}
        onClick={() => generateLink(d)}
        className="ml-2 rounded-lg bg-me-charcoal/10 px-3 py-1 text-xs font-bold text-me-charcoal/75 disabled:opacity-50"
      >
        登录链接
      </button>
    ) : null
    const revokeButton = canLink ? (
      <button
        type="button"
        disabled={linkBusyId === d.id}
        onClick={() => revokeLinks(d)}
        className="ml-2 rounded-lg bg-me-charcoal/10 px-3 py-1 text-xs font-bold text-me-charcoal/75 disabled:opacity-50"
      >
        撤销登录
      </button>
    ) : null

    const linkResult = linkUrlById[d.id] ? (
      <div className="mt-2">
        <input
          readOnly
          value={linkUrlById[d.id]}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-black/[0.1] bg-me-ivory px-2 py-1 text-xs text-me-charcoal/80"
        />
        <p className="mt-1 text-xs text-me-charcoal/55">复制后自己发给对方。系统不会自动发送。</p>
      </div>
    ) : null

    const linkError = linkErrById[d.id] ? (
      <p className="mt-2 text-xs font-medium text-[#C2453A]">{linkErrById[d.id]}</p>
    ) : null

    let action: React.ReactNode
    if (d.status === 'pending') {
      action = (
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
    } else if (d.status === 'approved') {
      action = (
        <button
          type="button"
          disabled={busyId === d.id}
          onClick={() => onDecision(d, 'suspend')}
          className="rounded-lg bg-me-charcoal/70 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          停用
        </button>
      )
    } else if (d.status === 'suspended') {
      action = (
        <button
          type="button"
          disabled={busyId === d.id}
          onClick={() => onDecision(d, 'reinstate')}
          className="rounded-lg bg-me-ochre px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
        >
          恢复
        </button>
      )
    } else {
      action = <span className="text-xs text-me-charcoal/45">—</span>
    }

    return (
      <>
        {action}
        {linkButton}
        {revokeButton}
        {linkResult}
        {linkError}
      </>
    )
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
