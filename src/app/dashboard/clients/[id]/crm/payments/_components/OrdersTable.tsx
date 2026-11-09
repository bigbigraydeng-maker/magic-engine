'use client'

import Link from 'next/link'
import { MUTED_TEXT, SECONDARY_BUTTON } from '../../_components/bookings/booking-styles'
import { dateLabel, milestoneCellText } from './payments-format'
import type { OverviewListRow } from '@/lib/crm/booking-overview-types'

interface OrdersTableProps {
  clientId: string
  rows: OverviewListRow[]
  today: string
  page: number
  pageCount: number
  total: number
  emptyText: string
  refreshing: boolean
  onPage: (page: number) => void
  onOpenRow: (row: OverviewListRow) => void
}

export function OrdersTable(props: OrdersTableProps): JSX.Element {
  const dim = props.refreshing ? 'opacity-50 transition-opacity' : ''
  if (props.rows.length === 0) {
    return (
      <div aria-busy={props.refreshing} className={dim}>
        <p role="status" className={MUTED_TEXT}>
          {props.emptyText}
        </p>
        <Pager page={props.page} pageCount={props.pageCount} total={props.total} onPage={props.onPage} />
      </div>
    )
  }

  return (
    <div aria-busy={props.refreshing} className={dim}>
      <div className="overflow-x-auto rounded-xl border border-me-charcoal/15 bg-white">
        <table className="min-w-[640px] w-full border-collapse text-sm text-me-charcoal">
          <caption className="sr-only">全部订单</caption>
          <thead>
            <tr className="border-b border-me-charcoal/15 text-left">
              <th scope="col" className="px-3 py-2 font-black">客人</th>
              <th scope="col" className="px-3 py-2 font-black">团 · 出发日期</th>
              <th scope="col" className="px-3 py-2 font-black">人数</th>
              <th scope="col" className="px-3 py-2 font-black">定金</th>
              <th scope="col" className="px-3 py-2 font-black">尾款</th>
              <th scope="col" className="px-3 py-2 font-black">最近催过</th>
              <th scope="col" className="px-3 py-2 font-black">备注</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <OrderRow
                key={row.bookingId}
                row={row}
                clientId={props.clientId}
                today={props.today}
                onOpenRow={props.onOpenRow}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        page={props.page}
        pageCount={props.pageCount}
        total={props.total}
        onPage={props.onPage}
      />
    </div>
  )
}

interface OrderRowProps {
  row: OverviewListRow
  clientId: string
  today: string
  onOpenRow: (row: OverviewListRow) => void
}

function OrderRow(props: OrderRowProps): JSX.Element {
  const { row } = props
  return (
    <tr
      onClick={() => {
        // Selecting text (to copy a note) must not navigate away.
        if (window.getSelection()?.toString()) return
        props.onOpenRow(row)
      }}
      className="cursor-pointer border-b border-me-charcoal/10 align-top hover:bg-me-ivory"
    >
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <Link
          href={`/dashboard/clients/${props.clientId}/crm/all?contact=${encodeURIComponent(row.contactId)}&focus=bookings`}
          className="inline-flex min-h-[40px] items-center font-bold underline focus-visible:ring-2 focus-visible:ring-me-ochre"
          onClick={(e) => {
            e.stopPropagation()
            // 按住 Ctrl / Cmd / Shift 点（想在新标签页开）照旧走链接；普通点击原地弹出抽屉。
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
            e.preventDefault()
            props.onOpenRow(row)
          }}
        >
          {row.contactName ?? '（没有姓名）'}
        </Link>
        {row.status === 'cancelled' && (
          <span className="ml-2 rounded bg-me-charcoal/10 px-1.5 py-0.5 text-xs font-semibold">
            已取消
          </span>
        )}
      </th>
      <td className="px-3 py-2">
        <div>{row.tourName ?? '（团目录里已找不到这个团）'}</div>
        <div className="text-xs text-me-charcoal/70">
          {row.departOn ? `${row.departOn} 出发` : '出发日期未定'}
        </div>
      </td>
      <td className="px-3 py-2">
        {row.status === 'cancelled' ? '—' : row.partySize === null ? '未填' : row.partySize}
      </td>
      <td className="px-3 py-2">{milestoneCellText(row.deposit, props.today)}</td>
      <td className="px-3 py-2">{milestoneCellText(row.balance, props.today)}</td>
      <td className="px-3 py-2">
        {row.lastNudgedOn === null ? '—' : dateLabel(row.lastNudgedOn, props.today)}
      </td>
      <td className="px-3 py-2">
        <NoteCell note={row.note} warnings={row.warnings} />
      </td>
    </tr>
  )
}

interface NoteCellProps {
  note: string | null
  warnings: OverviewListRow['warnings']
}

function NoteCell(props: NoteCellProps): JSX.Element {
  const hasContent = props.note !== null || props.warnings.length > 0
  if (!hasContent) return <span>—</span>
  return (
    <div className="flex flex-col gap-1">
      {props.note !== null && <span>{props.note}</span>}
      {props.warnings.map((w) => (
        <span key={w.code} className="text-xs font-semibold text-[#7C3A06]">
          {w.text}
        </span>
      ))}
      <span aria-hidden="true">→</span>
    </div>
  )
}

interface PagerProps {
  page: number
  pageCount: number
  total: number
  onPage: (page: number) => void
}

function Pager(props: PagerProps): JSX.Element {
  return (
    <nav aria-label="翻页" className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={SECONDARY_BUTTON}
        disabled={props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
      >
        上一页
      </button>
      <span className="text-sm font-semibold text-me-charcoal">
        第 {props.page} / {Math.max(props.pageCount, 1)} 页（共 {props.total} 单）
      </span>
      <button
        type="button"
        className={SECONDARY_BUTTON}
        disabled={props.page >= props.pageCount}
        onClick={() => props.onPage(props.page + 1)}
      >
        下一页
      </button>
    </nav>
  )
}
