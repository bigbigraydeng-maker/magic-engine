'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PrescriptionReviewActions } from '@/app/dashboard/clients/[id]/prescription/new/review-actions'

/** Same agree / reject buttons and the same prescription route. No new approval path. */
export function InlineConsent({ clientId, prescriptionId }: { clientId: string; prescriptionId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function send(status: 'approved' | 'rejected') {
    setBusy(true)
    setNote(null)
    try {
      const saved = await postStatus(clientId, prescriptionId, status)
      if (saved === 'conflict') {
        setNote('这张方的状态已经变了。请刷新后再看。')
        router.refresh()
        return
      }
      if (saved !== 'saved') {
        setNote('这次没记上。能批处方的内部账号才能点。')
        return
      }
      setNote(status === 'approved' ? '已记下同意。这一步不是开始花钱。' : '已退回。这版先不采用。')
      router.refresh()
    } catch {
      setNote('这次没记上。请再点一次。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      <p className="mb-2 text-sm leading-6 text-me-charcoal/80">同意这张方。点这里和在处方页点是同一件事。</p>
      <PrescriptionReviewActions
        onApprove={() => void send('approved')}
        onReject={() => void send('rejected')}
        isApproving={busy}
      />
      {note ? <p className="mt-2 text-sm font-semibold text-me-charcoal">{note}</p> : null}
    </div>
  )
}

async function postStatus(clientId: string, prescriptionId: string, status: 'approved' | 'rejected'): Promise<'saved' | 'conflict' | 'failed'> {
  const res = await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      rejection_note: status === 'rejected' ? '用户要求重新生成' : undefined,
    }),
  })
  if (res.status === 409) return 'conflict'
  return res.ok ? 'saved' : 'failed'
}
