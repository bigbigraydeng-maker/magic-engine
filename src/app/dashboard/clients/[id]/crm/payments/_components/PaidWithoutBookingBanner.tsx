'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { WARNING_CLASS, MUTED_TEXT, SECONDARY_BUTTON } from '../../_components/bookings/booking-styles'
import { stashContactName } from '../../_components/bookings/payments-return'
import { stageText } from './payments-format'

export interface PaidWithoutBookingRow {
  id: string
  name: string | null
  stage: string
}

export interface PaidWithoutBookingBannerProps {
  clientId: string
  total: number
  rows: PaidWithoutBookingRow[]
  onLeave?: () => void
}

export function PaidWithoutBookingBanner(
  props: PaidWithoutBookingBannerProps,
): JSX.Element | null {
  const { clientId, total, rows, onLeave } = props
  const [expanded, setExpanded] = useState(false)
  const listId = useId()

  if (total <= 0) return null

  const hidden = total - rows.length

  return (
    <div role="note" className={WARNING_CLASS}>
      <p>
        {`⚠ 另有 ${total} 位客人的阶段已经是「已付定金」「已付全款」或「即将出行」，但一张订单都没有 —— 他们的付款在这页看不见，先给他们补录订单。`}
      </p>
      <button
        type="button"
        className={`${SECONDARY_BUTTON} mt-2`}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((v) => !v)}
      >
        看名单
      </button>
      {expanded ? (
        <ul id={listId} className="mt-2 max-h-72 overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="py-1">
              <Link
                href={`/dashboard/clients/${clientId}/crm/all?contact=${encodeURIComponent(row.id)}&focus=bookings`}
                onClick={() => {
                  stashContactName(clientId, row.id, row.name)
                  onLeave?.()
                }}
                className="inline-flex min-h-[40px] items-center underline font-bold"
              >
                {row.name ?? '（没有姓名）'}
              </Link>
              <span className={`${MUTED_TEXT} ml-2`}>{stageText(row.stage)}</span>
            </li>
          ))}
          {hidden > 0 ? (
            <li className={`${MUTED_TEXT} py-1`}>{`还有 ${hidden} 位没列出`}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
