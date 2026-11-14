'use client'

/**
 * The card a person sees. Plain sentences only.
 * The fingerprint and the approval id stay off this component.
 */

import type { AddCreativeCardDetail } from '@/lib/ads-creative-card/display'
import type { CardStatus } from '@/lib/confirmation-card/view'
import { AddCreativeCardDetails } from './AddCreativeCardDetails'
import { expiryBadgeText, touchesMetaAds } from './card-display'

export interface ConfirmationCardProps {
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly date: string
  readonly scope: string
  readonly expiresLabel: string
  readonly statusLine: string
  readonly status?: CardStatus
  readonly confirmEnabled: boolean
  readonly declineEnabled: boolean
  readonly blockedReason: string | null
  readonly busy?: boolean
  readonly muted?: boolean
  readonly goLiveHref?: string
  readonly goLiveLabel?: string
  readonly onConfirm: () => void
  readonly onDecline: () => void
  readonly addCreativeDetail?: AddCreativeCardDetail | null
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm leading-relaxed text-me-charcoal">
      <span className="font-semibold text-me-charcoal/55">{label}</span>
      <span className="text-me-charcoal">{value}</span>
    </div>
  )
}

export function ConfirmationCard(props: ConfirmationCardProps) {
  const busy = props.busy === true
  const muted = props.muted === true
  const showMeta = touchesMetaAds(props.what)
  const expiryBadge = expiryBadgeText(props.expiresLabel)
  const showActions = !props.goLiveHref
  const addCreative = props.addCreativeDetail ?? null

  return (
    <article
      className={`rounded-2xl border border-black/10 bg-white p-5 shadow-sm ${muted ? 'opacity-60' : ''}`}
      data-status={props.status ?? 'waiting'}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {showMeta ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 font-semibold text-red-800">
            <span aria-hidden>⚠</span>
            会改动 Meta 里的广告
          </span>
        ) : null}
        <span className="rounded-full bg-me-charcoal/5 px-2.5 py-1 font-medium text-me-charcoal/70">
          {expiryBadge}
        </span>
      </div>

      <p className="mt-4 text-lg font-bold leading-snug text-me-charcoal">{props.what}</p>

      {addCreative ? (
        <AddCreativeCardDetails detail={addCreative} expiresLabel={props.expiresLabel} />
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_200px]">
          <div className="space-y-2">
            <DetailRow label="账户：" value={props.account} />
            <DetailRow label="金额：" value={props.amount} />
            <DetailRow label="日期：" value={props.date} />
            <DetailRow label="范围：" value={props.scope} />
            {props.status === 'expired' || props.status === 'voided' ? (
              <DetailRow label="结果：" value={props.statusLine} />
            ) : (
              <DetailRow label="状态：" value={props.statusLine} />
            )}
          </div>

          <div className="rounded-xl bg-me-charcoal/[0.04] p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-me-charcoal/45">变动</p>
            <p className="mt-2 text-sm font-semibold text-me-charcoal">{props.amount}</p>
            <p className="mt-1 text-xs text-me-charcoal/55">{props.date}</p>
          </div>
        </div>
      )}

      {addCreative ? (
        <div className="mt-3 space-y-1">
          {(props.status === 'expired' || props.status === 'voided' || props.status === 'confirmed' || props.status === 'declined') ? (
            <DetailRow
              label={props.status === 'expired' || props.status === 'voided' ? '结果：' : '状态：'}
              value={props.statusLine}
            />
          ) : (
            <DetailRow label="状态：" value={props.statusLine} />
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-me-charcoal/55">{props.expiresLabel}</p>
      )}

      {props.blockedReason ? (
        <p className="mt-2 text-sm text-red-700">{props.blockedReason}</p>
      ) : null}

      {props.goLiveHref ? (
        <p className="mt-4 text-base">
          <a className="font-semibold text-me-charcoal underline" href={props.goLiveHref}>
            {props.goLiveLabel ?? '去 等你点头的广告 页确认'}
          </a>
        </p>
      ) : null}

      {showActions ? (
        <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex gap-2 sm:order-2">
            <button
              type="button"
              disabled={!props.declineEnabled || busy}
              onClick={props.onDecline}
              className="rounded-full border border-black/15 bg-white px-5 py-2.5 text-sm font-semibold text-me-charcoal disabled:bg-me-charcoal/5 disabled:text-me-charcoal/35"
            >
              不做
            </button>
            <button
              type="button"
              disabled={!props.confirmEnabled || busy}
              onClick={props.onConfirm}
              className="rounded-full bg-me-charcoal px-5 py-2.5 text-sm font-semibold text-white disabled:bg-me-charcoal/15 disabled:text-me-charcoal/40"
            >
              确认
            </button>
          </div>
          <p className="text-xs text-me-charcoal/50 sm:order-1 sm:mr-auto sm:max-w-xs sm:text-right">
            确认时会再核对一次，条件不成立就拒绝。
          </p>
        </div>
      ) : null}
    </article>
  )
}
