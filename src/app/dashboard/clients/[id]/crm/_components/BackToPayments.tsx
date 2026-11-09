'use client'

/** 「← 回付款进度」: shown at the top of the guest drawer only when the URL has `focus=bookings`. */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { hasFocusBookings, paymentsReturnHref } from './bookings/payments-return'

export function BackToPayments({ clientId }: { clientId: string }): JSX.Element | null {
  const [href, setHref] = useState<string | null>(null)

  useEffect(() => {
    setHref(hasFocusBookings() ? paymentsReturnHref(clientId) : null)
  }, [clientId])

  if (href === null) return null
  return (
    <Link
      href={href}
      className="mb-3 inline-flex min-h-[40px] items-center rounded-lg px-1 text-sm font-bold text-me-charcoal underline focus:outline-none focus-visible:ring-2 focus-visible:ring-me-ochre"
    >
      ← 回付款进度
    </Link>
  )
}
