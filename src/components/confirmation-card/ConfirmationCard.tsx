'use client'

/**
 * The card a person sees. Plain sentences only.
 * The fingerprint and the approval id stay off this component.
 */

import { MeButton } from '@/components/ui/me-primitives'

export interface ConfirmationCardProps {
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly date: string
  readonly scope: string
  readonly expiresLabel: string
  readonly statusLine: string
  readonly confirmEnabled: boolean
  readonly declineEnabled: boolean
  readonly blockedReason: string | null
  readonly busy?: boolean
  readonly onConfirm: () => void
  readonly onDecline: () => void
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <dt className="inline text-me-charcoal/55">{label}</dt>
      <dd className="inline text-me-charcoal">{value}</dd>
    </div>
  )
}

export function ConfirmationCard(props: ConfirmationCardProps) {
  const busy = props.busy === true
  return (
    <article className="rounded-xl border border-black/10 bg-white p-5 shadow-card">
      <p className="text-base font-semibold leading-snug text-me-charcoal md:text-lg">{props.what}</p>
      <dl className="mt-4 space-y-2">
        <Row label="账户：" value={props.account} />
        <Row label="金额：" value={props.amount} />
        <Row label="日期：" value={props.date} />
        <Row label="范围：" value={props.scope} />
      </dl>
      <p className="mt-3 text-sm text-me-charcoal/55">{props.expiresLabel}</p>
      <p className="mt-2 text-sm text-me-charcoal">{props.statusLine}</p>
      {props.blockedReason ? (
        <p className="mt-2 text-sm text-status-rej">{props.blockedReason}</p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <MeButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={!props.declineEnabled || busy}
          onClick={props.onDecline}
          className="min-h-11"
        >
          不做
        </MeButton>
        <MeButton
          type="button"
          variant="secondary"
          size="sm"
          disabled={!props.confirmEnabled || busy}
          onClick={props.onConfirm}
          className="min-h-11"
        >
          确认
        </MeButton>
      </div>
    </article>
  )
}
