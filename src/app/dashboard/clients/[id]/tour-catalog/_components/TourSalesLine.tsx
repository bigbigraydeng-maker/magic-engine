'use client'

/**
 * 「销售情况」: how many orders this tour has, per departure, and how many have paid the deposit /
 * the balance. Counts orders only, never money.
 *
 * It reads the CRM payment overview through its own endpoint, so the CRM's access list decides who
 * sees it: a 403/404 means "not for this person" and the block simply does not appear. Nothing here
 * touches the catalog tables, and the catalog's own data is not changed by it.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { OverviewGroup } from '@/lib/crm/booking-overview-types'
import { fetchOverview } from '../../crm/payments/_components/payments-api'

type SalesState =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'error' }
  | { kind: 'ok'; groups: OverviewGroup[] }

const ALL_ORDERS_QUERY = {
  departureId: null,
  tourId: null,
  status: 'all',
  page: 1,
  includePastPaid: true,
} as const

/** Groups of this tour only: orders without a departure belong to a tour too, undecided ones have none. */
export function groupsOfTour(groups: OverviewGroup[], tourId: string): OverviewGroup[] {
  return groups.filter((g) => g.tourId === tourId)
}

function groupLabel(g: OverviewGroup): string {
  if (g.kind === 'departure' && g.departOn) return g.departOn
  return '出发日期不明'
}

export function TourSalesLine(props: { clientId: string; tourId: string }): JSX.Element | null {
  const { clientId, tourId } = props
  const [state, setState] = useState<SalesState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    setState({ kind: 'loading' })
    void fetchOverview(clientId, ALL_ORDERS_QUERY, controller.signal).then((res) => {
      if (controller.signal.aborted) return
      if (res.kind === 'hidden') setState({ kind: 'hidden' })
      else if (res.kind === 'error') setState({ kind: 'error' })
      else setState({ kind: 'ok', groups: res.data.summary.groups })
    })
    return () => controller.abort()
  }, [clientId])

  if (state.kind === 'loading' || state.kind === 'hidden') return null
  if (state.kind === 'error') {
    return <p className="text-sm text-me-charcoal/60">销售情况暂时读不到，刷新再试。</p>
  }

  const groups = groupsOfTour(state.groups, tourId)
  const orders = groups.reduce((n, g) => n + g.orders, 0)
  const href = `/dashboard/clients/${clientId}/crm/payments?tourId=${encodeURIComponent(tourId)}&includePastPaid=true`

  return (
    <section data-testid="tour-sales" className="rounded-lg border border-black/10 bg-me-ivory p-3">
      <h3 className="text-sm font-black text-me-charcoal">销售情况（只数订单，不含金额）</h3>
      {orders === 0 ? (
        <p className="mt-1 text-sm text-me-charcoal/70">这个团还没有订单。</p>
      ) : (
        <>
          <p className="mt-1 text-sm font-semibold text-me-charcoal">
            {`共 ${orders} 单 · 定金已收 ${groups.reduce((n, g) => n + g.depositPaid, 0)} · 尾款已收 ${groups.reduce((n, g) => n + g.balancePaid, 0)} · 还没收齐 ${groups.reduce((n, g) => n + g.unsettled, 0)}`}
          </p>
          <ul className="mt-2 space-y-0.5 text-sm text-me-charcoal">
            {groups.filter((g) => g.orders > 0).map((g) => (
              <li key={g.key}>
                {`${groupLabel(g)}：${g.orders} 单，定金已收 ${g.depositPaid}，尾款已收 ${g.balancePaid}，还没收齐 ${g.unsettled}`}
              </li>
            ))}
          </ul>
        </>
      )}
      <Link href={href} className="mt-2 inline-block text-xs font-bold text-me-charcoal/70 underline">
        在付款总览里看明细
      </Link>
    </section>
  )
}
