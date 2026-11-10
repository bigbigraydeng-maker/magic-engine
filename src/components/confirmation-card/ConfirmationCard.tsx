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
  readonly layout?: 'default' | 'ads-health'
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

function touchesMeta(what: string, scope: string): boolean {
  return /(Meta|预算|暂停|打开|投放)/.test(`${what} ${scope}`)
}

export function ConfirmationCard(props: ConfirmationCardProps) {
  const busy = props.busy === true
  const adsHealth = props.layout === 'ads-health'
  const meta = touchesMeta(props.what, props.scope)

  if (adsHealth) {
    return (
      <article className="flex h-full flex-col rounded-xl border border-me-stone bg-white p-5 shadow-card">
        {meta && (
          <p className="mb-3 text-xs font-semibold text-status-rej">会改动 Meta 里的广告</p>
        )}
        <p className="text-base font-semibold leading-snug text-me-charcoal">{props.what}</p>
        <p className="mt-3 rounded-lg bg-me-ivory px-3 py-2 text-sm font-medium tabular-nums text-me-charcoal">{props.amount}</p>
        <div className="mt-4 flex-1 space-y-3 text-sm">
          <div>
            <p className="text-xs font-medium text-me-charcoal/55">为什么</p>
            <p className="mt-1 text-me-charcoal/80">{props.statusLine || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-me-charcoal/55">不会动</p>
            <p className="mt-1 text-me-charcoal/80">{props.scope}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-me-charcoal/45">{props.expiresLabel}</p>
        {props.blockedReason ? (
          <p className="mt-2 text-sm text-status-rej">{props.blockedReason}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <MeButton
            type="button"
            variant="ghost"
            size="sm"
            disabled={!props.declineEnabled || busy}
            onClick={props.onDecline}
            className="min-h-11 flex-1"
          >
            先不动
          </MeButton>
          <MeButton
            type="button"
            variant="primary"
            size="sm"
            disabled={!props.confirmEnabled || busy}
            onClick={props.onConfirm}
            className="min-h-11 flex-1"
          >
            去确认
          </MeButton>
        </div>
      </article>
    )
  }

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
