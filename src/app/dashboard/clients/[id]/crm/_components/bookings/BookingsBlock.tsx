'use client'

/**
 * The CRM "订单与付款" block mounted inside the guest drawer.
 *
 * Owns the loading / hidden / error / ready rendering for one contact's
 * bookings, the 「＋ 加订单」 toggle and the ordering of the cards (active
 * bookings first, then cancelled ones).
 */

import { useId, useState } from 'react'

import type { BookingView } from '@/lib/crm/booking-types'
import { AddBookingForm } from './AddBookingForm'
import { BookingCard } from './BookingCard'
import { BookingNotice } from './BookingNotice'
import { useBookings } from './useBookings'
import {
  ERROR_TEXT,
  MUTED_TEXT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from './booking-styles'

export interface BookingsBlockProps {
  clientId: string
  contactId: string
}

/** Active bookings first (in given order), then cancelled ones. */
function orderBookings(bookings: BookingView[]): BookingView[] {
  const active = bookings.filter((b) => b.status === 'active')
  const cancelled = bookings.filter((b) => b.status === 'cancelled')
  return [...active, ...cancelled]
}

export function BookingsBlock({
  clientId,
  contactId,
}: BookingsBlockProps): JSX.Element | null {
  const headingId = useId()
  const { state, notice, busy, run, reload, clearNotice } = useBookings(clientId, contactId)
  const [adding, setAdding] = useState(false)

  if (state.status === 'loading' || state.status === 'hidden') {
    return null
  }

  if (state.status === 'error') {
    return (
      <section className="mt-5 space-y-2">
        <h3
          id={headingId}
          className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre"
        >
          订单与付款
        </h3>
        <p role="alert" className={ERROR_TEXT}>
          {state.message}
        </p>
        <button type="button" className={SECONDARY_BUTTON} onClick={() => void reload()}>
          重试
        </button>
      </section>
    )
  }

  const ordered = orderBookings(state.bookings)

  return (
    <section data-testid="bookings-block" aria-labelledby={headingId} className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id={headingId}
          className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre"
        >
          订单与付款
        </h3>
        <button
          type="button"
          className={PRIMARY_BUTTON}
          aria-expanded={adding}
          disabled={busy}
          onClick={() => setAdding((open) => !open)}
        >
          ＋ 加订单
        </button>
      </div>

      <BookingNotice message={notice} onDismiss={clearNotice} />

      {adding ? (
        <AddBookingForm
          clientId={clientId}
          contactId={contactId}
          busy={busy}
          run={run}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      {ordered.length === 0 && !adding ? (
        <p className={MUTED_TEXT}>还没有订单。点右上角「＋ 加订单」。</p>
      ) : null}

      <div className="space-y-3">
        {ordered.map((booking) => (
          <BookingCard
            key={booking.id}
            clientId={clientId}
            booking={booking}
            busy={busy}
            run={run}
          />
        ))}
      </div>
    </section>
  )
}
