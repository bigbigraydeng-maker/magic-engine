'use client'

/**
 * A dismissible inline notice used across the booking screens.
 *
 * Renders nothing when there is no message to show.
 */

import { NOTICE_CLASS, SECONDARY_BUTTON } from './booking-styles'

interface BookingNoticeProps {
  message: string | null
  onDismiss: () => void
}

export function BookingNotice({ message, onDismiss }: BookingNoticeProps) {
  if (message === null) return null

  return (
    <div role="status" className={`${NOTICE_CLASS} flex items-start justify-between gap-2`}>
      <span>{message}</span>
      <button type="button" className={SECONDARY_BUTTON} onClick={onDismiss}>
        知道了
      </button>
    </div>
  )
}
