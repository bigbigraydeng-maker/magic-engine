'use client'

/**
 * Two linked pickers for choosing a tour and one of its departure dates.
 *
 * The departure list is derived from the chosen tour. When the chosen tour is
 * no longer present in the catalog we still render its value so the select
 * stays consistent with the saved booking.
 */

import type { BookingOptionTour } from '@/lib/crm/booking-options'
import { departureLabel, departureStatusNote } from './booking-format'
import { INPUT_CLASS, LABEL_CLASS, MUTED_TEXT } from './booking-styles'

interface TourDeparturePickerProps {
  tours: BookingOptionTour[]
  tourId: string
  departureId: string
  onChange: (tourId: string, departureId: string) => void
  idPrefix: string
  disabled?: boolean
}

export function TourDeparturePicker({
  tours,
  tourId,
  departureId,
  onChange,
  idPrefix,
  disabled = false,
}: TourDeparturePickerProps) {
  const tourSelectId = `${idPrefix}-tour`
  const departureSelectId = `${idPrefix}-departure`

  const selectedTour = tours.find((tour) => tour.id === tourId) ?? null
  const tourMissing = tourId !== '' && selectedTour === null
  const departures = selectedTour?.departures ?? []
  const departureDisabled = disabled || tourId === ''
  const departureMissing =
    departureId !== '' && !departures.some((departure) => departure.id === departureId)

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={LABEL_CLASS} htmlFor={tourSelectId}>
          团
        </label>
        <select
          id={tourSelectId}
          className={INPUT_CLASS}
          value={tourId}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value, '')}
        >
          <option value="">请选一个团</option>
          {tourMissing ? (
            <option value={tourId}>（目录里已找不到这个团）</option>
          ) : null}
          {tours.map((tour) => (
            <option key={tour.id} value={tour.id}>
              {tour.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={LABEL_CLASS} htmlFor={departureSelectId}>
          出发日期
        </label>
        <select
          id={departureSelectId}
          className={INPUT_CLASS}
          value={departureId}
          disabled={departureDisabled}
          onChange={(event) => onChange(tourId, event.target.value)}
        >
          <option value="">出发日期还没定</option>
          {departureMissing ? (
            <option value={departureId}>（当前已选的出发日期，目录里已不在可选范围）</option>
          ) : null}
          {departures.map((departure) => (
            <option key={departure.id} value={departure.id}>
              {`${departureLabel(departure.departOn, departure.returnOn)}${departureStatusNote(departure.status)}`}
            </option>
          ))}
        </select>
        {tourId !== '' && departures.length === 0 ? (
          <p className={`mt-1 ${MUTED_TEXT}`}>
            这个团目前没有可选的出发日期，可以先选「出发日期还没定」，以后再补。
          </p>
        ) : null}
      </div>
    </div>
  )
}
