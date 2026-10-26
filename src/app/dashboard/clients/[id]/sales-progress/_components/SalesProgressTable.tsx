/**
 * Read-only, server-renderable table of "sales progress" per departure.
 * Plain table markup with the shared Tailwind vocabulary; no hooks,
 * no 'use client', no data fetching. All user-facing text is Simplified Chinese.
 */

import type { SalesProgressData } from '@/lib/crm/sales-progress/load'
import type { SalesBooking, UnitProgress } from '@/lib/crm/sales-progress/types'
import {
  formatCapacity,
  formatGeneratedAt,
  formatRemaining,
  invoiceText,
  originLabel,
  peopleText,
  rowNotes,
  statusText,
} from './format'

function companyOnlyText(row: UnitProgress): string | null {
  if (row.remainingCompanyOnly === null) return null
  if (row.remainingCompanyOnly < 0) return `超订 ${-row.remainingCompanyOnly} 人`
  return `${row.remainingCompanyOnly} 人`
}

function hasDetail(row: UnitProgress): boolean {
  return rowNotes(row).length > 0 || row.bookings.length > 0
}

function BookingList({ bookings }: { bookings: SalesBooking[] }): JSX.Element {
  return (
    <details>
      <summary className="cursor-pointer text-me-charcoal/70">
        看这几张订单（{bookings.length}）
      </summary>
      <ul className="mt-1 space-y-0.5">
        {bookings.map((b) => (
          <li key={b.id} className="text-me-charcoal/70">
            {invoiceText(b)} · {peopleText(b)} · {originLabel(b.originKind)}
          </li>
        ))}
      </ul>
    </details>
  )
}

function RowDetail({ row }: { row: UnitProgress }): JSX.Element | null {
  const notes = rowNotes(row)
  if (notes.length === 0 && row.bookings.length === 0) return null
  return (
    <tr className="border-b border-me-charcoal/10">
      <td colSpan={6} className="pb-3 pl-6 pr-3 pt-0 text-xs text-me-charcoal/70">
        {notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
        {row.bookings.length > 0 ? <BookingList bookings={row.bookings} /> : null}
      </td>
    </tr>
  )
}

function ProgressRow({ row }: { row: UnitProgress }): JSX.Element {
  const companyOnly = companyOnlyText(row)
  const detail = hasDetail(row)
  return (
    <>
      <tr className={detail ? undefined : 'border-b border-me-charcoal/10'}>
        <td className="px-3 py-2 text-me-charcoal">
          {row.unit.label}
          {statusText(row.unit) !== null ? (
            <span className="block text-xs text-me-charcoal/70">{statusText(row.unit)}</span>
          ) : null}
        </td>
        <td className="px-3 py-2 text-me-charcoal">{formatCapacity(row)}</td>
        <td className="px-3 py-2 text-me-charcoal">{row.companyConfirmed} 人</td>
        <td className="px-3 py-2 text-me-charcoal">{row.customerStated} 人</td>
        <td className="px-3 py-2 text-me-charcoal">{row.unverified} 人</td>
        <td className="px-3 py-2 text-me-charcoal">
          <span className={row.overBy > 0 ? 'text-red-700 font-semibold' : undefined}>
            {formatRemaining(row)}
          </span>
          {companyOnly !== null ? (
            <span className="block text-xs text-me-charcoal/70">仅算公司确认：{companyOnly}</span>
          ) : null}
        </td>
      </tr>
      <RowDetail row={row} />
    </>
  )
}

function Footer({ data }: { data: SalesProgressData }): JSX.Element {
  const { result } = data
  return (
    <div className="mt-3 space-y-1 text-xs text-me-charcoal/70">
      {result.unattributedOrders > 0 ? (
        <p>
          订单没有挂出发日：{result.unattributedOrders} 单，共 {result.unattributedPeople} 人
        </p>
      ) : null}
      {result.onClosedUnits.map((item) => (
        <p key={item.unit.unitId}>
          挂在已取消/已关闭出发日上的订单：{item.unit.label}，{item.orders} 单，共 {item.people} 人
        </p>
      ))}
    </div>
  )
}

export function SalesProgressTable({ data }: { data: SalesProgressData }): JSX.Element {
  const { result } = data
  return (
    <div className="text-me-charcoal">
      <p className="text-xs text-me-charcoal/70">数据截至 {formatGeneratedAt(data.generatedAt)}</p>
      {data.originColumnsMissing ? (
        <p className="mt-2 text-xs text-me-charcoal/70">
          订单的「来源」「发票号」两列还没有在系统里启用，所有订单暂按「待核实」算。
        </p>
      ) : null}
      {result.activeOrders === 0 ? (
        <p className="mt-2 text-xs text-me-charcoal/70">
          现在还没有录入任何订单；第一批订单导入后，这里才会有数字。
        </p>
      ) : null}
      {result.rows.length === 0 ? (
        <p className="mt-2 text-xs text-me-charcoal/70">还没有出发日。</p>
      ) : (
        <>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-me-charcoal/10 text-left text-xs text-me-charcoal/70">
                <th className="px-3 py-2 font-medium">团 · 出发日</th>
                <th className="px-3 py-2 font-medium">座位上限</th>
                <th className="px-3 py-2 font-medium">公司确认</th>
                <th className="px-3 py-2 font-medium">客人自述</th>
                <th className="px-3 py-2 font-medium">待核实</th>
                <th className="px-3 py-2 font-medium">剩余</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <ProgressRow key={row.unit.unitId} row={row} />
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-me-charcoal/70">
            对外只说「公司确认」那一栏；其余两栏只是内部参考。「剩余」按保守算法，上限减去三栏之和；下面那行小字「仅算公司确认」只算公司确认的座位。
          </p>
        </>
      )}
      <Footer data={data} />
    </div>
  )
}
