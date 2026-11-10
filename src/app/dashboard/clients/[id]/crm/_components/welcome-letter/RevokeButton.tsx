'use client'

/**
 * 「撤销」= 紧急刹车：数据库里写一条撤销，从下一封信起就停（已经交给发信服务的那一封收不回来）。
 * 要写一句原因，再点一次确认。不管成没成，之后都重新读一次页面：旧页面上的这一份可能早被别的替换了，
 * 真正生效的那一份要让 PM 看见。
 */
import { useState } from 'react'
import { MeButton } from '@/components/ui/me-primitives'
import { postCommand } from './api'
import { revokeErrorText, type Notice } from './welcome-letter-text'

export function RevokeButton({
  clientId,
  id,
  label,
  doneText,
  onDone,
}: {
  clientId: string
  id: string
  label: string
  /** What the PM is told when it worked, e.g. 「已撤销授权：从下一封信起就停。」 */
  doneText: string
  onDone: (notice: Notice) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const revoke = async () => {
    setBusy(true)
    const answer = await postCommand(clientId, 'revoke', { authorization_id: id, reason: reason.trim() })
    setBusy(false)
    if (!answer.ok) {
      // Keep the box and the reason: "press it again" must be one click away.
      onDone({ tone: 'bad', text: revokeErrorText(answer.body) })
      return
    }
    setOpen(false)
    setReason('')
    // A proposal another page authorized meanwhile is an authorization now: say what was really stopped.
    const stopped = answer.body?.authorization as { authorized_at?: unknown } | undefined
    onDone({ tone: 'ok', text: typeof stopped?.authorized_at === 'string' ? '已撤销授权：从下一封信起就停。' : doneText })
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
    </div>
  )
}
