'use client'

/**
 * The card a person sees. Plain sentences only.
 * The fingerprint and the approval id stay off this component.
 */

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
    <div>
      <dt className="inline text-neutral-500">{label}</dt>
      <dd className="inline text-neutral-900">{value}</dd>
    </div>
  )
}

export function ConfirmationCard(props: ConfirmationCardProps) {
  const busy = props.busy === true
  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="text-lg font-medium text-neutral-900">{props.what}</p>
      <dl className="mt-4 space-y-2 text-base">
        <Row label="账户：" value={props.account} />
        <Row label="金额：" value={props.amount} />
        <Row label="日期：" value={props.date} />
        <Row label="范围：" value={props.scope} />
      </dl>
      <p className="mt-3 text-sm text-neutral-600">{props.expiresLabel}</p>
      <p className="mt-2 text-base text-neutral-800">{props.statusLine}</p>
      {props.blockedReason ? (
        <p className="mt-2 text-base text-red-700">{props.blockedReason}</p>
      ) : null}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          disabled={!props.confirmEnabled || busy}
          onClick={props.onConfirm}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-base text-white disabled:bg-neutral-200 disabled:text-neutral-500"
        >
          确认
        </button>
        <button
          type="button"
          disabled={!props.declineEnabled || busy}
          onClick={props.onDecline}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-base text-neutral-900 disabled:bg-neutral-100 disabled:text-neutral-400"
        >
          不做
        </button>
      </div>
    </article>
  )
}
