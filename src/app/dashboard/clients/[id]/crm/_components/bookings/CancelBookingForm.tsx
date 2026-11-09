'use client'

/**
 * Confirmation panel for cancelling a booking.
 *
 * Requires a short plain-Chinese reason before the destructive action is
 * allowed. Submitting goes through the shared `run` helper; on success the
 * parent is told via `onDone`, otherwise the panel stays open.
 */

import { useId, useState } from 'react'

import type { BookingView } from '@/lib/crm/booking-types'
import { cancelBooking } from './booking-api'
import {
  DANGER_BUTTON,
  ERROR_TEXT,
  INPUT_CLASS,
  LABEL_CLASS,
  SECONDARY_BUTTON,
} from './booking-styles'
import type { RunAction } from './useBookings'

export interface CancelBookingFormProps {
  clientId: string
  booking: BookingView
  busy: boolean
  run: RunAction
  onDone: () => void
  onCancel: () => void
}

export function CancelBookingForm({
  clientId,
  booking,
  busy,
  run,
  onDone,
  onCancel,
}: CancelBookingFormProps): JSX.Element {
  const inputId = useId()
  const [reason, setReason] = useState('')
  const [showError, setShowError] = useState(false)

  const trimmed = reason.trim()
  const canSubmit = !busy && trimmed !== ''

  const submit = async (): Promise<void> => {
    if (trimmed === '') {
      setShowError(true)
      return
    }
    setShowError(false)
    const ok = await run(() => cancelBooking(clientId, booking.id, booking.updatedAt, trimmed))
    if (ok) onDone()
  }

  return (
    <div role="group" aria-label="取消订单" className="flex flex-col gap-2">
      <label className={LABEL_CLASS} htmlFor={inputId}>
        取消原因（写一句话就行，不要写金额）
      </label>
      <input
        id={inputId}
        type="text"
        className={INPUT_CLASS}
        maxLength={200}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value)
          if (showError) setShowError(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {showError ? (
        <p role="alert" className={ERROR_TEXT}>
          请先写一句取消原因
        </p>
      ) : null}
      <p className="text-sm font-semibold text-[#9B2C22]">取消后不能恢复</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={DANGER_BUTTON}
          onClick={() => void submit()}
          disabled={!canSubmit}
        >
          确认取消订单
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onCancel} disabled={busy}>
          先不取消
        </button>
      </div>
    </div>
  )
}
