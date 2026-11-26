'use client'

/**
 * 「结果不明」的信，PM 本人核对后标「已发出」或「没发出」：先预览（服务端再核一次这封信还是页面上看到的样子），
 * 看清楚后果再点「确认」。「没发出」= 这位客人以后不会再自动收到欢迎信。不管成没成，之后都重新读一次页面。
 */
import { useState } from 'react'
import { MeButton } from '@/components/ui/me-primitives'
import { postCommand } from './api'
import {
  NO_TIMELINE_HINT,
  RESOLVE_CONSEQUENCE_TEXT,
  RESOLVE_HOW_TO_CHECK,
  resolvedText,
  resolveErrorText,
  type Notice,
  type RecentSendView,
} from './welcome-letter-text'

type Outcome = 'sent' | 'not_sent'
const LABEL: Readonly<Record<Outcome, string>> = { sent: '已发出', not_sent: '没发出' }

export function ResolveBox({ clientId, send, onDone }: { clientId: string; send: RecentSendView; onDone: (notice: Notice) => void }): JSX.Element {
  const [choice, setChoice] = useState<Outcome | null>(null)
  /** From the preview: false = the letter has no timeline line (it never reached the provider). */
  const [timelinePresent, setTimelinePresent] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const ask = async (outcome: Outcome, confirm: boolean) => {
    setBusy(true)
    const answer = await postCommand(clientId, 'resolve-unknown', { send_id: send.id, outcome, seen_updated_at: send.updated_at, confirm })
    setBusy(false)
    if (answer.ok && !confirm && answer.body?.mode === 'PREVIEW') {
      setTimelinePresent(typeof answer.body.timeline_present === 'boolean' ? answer.body.timeline_present : null)
      setChoice(outcome)
      return
    }
    setChoice(null)
    onDone(answer.ok ? { tone: 'ok', text: resolvedText(outcome, answer.body) } : { tone: 'bad', text: resolveErrorText(answer.body) })
  }

  if (choice === null) {
    return (
      <div className="mt-2" data-testid="resolve-box">
        <p className="text-xs text-me-charcoal/70">{RESOLVE_HOW_TO_CHECK}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <MeButton variant="ghost" size="sm" disabled={busy} onClick={() => void ask('sent', false)}>核对后标「已发出」</MeButton>
          <MeButton variant="ghost" size="sm" disabled={busy} onClick={() => void ask('not_sent', false)}>核对后标「没发出」</MeButton>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-2 border-l-2 border-me-charcoal/25 py-1 pl-3" data-testid="resolve-preview">
      <p className="text-sm font-semibold text-me-charcoal">{RESOLVE_CONSEQUENCE_TEXT[choice]}</p>
      {timelinePresent === false && <p className="mt-1 text-sm font-semibold text-[#C2453A]" data-testid="no-timeline-hint">{NO_TIMELINE_HINT}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <MeButton variant="secondary" size="sm" disabled={busy} onClick={() => void ask(choice, true)}>确认标「{LABEL[choice]}」</MeButton>
        <MeButton variant="ghost" size="sm" disabled={busy} onClick={() => setChoice(null)}>先不</MeButton>
      </div>
    </div>
  )
}
