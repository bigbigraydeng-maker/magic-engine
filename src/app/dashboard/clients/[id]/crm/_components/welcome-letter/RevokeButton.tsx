'use client'

/**
 * 「撤销」= 紧急刹车：数据库里写一条撤销，从下一封信起就停（已经交给发信服务的那一封收不回来）。
 * 要写一句原因，再点一次确认。
 */
import { useState } from 'react'
import { MeButton } from '@/components/ui/me-primitives'
import { postCommand } from './api'
import { errorText } from './welcome-letter-text'

export function RevokeButton({ clientId, id, label, onDone }: { clientId: string; id: string; label: string; onDone: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const revoke = async () => {
    setBusy(true)
    setMessage(null)
    const answer = await postCommand(clientId, 'revoke', { authorization_id: id, reason: reason.trim() })
    setBusy(false)
    if (!answer.ok) {
      setMessage(errorText(answer.body))
      return
    }
    setOpen(false)
    setReason('')
    onDone()
  }

  if (!open) {
    return (
      <MeButton variant="ghost" size="sm" className="border-[#A3362C] text-[#A3362C]" onClick={() => setOpen(true)}>
        {label}
      </MeButton>
    )
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="revoke-box">
      <input
        className="min-w-[220px] flex-1 rounded border border-me-charcoal/20 px-2 py-1 text-sm placeholder:text-[#6b6b6b]"
        placeholder="撤销原因（必填，一句话）"
        value={reason}
        maxLength={300}
        disabled={busy}
        onChange={(e) => setReason(e.target.value)}
      />
      <MeButton variant="secondary" size="sm" disabled={busy || reason.trim().length === 0} onClick={() => void revoke()}>
        确认{label}
      </MeButton>
      <MeButton variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
        先不
      </MeButton>
      {message !== null && <p className="w-full text-sm font-semibold text-[#C2453A]" role="status">{message}</p>}
    </div>
  )
}
