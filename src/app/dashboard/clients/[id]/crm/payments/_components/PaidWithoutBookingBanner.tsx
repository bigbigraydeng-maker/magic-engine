'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { WARNING_CLASS, MUTED_TEXT, SECONDARY_BUTTON } from '../../_components/bookings/booking-styles'
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
  /** 点名字：原地弹出这位客人的抽屉（不传就按普通链接跳走）。 */
  onOpenContact?: (id: string, name: string | null) => void
}

export function PaidWithoutBookingBanner(
  props: PaidWithoutBookingBannerProps,
): JSX.Element | null {
  const { clientId, total, rows, onOpenContact } = props
  const [expanded, setExpanded] = useState(false)
  const listId = useId()

  if (total <= 0) return null

  const hidden = total - rows.length

  return (
    <div role="note" className={WARNING_CLASS}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p>
          {`⚠ 另有 ${total} 位客人已付款（定金 / 全款 / 即将出行），但还没有订单，付款在这页看不到。`}
        </p>
        <button
          type="button"
          className={`${SECONDARY_BUTTON} min-h-[32px] px-3 py-1 text-xs`}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起名单' : '看名单'}
        </button>
      </div>
      {expanded ? (
        <ul id={listId} className="mt-2 max-h-72 overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="py-1">
              <Link
                href={`/dashboard/clients/${clientId}/crm/all?contact=${encodeURIComponent(row.id)}&focus=bookings`}
                onClick={(e) => {
                  if (!onOpenContact || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                  e.preventDefault()
                  onOpenContact(row.id, row.name)
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
