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
  retryLabel?: string | null
  onRetry?: (() => void) | null
  retryDisabled?: boolean
}

export function BookingNotice({ message, onDismiss, retryLabel, onRetry, retryDisabled }: BookingNoticeProps) {
  if (message === null) return null

  return (
    <div role="status" className={`${NOTICE_CLASS} flex items-start justify-between gap-2`}>
      <span>{message}</span>
      <span className="flex shrink-0 flex-wrap gap-2">
        {retryLabel && onRetry ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={retryDisabled}
            aria-label={`${retryLabel}：${message}`}
            onClick={onRetry}
          >
            {retryLabel}
          </button>
        ) : null}
        <button type="button" className={SECONDARY_BUTTON} onClick={onDismiss}>
          知道了
        </button>
      </span>
    </div>
  )
}
