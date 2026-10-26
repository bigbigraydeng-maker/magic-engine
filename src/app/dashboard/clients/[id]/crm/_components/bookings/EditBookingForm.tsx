'use client'

/**
 * The 「改团/出发日期」 panel for a single booking.
 *
 * Loads the tour catalog, lets staff pick a different tour and departure,
 * and saves the change. Already-received payments are preserved by the
 * server, which the muted note reminds staff about.
 */

import { useId, useState } from 'react'

import type { BookingView } from '@/lib/crm/booking-types'
import { patchBooking } from './booking-api'
import { TourDeparturePicker } from './TourDeparturePicker'
import { useCatalogOptions } from './useCatalogOptions'
import type { RunAction } from './useBookings'
import {
  ERROR_TEXT,
  MUTED_TEXT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from './booking-styles'

interface EditBookingFormProps {
  clientId: string
  booking: BookingView
  busy: boolean
  run: RunAction
  onDone: () => void
  onCancel: () => void
}

export function EditBookingForm({
  clientId,
  booking,
  busy,
  run,
  onDone,
  onCancel,
}: EditBookingFormProps) {
  const idPrefix = useId()
  const { state, retry } = useCatalogOptions(clientId)
  const [tourId, setTourId] = useState(booking.tourId)
  const [departureId, setDepartureId] = useState(booking.departureId ?? '')

  const changed =
    tourId !== booking.tourId || departureId !== (booking.departureId ?? '')
  const saveDisabled = busy || !changed || tourId === ''

  async function handleSave(): Promise<void> {
    const ok = await run(() =>
      patchBooking(clientId, booking.id, booking.updatedAt, {
        tourId,
        departureId: departureId === '' ? null : departureId,
      }),
    )
    if (ok) onDone()
  }

  return (
    <div role="group" aria-label="改团或出发日期" className="grid gap-3">
      {state.status === 'loading' ? (
        <p className={MUTED_TEXT}>正在读团目录…</p>
      ) : null}

      {state.status === 'error' ? (
        <div className="grid gap-2">
          <p role="alert" className={ERROR_TEXT}>
            {state.message}
          </p>
          <button type="button" className={SECONDARY_BUTTON} onClick={retry}>
            重试
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <TourDeparturePicker
            tours={state.tours}
            tourId={tourId}
            departureId={departureId}
            onChange={(nextTourId, nextDepartureId) => {
              setTourId(nextTourId)
              setDepartureId(nextDepartureId)
            }}
            idPrefix={idPrefix}
            disabled={busy}
          />
          <p className={MUTED_TEXT}>已经收到的款会保留，不会清掉。</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={saveDisabled}
              onClick={() => void handleSave()}
            >
              保存
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={busy}
              onClick={onCancel}
            >
              先不改
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
