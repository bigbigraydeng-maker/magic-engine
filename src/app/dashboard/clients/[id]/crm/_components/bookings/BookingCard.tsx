'use client'

/**
 * One booking card inside the CRM "订单与付款" block.
 *
 * Shows the heading, any booking-level warnings, the payment items, the
 * note editor and the action row that opens the edit / cancel panels.
 * Cancelled bookings render a compact read-only summary instead.
 */

import { useState } from 'react'

import type { BookingView, BookingWarning } from '@/lib/crm/booking-types'
import { confirmDeparture } from './booking-api'
import { bookingTitle } from './booking-format'
import { BookingWarnings } from './BookingWarnings'
import { CancelBookingForm } from './CancelBookingForm'
import { EditBookingForm } from './EditBookingForm'
import { MilestoneRow } from './MilestoneRow'
import { NoteEditor } from './NoteEditor'
import type { RunAction } from './useBookings'
import {
  CARD_CLASS,
  DANGER_BUTTON,
  MUTED_TEXT,
  SECONDARY_BUTTON,
  WARNING_CLASS,
} from './booking-styles'

export interface BookingCardProps {
  clientId: string
  booking: BookingView
  busy: boolean
  run: RunAction
}

type Panel = 'none' | 'edit' | 'cancel'

/** Booking-level warnings that belong above the payment items. */
function topWarnings(warnings: BookingWarning[]): BookingWarning[] {
  return warnings.filter(
    (w) => w.kind === null && w.code !== 'pay_in_full' && w.code !== 'cruise_not_ticked' && w.code !== 'lead_cruise_note',
  )
}

/** The 「已取消」 badge plus the cancel reason line. */
function CancelledSummary({ booking }: { booking: BookingView }): JSX.Element {
  return (
    <div className="space-y-1">
      <span className="inline-block rounded-full border border-me-charcoal/20 bg-white px-2 py-0.5 text-xs font-semibold text-me-charcoal/80">
        已取消
      </span>
      <p className={MUTED_TEXT}>原因：{booking.cancelNote ?? '（没写）'}</p>
    </div>
  )
}

/** The action row that toggles the edit / cancel panels. */
function ActionRow({
  panel,
  busy,
  onToggle,
}: {
  panel: Panel
  busy: boolean
  onToggle: (next: Panel) => void
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={SECONDARY_BUTTON}
        disabled={busy}
        aria-expanded={panel === 'edit'}
        onClick={() => onToggle(panel === 'edit' ? 'none' : 'edit')}
      >
        改团/出发日期
      </button>
      <button
        type="button"
        className={DANGER_BUTTON}
        disabled={busy}
        aria-expanded={panel === 'cancel'}
        onClick={() => onToggle(panel === 'cancel' ? 'none' : 'cancel')}
      >
        取消订单
      </button>
    </div>
  )
}

export function BookingCard({
  clientId,
  booking,
  busy,
  run,
}: BookingCardProps): JSX.Element {
  const [panel, setPanel] = useState<Panel>('none')

  const cancelled = booking.status === 'cancelled'
  const cardClass = cancelled
    ? `${CARD_CLASS} space-y-2 opacity-80 bg-me-ivory/60`
    : `${CARD_CLASS} space-y-2`

  const cruiseWarning = booking.warnings.find((w) => w.code === 'cruise_not_ticked' || w.code === 'lead_cruise_note')

  return (
    <article data-testid="booking-card" aria-label={bookingTitle(booking)} className={cardClass}>
      <h3 className="text-base font-black text-me-charcoal">{bookingTitle(booking)}</h3>

      {cancelled ? (
        <>
          <CancelledSummary booking={booking} />
          <ul className="mt-2 space-y-2">
            {booking.milestones.map((milestone) => (
              <MilestoneRow
                key={milestone.kind}
                clientId={clientId}
                booking={booking}
                milestone={milestone}
                warnings={booking.warnings.filter((w) => w.kind === milestone.kind)}
                busy={busy}
                readOnly
                run={run}
              />
            ))}
          </ul>
        </>
      ) : (
        <>
          {booking.payInFull ? (
            <p className={WARNING_CLASS}>这单离出发太近，需一次付清</p>
          ) : null}

          <BookingWarnings
            warnings={topWarnings(booking.warnings)}
            busy={busy}
            onConfirmDeparture={() =>
              void run(() => confirmDeparture(clientId, booking.id, booking.updatedAt))
            }
          />

          <ul className="space-y-2">
            {booking.milestones.map((milestone) => (
              <MilestoneRow
                key={milestone.kind}
                clientId={clientId}
                booking={booking}
                milestone={milestone}
                warnings={booking.warnings.filter((w) => w.kind === milestone.kind)}
                busy={busy}
                run={run}
              />
            ))}
          </ul>

          {cruiseWarning ? <p className={MUTED_TEXT}>{cruiseWarning.text}</p> : null}

          <NoteEditor clientId={clientId} booking={booking} busy={busy} run={run} />

          <ActionRow panel={panel} busy={busy} onToggle={setPanel} />

          {panel === 'edit' ? (
            <EditBookingForm
              clientId={clientId}
              booking={booking}
              busy={busy}
              run={run}
              onDone={() => setPanel('none')}
              onCancel={() => setPanel('none')}
            />
          ) : null}

          {panel === 'cancel' ? (
            <CancelBookingForm
              clientId={clientId}
              booking={booking}
              busy={busy}
              run={run}
              onDone={() => setPanel('none')}
              onCancel={() => setPanel('none')}
            />
          ) : null}
        </>
      )}
    </article>
  )
}
