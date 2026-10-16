/**
 * 付款总览 summary table: one row per departure date, counting ORDERS only.
 *
 * The tracker stores no money, so every cell here is a count of 单 (orders).
 * The table scrolls inside its own box so the page never scrolls sideways at 375px.
 */

import type { OverviewGroup, OverviewTotals } from '@/lib/crm/booking-overview-types'
import { dueDateText, groupTitle, partySizeText, ratioText, warningText } from './payments-format'

const CELL_CLASS = 'px-3 py-2 text-right align-top tabular-nums'
const HEAD_CLASS = 'px-3 py-2 text-right align-bottom text-xs font-black text-me-charcoal/70'
const ROW_LABEL_HEAD_CLASS = 'px-3 py-2 text-left align-bottom text-xs font-black text-me-charcoal/70'

const SELECT_BUTTON_CLASS =
  'flex min-h-[40px] w-full flex-col items-start justify-center rounded-lg px-2 py-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-me-ochre'

const BADGE_CLASS =
  'ml-2 inline-flex items-center rounded-full border border-me-charcoal/25 bg-me-ivory px-2 py-0.5 text-xs font-black text-me-charcoal'

const WARNING_LINE_CLASS = 'mt-1 text-xs font-semibold text-[#7C3A06]'

interface GroupRowProps {
  group: OverviewGroup
  selected: boolean
  today: string
  onSelect: (key: string | null) => void
}

/** Id of one warning line, so the select button can be described by it. */
function warnId(group: OverviewGroup, code: string): string {
  return `warn-${group.key}-${code}`
}

/** Spoken name of the select button (the visible text is split over several lines). */
function selectLabel(group: OverviewGroup): string {
  if (group.kind === 'undecided') return '只看还没选出发日期的订单'
  if (group.kind === 'unknown_date') return '只看日期不明的出发'
  const title = groupTitle(group)
  return `只看 ${title.tour} ${group.departOn ?? ''} 出发的订单`.replace(/\s+/g, ' ')
}

/** The first cell: a button that selects (or clears) this departure date. */
function GroupRowLabel({ group, selected, onSelect }: GroupRowProps) {
  const title = groupTitle(group)
  const warnings = group.warningCodes
    .map((code) => ({ code, text: warningText(code) }))
    .filter((entry): entry is { code: typeof entry.code; text: string } => entry.text !== null)

  function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    onSelect(selected ? null : group.key)
  }

  return (
    <th scope="row" className="px-3 py-2 text-left align-top">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={selectLabel(group)}
        aria-describedby={warnings.length > 0 ? warnings.map((w) => warnId(group, w.code)).join(' ') : undefined}
        onClick={handleClick}
        className={SELECT_BUTTON_CLASS}
      >
        {title.date === '' ? (
          <span className="text-sm font-black text-me-charcoal">{title.tour}</span>
        ) : (
          <>
            <span className="text-xs text-me-charcoal/70">{title.tour}</span>
            <span className="text-sm font-black text-me-charcoal">
              {title.date}
              {group.departed ? <span className={BADGE_CLASS}>已出发</span> : null}
            </span>
          </>
        )}
        {warnings.map((entry) => (
          <span key={entry.code} id={warnId(group, entry.code)} className={WARNING_LINE_CLASS}>
            {entry.text}
          </span>
        ))}
      </button>
    </th>
  )
}

/** Row colour: red tint when something is overdue, green tint when every order is fully paid. */
function rowTone(group: OverviewGroup, selected: boolean): string {
  if (selected) return 'cursor-pointer bg-me-ochre/10'
  if (group.unsettledOverdue > 0) return 'cursor-pointer bg-[#C2453A]/10'
  const allPaid =
    group.orders > 0 && group.unsettled === 0 && group.depositPaid === group.orders && group.balancePaid === group.orders
  return allPaid ? 'cursor-pointer bg-[#456F35]/10' : 'cursor-pointer'
}

/** 「未收齐」: the count, with the overdue part in red so it cannot be missed. */
function UnsettledCell(props: { unsettled: number; overdue: number }): JSX.Element {
  return (
    <>
      {props.unsettled}
      {props.overdue > 0 ? (
        <span className="ml-1 font-black text-[#C2453A]">{`（${props.overdue} 已过期）`}</span>
      ) : null}
    </>
  )
}

/** One body row: the label cell plus the six cells. Items are 「已收/总数」 so progress reads at a glance. */
function GroupRow({ group, selected, today, onSelect }: GroupRowProps) {
  const due = group.nearestDueOn
  const duePast = due !== null && due < today
  return (
    <tr onClick={() => onSelect(selected ? null : group.key)} className={rowTone(group, selected)}>
      <GroupRowLabel group={group} selected={selected} today={today} onSelect={onSelect} />
      <td className={CELL_CLASS}>{group.orders}</td>
      <td className={CELL_CLASS}>{partySizeText(group.partySize, group.partySizeMissing)}</td>
      <td className={CELL_CLASS}>{ratioText(group.depositPaid, group.orders)}</td>
      <td className={CELL_CLASS}>{ratioText(group.balancePaid, group.orders)}</td>
      <td className={CELL_CLASS}>
        <UnsettledCell unsettled={group.unsettled} overdue={group.unsettledOverdue} />
      </td>
      <td className={CELL_CLASS}>{group.offlineHandled}</td>
      <td className={duePast ? `${CELL_CLASS} font-bold text-[#C2453A]` : CELL_CLASS}>{dueDateText(due, today)}</td>
    </tr>
  )
}

export function SummaryTable(props: {
  groups: OverviewGroup[]
  selectedKey: string | null
  onSelect: (key: string | null) => void
  totals: OverviewTotals
  today: string
}): JSX.Element {
  const { groups, selectedKey, onSelect, totals, today } = props

  return (
    <div className="overflow-x-auto rounded-xl border border-me-charcoal/15 bg-white">
      <table className="min-w-[800px] w-full border-collapse text-sm text-me-charcoal">
        <caption className="sr-only">各出发日期的收款进度</caption>
        <thead>
          <tr className="border-b border-me-charcoal/15">
            <th scope="col" className={ROW_LABEL_HEAD_CLASS}>
              团 / 出发日期
            </th>
            <th scope="col" className={HEAD_CLASS}>
              订单
            </th>
            <th scope="col" className={HEAD_CLASS}>
              人数
            </th>
            <th scope="col" className={HEAD_CLASS}>
              定金已收
            </th>
            <th scope="col" className={HEAD_CLASS}>
              尾款已收
            </th>
            <th scope="col" className={HEAD_CLASS}>
              未收齐（其中已过期）
            </th>
            <th scope="col" className={HEAD_CLASS}>
              线下已处理
            </th>
            <th scope="col" className={HEAD_CLASS}>
              最近到期日
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRow
              key={group.key}
              group={group}
              selected={group.key === selectedKey}
              today={today}
              onSelect={onSelect}
            />
          ))}
        </tbody>
        <tfoot>
          {/*
            线下已处理 and 未收齐 can count the same order, so those two columns
            must never be added together.
          */}
          <tr className="border-t border-me-charcoal/15 bg-me-ivory">
            <th scope="row" className="px-3 py-2 text-left align-top text-sm font-black">
              合计（上面当前显示的这几行相加）
            </th>
            <td className={`${CELL_CLASS} font-black`}>{totals.orders}</td>
            <td className={`${CELL_CLASS} font-black`}>{partySizeText(totals.partySize, totals.partySizeMissing)}</td>
            <td className={`${CELL_CLASS} font-black`}>{ratioText(totals.depositPaid, totals.orders)}</td>
            <td className={`${CELL_CLASS} font-black`}>{ratioText(totals.balancePaid, totals.orders)}</td>
            <td className={`${CELL_CLASS} font-black`}>
              <UnsettledCell unsettled={totals.unsettled} overdue={totals.unsettledOverdue} />
            </td>
            <td className={`${CELL_CLASS} font-black`}>{totals.offlineHandled}</td>
            <td className={CELL_CLASS} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
