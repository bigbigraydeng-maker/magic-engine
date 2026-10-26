'use client'

/**
 * The CRM "付款要催" reminder section.
 *
 * Purely presentational: it renders whatever the useNudgeList hook exposes and
 * forwards user actions back through the hook. People without access see
 * nothing at all (loading / hidden render null).
 */

import { useId, useState } from 'react'
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
  const collapsedListId = useId()
  const [collapsedOpen, setCollapsedOpen] = useState(false)

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
  // 没有要催的新款时，这块缩成一条细条：这一页的主角是客人名单，别让一张空卡片把名单往下顶 150 像素。
  const compact = count === 0

  return (
    <section
      data-testid="payment-nudge-section"
      aria-labelledby={headingId}
      className={
        compact
          ? 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-me-charcoal/10 bg-white px-3 py-1.5 text-xs'
          : 'rounded-xl border border-me-charcoal/15 bg-white p-4'
      }
    >
      <div className={compact ? 'flex items-baseline gap-2' : 'flex flex-wrap items-baseline justify-between gap-2'}>
        <h2 id={headingId} className={compact ? 'text-xs font-black text-me-charcoal' : 'text-lg font-black text-me-charcoal'}>
          付款要催
        </h2>
        <span className={MUTED_TEXT}>{countText}</span>
      </div>

      <div className={compact ? '' : 'mt-3'}>
        <BookingNotice message={list.notice} onDismiss={list.clearNotice} />
      </div>

      {count === 0 && nudge.collapsedOverdue === 0 ? (
        <p className={MUTED_TEXT}>现在没有要催的款。</p>
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
        <div className={compact ? 'flex flex-wrap items-center gap-x-3 gap-y-1' : 'mt-3'}>
          {compact ? (
            <p className={MUTED_TEXT}>{`逾期很久（${nudge.collapsedOverdue} 单）· 超过 14 天不逐条列出`}</p>
          ) : (
            <>
              <p className={MUTED_TEXT}>{`逾期很久（${nudge.collapsedOverdue} 单）`}</p>
              <p className={MUTED_TEXT}>已逾期超过 14 天，不再逐条列出。</p>
            </>
          )}
          {nudge.collapsedRows.length > 0 ? (
            <button
              type="button"
              className={`${compact ? '' : 'mt-2 '}${SECONDARY_BUTTON}`}
              aria-expanded={collapsedOpen}
              aria-controls={collapsedListId}
              onClick={() => setCollapsedOpen((open) => !open)}
            >
              {collapsedOpen ? '收起' : '展开看是谁'}
            </button>
          ) : null}
          {collapsedOpen && nudge.collapsedRows.length > 0 ? (
            <ul id={collapsedListId} className="mt-2">
              {nudge.collapsedRows.map((row) => (
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
        </div>
      ) : null}

      {nudge.truncated ? (
        <p className={`mt-3 ${MUTED_TEXT}`}>订单太多，这里只列出了一部分。</p>
      ) : null}
    </section>
  )
}
