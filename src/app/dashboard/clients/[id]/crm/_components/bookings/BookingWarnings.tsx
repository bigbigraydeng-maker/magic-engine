'use client'

/**
 * Booking-level warnings shown above the payment items.
 *
 * The parent has already removed the pay-in-full, cruise and per-item
 * warnings, so everything passed here belongs to the booking as a whole.
 * A warning that needs confirmation gets a 「确认」 button next to its text.
 */

import type { BookingWarning } from '@/lib/crm/booking-types'
import { PRIMARY_BUTTON, WARNING_CLASS } from './booking-styles'

export interface BookingWarningsProps {
  warnings: BookingWarning[]
  busy: boolean
  onConfirmDeparture: () => void
}

export function BookingWarnings(props: BookingWarningsProps): JSX.Element | null {
  const { warnings, busy, onConfirmDeparture } = props

  if (warnings.length === 0) return null

  return (
    <div className="space-y-2">
      {warnings.map((warning) =>
        warning.needsConfirm ? (
          <p key={warning.code} className={WARNING_CLASS}>
            <span className="flex flex-wrap items-center gap-2">
              <span>{warning.text}</span>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                aria-label="确认新的出发日期"
                disabled={busy}
                onClick={onConfirmDeparture}
              >
                确认
              </button>
            </span>
          </p>
        ) : (
          <p key={warning.code} className={WARNING_CLASS}>
            {warning.text}
          </p>
        ),
      )}
    </div>
  )
}
