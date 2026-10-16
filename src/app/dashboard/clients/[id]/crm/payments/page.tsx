'use client'

/**
 * 付款总览（只读）—— 按订单数统计，系统不记金额。
 *
 * 页面地址栏里的查询串就是发给服务端的查询串（同一份参数名），
 * 每次筛选变化都 push 一条历史记录，浏览器后退键能回到上一组筛选。
 * 数据加载与竞态处理在 usePaymentsOverview 里，这里只负责呈现。
 */

import { Suspense, useCallback, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CrmTabs } from '../_components/CrmTabs'
import { SECONDARY_BUTTON } from '../_components/bookings/booking-styles'
import { ContactDrawerHost } from '../_components/ContactDrawerHost'
import { SummaryTable } from './_components/SummaryTable'
import { SummaryFooter } from './_components/SummaryFooter'
import { PaidWithoutBookingBanner } from './_components/PaidWithoutBookingBanner'
import { PaymentsErrorBoundary } from './_components/PaymentsErrorBoundary'
import { EmptyState } from './_components/EmptyState'
import { OrdersFilters } from './_components/OrdersFilters'
import { OrdersTable } from './_components/OrdersTable'
import { usePaymentsOverview } from './_components/usePaymentsOverview'
import { PAGE_HEADING, groupTitle } from './_components/payments-format'
import {
  parsePaymentsQuery,
  toSearchString,
  withChange,
  type PaymentsQuery,
  type StatusParam,
} from './_components/payments-query'
import type { OverviewPayload } from '@/lib/crm/booking-overview-load'
import type { OverviewListRow } from '@/lib/crm/booking-overview-types'

const MUTED_LINE = 'text-sm text-me-charcoal/70'

export default function CrmPaymentsPage(): JSX.Element {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-me-charcoal/70">加载中…</p>}>
      <PaymentsPageInner />
    </Suspense>
  )
}

function PaymentsPageInner(): JSX.Element {
  const clientId = useParams().id as string
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = useMemo(() => parsePaymentsQuery(searchParams), [searchParams])
  const { state, retry } = usePaymentsOverview(clientId, query)
  const base = `/dashboard/clients/${clientId}/crm/payments`

  const navigate = useCallback(
    (change: Partial<PaymentsQuery>) => {
      router.push(base + toSearchString(withChange(query, change)), { scroll: false })
    },
    [router, base, query],
  )

  // 点客人：原地弹出抽屉，筛选、页码、滚动位置都不动；关掉后刷新一次数字（抽屉里可能改了付款）。
  const [openContact, setOpenContact] = useState<{ id: string; name: string | null } | null>(null)
  const onOpenContact = useCallback((id: string, name: string | null) => setOpenContact({ id, name }), [])
  const onOpenRow = useCallback((row: OverviewListRow) => onOpenContact(row.contactId, row.contactName), [onOpenContact])
  const closeContact = useCallback(() => {
    setOpenContact(null)
    retry()
  }, [retry])

  if (state.status === 'hidden') {
    return <p className="p-6 text-sm text-me-charcoal/70">这一页没有开通</p>
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <PageHeader clientId={clientId} />
      {state.status === 'loading' && (
        <p
          role="status"
          className="animate-pulse rounded-lg bg-me-charcoal/10 px-3 py-3 text-sm text-me-charcoal/60"
        >
          正在加载付款总览…
        </p>
      )}
      {state.status === 'error' && <ErrorBranch retry={retry} />}
      {state.status === 'ready' && (
        <PaymentsErrorBoundary resetKey={state.data} fallback={<ErrorBranch retry={retry} />}>
          <ReadyView
            clientId={clientId}
            query={query}
            data={state.data}
            refreshing={state.refreshing}
            navigate={navigate}
            onOpenRow={onOpenRow}
            onOpenContact={onOpenContact}
          />
        </PaymentsErrorBoundary>
      )}
      {openContact !== null && (
        <ContactDrawerHost
          clientId={clientId}
          contactId={openContact.id}
          name={openContact.name}
          scrollToBookings
          onClose={closeContact}
        />
      )}
    </div>
  )
}

function ErrorBranch(props: { retry: () => void }): JSX.Element {
  return (
    <div role="alert" className="space-y-2">
      <p className={MUTED_LINE}>付款总览暂时算不出来，请稍后再试</p>
      <button type="button" className={SECONDARY_BUTTON} onClick={props.retry}>
        重试
      </button>
    </div>
  )
}

function PageHeader(props: { clientId: string }): JSX.Element {
  return (
    <div>
      <Link
        href={`/dashboard/clients/${props.clientId}`}
        className="text-sm text-me-charcoal/40 hover:text-me-charcoal"
      >
        ← 返回客户
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black text-me-charcoal">付款总览</h1>
        <CrmTabs clientId={props.clientId} active="payments" />
      </div>
    </div>
  )
}

interface ReadyViewProps {
  clientId: string
  query: PaymentsQuery
  data: OverviewPayload
  refreshing: boolean
  navigate: (change: Partial<PaymentsQuery>) => void
  onOpenRow: (row: OverviewListRow) => void
  onOpenContact: (id: string, name: string | null) => void
}

function ReadyView(props: ReadyViewProps): JSX.Element {
  const { clientId, query, data, refreshing, navigate, onOpenRow, onOpenContact } = props
  const banner = (
    <PaidWithoutBookingBanner
      clientId={clientId}
      total={data.paidWithoutBooking.total}
      rows={data.paidWithoutBooking.rows}
      onOpenContact={onOpenContact}
    />
  )

  return (
    <section aria-busy={refreshing} className="space-y-5">
      <h2 className="text-lg font-black text-me-charcoal">{PAGE_HEADING}</h2>
      {refreshing && (
        <p role="status" aria-live="polite" className="text-sm font-semibold text-me-charcoal/70">
          更新中…
        </p>
      )}
      {!data.hasBookings ? (
        <>
          <EmptyState clientId={clientId} />
          {banner}
        </>
      ) : (
        <>
          {banner}
          <SummarySection query={query} data={data} navigate={navigate} />
          <OrdersSection
            clientId={clientId}
            query={query}
            data={data}
            refreshing={refreshing}
            navigate={navigate}
            onOpenRow={onOpenRow}
          />
        </>
      )}
    </section>
  )
}

function SummarySection(props: {
  query: PaymentsQuery
  data: OverviewPayload
  navigate: (change: Partial<PaymentsQuery>) => void
}): JSX.Element {
  const { query, data, navigate } = props
  return (
    <div className="space-y-3">
      {data.summary.groups.length > 0 ? (
        <SummaryTable
          groups={data.summary.groups}
          totals={data.summary.totals}
          today={data.today}
          selectedKey={query.departureId}
          onSelect={(key) => navigate({ departureId: key })}
        />
      ) : (
        <p className={MUTED_LINE}>现在没有要显示的出发日期。</p>
      )}
      <SummaryFooter
        notes={data.summary.notes}
        hiddenGroupCount={data.summary.hiddenGroupCount}
        hiddenOrders={data.summary.hiddenOrders}
        hiddenOfflineOnlyGroups={data.summary.hiddenOfflineOnlyGroups}
        includePastPaid={query.includePastPaid}
        onToggleIncludePastPaid={(next) => navigate({ includePastPaid: next })}
      />
    </div>
  )
}

interface OrdersSectionProps {
  clientId: string
  query: PaymentsQuery
  data: OverviewPayload
  refreshing: boolean
  navigate: (change: Partial<PaymentsQuery>) => void
  onOpenRow: (row: OverviewListRow) => void
}

function OrdersSection(props: OrdersSectionProps): JSX.Element {
  const { clientId, query, data, refreshing, navigate, onOpenRow } = props
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-black text-me-charcoal">全部订单</h2>
      <OrdersFilters
        tours={tourOptionsOf(data, query)}
        tourId={query.tourId}
        status={query.status}
        selectedDepartureLabel={departureLabelOf(data, query)}
        onTourChange={(id) => navigate({ tourId: id })}
        onStatusChange={(s: StatusParam) => navigate({ status: s })}
        onClearDeparture={() => navigate({ departureId: null })}
      />
      <OrdersTable
        clientId={clientId}
        rows={data.list.rows}
        today={data.today}
        page={data.list.page}
        pageCount={data.list.pageCount}
        total={data.list.total}
        emptyText={emptyTextOf(query)}
        refreshing={refreshing}
        onPage={(p) => navigate({ page: p })}
        onOpenRow={onOpenRow}
      />
    </section>
  )
}

interface TourOption {
  id: string
  name: string
}

/** 团下拉框的选项：汇总行 + 清单行里出现过的团，加上当前已选但没出现的那个。 */
function tourOptionsOf(data: OverviewPayload, query: PaymentsQuery): TourOption[] {
  const byId = new Map<string, TourOption>()
  for (const group of data.summary.groups) {
    if (group.tourId !== null && group.tourName !== null) {
      byId.set(group.tourId, { id: group.tourId, name: group.tourName })
    }
  }
  for (const row of data.list.rows) {
    if (row.tourId !== null && row.tourName !== null) {
      byId.set(row.tourId, { id: row.tourId, name: row.tourName })
    }
  }
  if (query.tourId !== null && !byId.has(query.tourId)) {
    byId.set(query.tourId, { id: query.tourId, name: '已选的团' })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 「只看：…」那一行显示什么；没有筛选时返回 null。 */
function departureLabelOf(data: OverviewPayload, query: PaymentsQuery): string | null {
  if (query.departureId === null) return null
  if (query.departureId === 'none') return '出发日期还没定'
  const group = data.summary.groups.find((g) => g.key === query.departureId)
  if (group === undefined) return '所选的出发日期'
  const title = groupTitle(group)
  return `${title.tour} ${title.date}`
}

/** 清单为空时显示哪句话。 */
function emptyTextOf(query: PaymentsQuery): string {
  if (query.tourId !== null && query.status === 'all' && query.departureId === null) {
    return '这个团下还没有订单'
  }
  return '没有符合条件的订单'
}
