/**
 * 付款总览 footer: hidden-group note, the "include past paid" toggle, and the footnotes.
 *
 * Counts ORDERS only; the tracker stores no money.
 */

import type { OverviewNotes } from '@/lib/crm/booking-overview-types'

const TOGGLE_BUTTON_CLASS =
  'inline-flex min-h-[40px] items-center justify-center rounded-lg border border-me-charcoal/25 bg-white px-3 py-2 text-sm font-black text-me-charcoal hover:bg-me-ivory focus:outline-none focus-visible:ring-2 focus-visible:ring-me-ochre focus-visible:ring-offset-1'

/** Hidden groups have nothing OPEN to collect; some of them still carry offline-handled items, so 「已收齐」 would be untrue. */
function hiddenNote(count: number, offlineOnly: number): string {
  if (offlineOnly === 0) return `另有 ${count} 个已出发且已收齐的出发日期没显示`
  return `另有 ${count} 个已出发的出发日期没显示（其中 ${offlineOnly} 个只剩线下已处理的款，没有要催的）`
}

export function SummaryFooter(props: {
  notes: OverviewNotes
  hiddenGroupCount: number
  hiddenOrders: number
  hiddenOfflineOnlyGroups: number
  includePastPaid: boolean
  onToggleIncludePastPaid: (next: boolean) => void
}): JSX.Element {
  const { notes, hiddenGroupCount, hiddenOrders, hiddenOfflineOnlyGroups, includePastPaid, onToggleIncludePastPaid } = props

  return (
    <div className="flex flex-col gap-2">
      {hiddenGroupCount > 0 ? (
        <p className="text-sm font-semibold text-me-charcoal">{hiddenNote(hiddenGroupCount, hiddenOfflineOnlyGroups)}</p>
      ) : null}
      {hiddenOrders > 0 ? (
        <p className="text-xs text-me-charcoal/70">没显示的这些共 {hiddenOrders} 单，不在上面的合计里</p>
      ) : null}

      {hiddenGroupCount > 0 || includePastPaid ? (
        <button
          type="button"
          aria-pressed={includePastPaid}
          onClick={() => onToggleIncludePastPaid(!includePastPaid)}
          className={TOGGLE_BUTTON_CLASS}
        >
          也看已收齐的过去出发
        </button>
      ) : null}

      <p className="text-xs text-me-charcoal/70">
        其中 {notes.offlineHandledOrders} 单标了线下已处理 · {notes.snoozedOrders} 单已暂停提醒 · 另有{' '}
        {notes.cancelledOrders} 单已取消，不计入上表
      </p>

      <p className="text-xs text-me-charcoal/70">点一行，下面的清单就只看这一个出发日期</p>
    </div>
  )
}
