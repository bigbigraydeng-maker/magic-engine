'use client'

/**
 * The CRM "付款要催" reminder section.
 *
 * Purely presentational: it renders whatever the useNudgeList hook exposes and
 * forwards user actions back through the hook. People without access see
 * nothing at all (loading / hidden render null).
 */

import { useId } from 'react'
import { BookingNotice } from './BookingNotice'
import { NudgeRowItem } from './NudgeRowItem'
import { ERROR_TEXT, MUTED_TEXT, SECONDARY_BUTTON } from './booking-styles'
import type { UseNudgeListResult } from './useNudgeList'

interface PaymentNudgeSectionProps {
  list: UseNudgeListResult
  onOpenContact: (contactId: string, contactName: string | null) => void
}

export function PaymentNudgeSection({
  list,
  onOpenContact,
}: PaymentNudgeSectionProps): JSX.Element | null {
  const headingId = useId()

  if (list.state.status === 'loading' || list.state.status === 'hidden') return null

  if (list.state.status === 'error') {
    return (
      <section className="rounded-xl border border-me-charcoal/15 bg-white p-4">
        <p role="alert" className={ERROR_TEXT}>
          {list.state.message}
        </p>
        <button
          type="button"
          className={`mt-3 ${SECONDARY_BUTTON}`}
          onClick={() => void list.reload()}
        >
          重试
        </button>
      </section>
    )
  }

  const { nudge } = list.state
  const count = nudge.rows.length
  const countText = nudge.more ? `共 ${count} 单以上` : `共 ${count} 单`

  return (
    <section
      data-testid="payment-nudge-section"
      aria-labelledby={headingId}
      className="rounded-xl border border-me-charcoal/15 bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-lg font-black text-me-charcoal">
          付款要催
        </h2>
        <span className={MUTED_TEXT}>{countText}</span>
      </div>

      <div className="mt-3">
        <BookingNotice message={list.notice} onDismiss={list.clearNotice} />
      </div>

      {count === 0 && nudge.collapsedOverdue === 0 ? (
        <p className={`mt-3 ${MUTED_TEXT}`}>现在没有要催的款。</p>
      ) : null}

      {count > 0 ? (
        <ul className="mt-2">
          {nudge.rows.map((row) => (
            <NudgeRowItem
              key={row.bookingId}
              row={row}
              busy={list.busyBookingId !== null}
              onOpen={() => onOpenContact(row.contactId, row.contactName)}
              onAct={(mode, days) => void list.act(row, mode, days)}
            />
          ))}
        </ul>
      ) : null}

      {nudge.more && !list.expanded ? (
        <button
          type="button"
          className={`mt-3 ${SECONDARY_BUTTON}`}
          onClick={list.expand}
        >
          展开更多
        </button>
      ) : null}

      {nudge.collapsedOverdue > 0 ? (
        <p className={`mt-3 ${MUTED_TEXT}`}>
          {`逾期很久（${nudge.collapsedOverdue} 单），已逾期超过 14 天，不再逐条列出，请到客人页面里查看。`}
        </p>
      ) : null}

      {nudge.truncated ? (
        <p className={`mt-3 ${MUTED_TEXT}`}>订单太多，这里只列出了一部分。</p>
      ) : null}
    </section>
  )
}
