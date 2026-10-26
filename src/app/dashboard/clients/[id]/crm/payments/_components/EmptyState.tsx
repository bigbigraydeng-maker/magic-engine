'use client'

import { useEffect, useState } from 'react'
import { MUTED_TEXT } from '../../_components/bookings/booking-styles'
import { fetchOptions } from '../../_components/bookings/booking-api'

export interface EmptyStateProps {
  clientId: string
}

export function EmptyState(props: EmptyStateProps): JSX.Element {
  const { clientId } = props
  const [futureCount, setFutureCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchOptions(clientId).then((result) => {
      if (cancelled) return
      if (!result.ok) return
      const tours = result.data.tours
      if (!Array.isArray(tours)) return
      const n = tours.reduce(
        (sum, tour) => sum + (Array.isArray(tour.departures) ? tour.departures.length : 0),
        0,
      )
      if (n > 0) setFutureCount(n)
    })
    return () => {
      cancelled = true
    }
  }, [clientId])

  return (
    <div>
      <p>还没有录过订单，所以这里暂时没有数字。</p>
      <p>在「全部客人」里打开一个客人 →「订单与付款」→「＋ 加订单」，录第一单之后这页就会有内容。</p>
      {futureCount !== null ? (
        <p className={MUTED_TEXT}>{`（这个客户目前有 ${futureCount} 个可选的未来出发日期）`}</p>
      ) : null}
    </div>
  )
}
