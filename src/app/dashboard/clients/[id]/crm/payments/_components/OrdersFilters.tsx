'use client'

import { useId } from 'react'
import { INPUT_CLASS, LABEL_CLASS, SECONDARY_BUTTON } from '../../_components/bookings/booking-styles'
import { STATUS_OPTIONS } from './payments-query'
import type { StatusParam } from './payments-query'

interface OrdersFiltersProps {
  tours: Array<{ id: string; name: string }>
  tourId: string | null
  status: StatusParam
  selectedDepartureLabel: string | null
  onTourChange: (tourId: string | null) => void
  onStatusChange: (status: StatusParam) => void
  onClearDeparture: () => void
}

export function OrdersFilters(props: OrdersFiltersProps): JSX.Element {
  const tourSelectId = useId()
  const statusSelectId = useId()

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={tourSelectId} className={LABEL_CLASS}>
          团
        </label>
        <select
          id={tourSelectId}
          className={`${INPUT_CLASS} w-auto`}
          value={props.tourId ?? ''}
          onChange={(e) => props.onTourChange(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">全部</option>
          {props.tours.map((tour) => (
            <option key={tour.id} value={tour.id}>
              {tour.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={statusSelectId} className={LABEL_CLASS}>
          状态
        </label>
        <select
          id={statusSelectId}
          className={`${INPUT_CLASS} w-auto`}
          value={props.status}
          onChange={(e) => {
            const found = STATUS_OPTIONS.find((o) => o.value === e.target.value)
            if (found) props.onStatusChange(found.value)
          }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {props.selectedDepartureLabel !== null && (
        <div className="flex items-end gap-3">
          <span className="text-sm font-semibold text-me-charcoal">
            只看：{props.selectedDepartureLabel}
          </span>
          <button type="button" className={SECONDARY_BUTTON} onClick={props.onClearDeparture}>
            看全部出发日期
          </button>
        </div>
      )}
    </div>
  )
}
