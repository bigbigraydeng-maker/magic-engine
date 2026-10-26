'use client'

/**
 * The CRM "订单与付款" block mounted inside the guest drawer.
 *
 * Owns the loading / hidden / error / ready rendering for one contact's
 * bookings, the 「＋ 加订单」 toggle and the ordering of the cards (active
 * bookings first, then cancelled ones).
 */

import { useEffect, useId, useRef, useState } from 'react'

import type { BookingView } from '@/lib/crm/booking-types'
import { AddBookingForm } from './AddBookingForm'
import { BookingCard } from './BookingCard'
import { BookingNotice } from './BookingNotice'
import { BookingsErrorBoundary } from './BookingsErrorBoundary'
import { useBookings } from './useBookings'
import { hasFocusBookings, stripFocusFromUrl } from './payments-return'
import {
  ERROR_TEXT,
  MUTED_TEXT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from './booking-styles'

export interface BookingsBlockProps {
  clientId: string
  contactId: string
  /** 原地弹出的抽屉（付款总览页）没有 `focus=bookings` 地址参数，用它直接要求滚到这一段。 */
  scrollIntoViewOnReady?: boolean
}

/** Active bookings first (in given order), then cancelled ones. */
function orderBookings(bookings: BookingView[]): BookingView[] {
  const active = bookings.filter((b) => b.status === 'active')
  const cancelled = bookings.filter((b) => b.status === 'cancelled')
  return [...active, ...cancelled]
}

function BookingsBlockInner({
  clientId,
  contactId,
  scrollIntoViewOnReady = false,
}: BookingsBlockProps): JSX.Element | null {
  const headingId = useId()
  const { state, notice, busy, run, reload, clearNotice } = useBookings(clientId, contactId)
  const [adding, setAdding] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const lastAddingRef = useRef(false)
  const sectionRef = useRef<HTMLElement>(null)
  const scrolledRef = useRef(false)

  // 从付款总览点进来（focus=bookings）：数据加载完后滚到这一段，只滚一次。
  useEffect(() => {
    if (state.status !== 'ready' || scrolledRef.current) return
    if (!scrollIntoViewOnReady && !hasFocusBookings()) return
    scrolledRef.current = true
    sectionRef.current?.scrollIntoView?.({ block: 'start' })
    // 用过一次就从地址栏拿掉，免得换下一位客人时又滚一次、又冒出返回链接。
    stripFocusFromUrl()
  }, [state.status, scrollIntoViewOnReady])

  useEffect(() => {
    const previous = lastAddingRef.current
    lastAddingRef.current = adding
    if (adding || !previous) return
    const target = addButtonRef.current
    if (target !== null && target.isConnected) target.focus()
  }, [adding])

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
    <section ref={sectionRef} id="crm-bookings-block" data-testid="bookings-block" aria-labelledby={headingId} className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id={headingId}
          className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre"
        >
          订单与付款
        </h3>
        <button
          ref={addButtonRef}
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

export function BookingsBlock(props: BookingsBlockProps): JSX.Element {
  return (
    <BookingsErrorBoundary>
      <BookingsBlockInner {...props} />
    </BookingsErrorBoundary>
  )
}
