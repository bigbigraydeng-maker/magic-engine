'use client'

import { useState } from 'react'
import { statusNotice } from './dialog/present'

export const APPROVE_BUTTON_LABEL = '同意'
export const REJECT_BUTTON_LABEL = '要求修改（标为已拒绝）'

export const APPROVE_CONFIRM_TEXT =
  '批准后，这份方案会记到对应目标下面，并按阶段排好。这一步不能当没发生。确定批准？'

export const APPROVE_SPEND_REMINDER =
  '提醒：这份处方里 Agent 给的账户和日预算只是建议，批准处方不等于批准花钱；花钱要另外在计划页批准计划、在审批页点开广告。'

export const REJECT_CONFIRM_TEXT =
  '「要求修改」会把这份处方标成已拒绝，不会改写内容。确定标为已拒绝？'

type Pending = 'approve' | 'reject'

function ConfirmStep({ pending, onCancel, onConfirm }: {
  pending: Pending
  onCancel: () => void
  onConfirm: () => void
}) {
  const approving = pending === 'approve'
  return (
    <div
      role="alertdialog"
      aria-label={approving ? '确认批准' : '确认标为已拒绝'}
      className="rounded-lg border border-status-exec/30 bg-status-exec/10 p-4 space-y-3"
    >
      <p className="text-sm text-me-charcoal">{approving ? APPROVE_CONFIRM_TEXT : REJECT_CONFIRM_TEXT}</p>
      {approving && <p className="text-sm font-medium text-me-charcoal">{APPROVE_SPEND_REMINDER}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-black/10 bg-white px-4 text-sm font-medium text-me-charcoal/80 hover:bg-me-ivory">
          取消
        </button>
        <button type="button" onClick={onConfirm} className="min-h-11 rounded-lg bg-me-charcoal px-4 text-sm font-semibold text-white hover:bg-me-black">
          {approving ? '确定批准' : '确定标为已拒绝'}
        </button>
      </div>
    </div>
  )
}

export function PrescriptionReviewActions({
  onApprove,
  onReject,
  isApproving,
}: {
  onApprove: () => void
  onReject: () => void
  isApproving: boolean
}) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = () => {
    if (pending === 'approve') onApprove()
    if (pending === 'reject') onReject()
    setPending(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={() => setPending('reject')} disabled={isApproving} className="min-h-11 flex-1 rounded-lg border border-black/10 bg-white px-4 text-sm font-semibold text-me-charcoal/80 hover:bg-me-ivory disabled:opacity-50 transition-colors">
          {REJECT_BUTTON_LABEL}
        </button>
        <button type="button" onClick={() => setPending('approve')} disabled={isApproving} className="min-h-11 flex-1 rounded-lg bg-me-charcoal px-4 text-sm font-semibold text-white hover:bg-me-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {isApproving ? '处理中…' : APPROVE_BUTTON_LABEL}
        </button>
      </div>
      {pending && <ConfirmStep pending={pending} onCancel={() => setPending(null)} onConfirm={confirm} />}
    </div>
  )
}

export function PrescriberLine({ agentName, manual = false }: { agentName: string | null; manual?: boolean }) {
  if (!manual && !agentName?.trim()) return null
  return (
    <p className="text-sm text-me-charcoal/70">
      开方人：<span className="font-medium text-me-charcoal">{manual ? '人工写下' : '华佗'}</span>
    </p>
  )
}

export function PrescriptionStatusNotice({
  status,
  manual,
  approveShown,
}: {
  status: string | null
  manual: boolean
  approveShown: boolean
}) {
  const text = statusNotice(status, { manual, approveShown })
  if (!text) return null
  const waiting = status === 'draft' || status === 'rejected'
  const tone = waiting
    ? 'border-status-exec/30 bg-status-exec/10 text-me-charcoal'
    : 'border-black/10 bg-white text-me-charcoal'
  return <div role="note" className={`rounded-xl border p-4 text-sm leading-6 ${tone}`}>{text}</div>
}
