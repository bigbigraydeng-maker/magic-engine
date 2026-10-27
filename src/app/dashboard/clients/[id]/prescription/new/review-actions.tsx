'use client'

import { useState } from 'react'

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
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3"
    >
      <p className="text-sm text-amber-950">{approving ? APPROVE_CONFIRM_TEXT : REJECT_CONFIRM_TEXT}</p>
      {approving && <p className="text-sm font-medium text-amber-950">{APPROVE_SPEND_REMINDER}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          取消
        </button>
        <button type="button" onClick={onConfirm} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800">
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
      <div className="flex gap-3">
        <button type="button" onClick={() => setPending('reject')} disabled={isApproving} className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {REJECT_BUTTON_LABEL}
        </button>
        <button type="button" onClick={() => setPending('approve')} disabled={isApproving} className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
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
    <p className="text-sm text-gray-600">
      开方人：<span className="font-medium text-gray-900">{manual ? '人工写下' : '华佗'}</span>
    </p>
  )
}

export function ManualDraftBanner({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      草稿 · 人工写下的。还没同意。点「同意」会把方案记到目标下面，按阶段排好。
    </div>
  )
}
