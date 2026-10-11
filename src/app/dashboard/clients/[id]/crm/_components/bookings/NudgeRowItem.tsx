'use client'

/**
 * One row in the CRM "付款要催" reminder list.
 *
 * The left side opens the contact's profile; the right side offers the three
 * reminder actions (already nudged today, snooze, handled offline).
 */

import { useState } from 'react'
import type { NudgeMode, NudgeRow } from '@/lib/crm/booking-types'
import { nudgeRelative } from './booking-format'
import { SECONDARY_BUTTON } from './booking-styles'

interface NudgeRowItemProps {
  row: NudgeRow
  busy: boolean
  onOpen: () => void
  onAct: (mode: NudgeMode, days?: 3 | 7 | 14) => void
}

const SNOOZE_DAYS: Array<3 | 7 | 14> = [3, 7, 14]

export function NudgeRowItem({ row, busy, onOpen, onAct }: NudgeRowItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const name = row.contactName ?? '（没有名字）'
  const tourLine = `${row.tourName ?? '（团目录里已找不到这个团）'} · ${
    row.departOn ? row.departOn + ' 出发' : '出发日期还没定'
  }`
  const dueLine =
    row.dueOn !== null
      ? `${row.label} · 到期 ${row.dueOn}（${nudgeRelative(row.dueInDays)}）`
      : `${row.label} · ${row.note ?? '出发日期还没定，补上才有到期日'}`

  const snooze = (days: 3 | 7 | 14) => {
    setMenuOpen(false)
    onAct('snooze', days)
  }

  return (
    <li
      data-testid="nudge-row"
      className="flex flex-col gap-2 border-b border-me-charcoal/10 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <button
        type="button"
        onClick={onOpen}
        className="min-h-[44px] min-w-0 flex-1 rounded-lg px-2 py-1 text-left hover:bg-me-ivory focus:outline-none focus-visible:ring-2 focus-visible:ring-me-ochre"
        aria-label={`打开 ${name} 的资料`}
      >
        <span className="block font-black text-me-charcoal">{name}</span>
        <span className="block text-sm text-me-charcoal/80">{tourLine}</span>
        <span
          className={`block text-sm font-semibold ${
            row.bucket === 'overdue' ? 'text-[#9B2C22]' : 'text-me-charcoal/80'
          }`}
        >
          {dueLine}
        </span>
      </button>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={SECONDARY_BUTTON}
          aria-label={`今天已催（${name}）`}
          disabled={busy}
          onClick={() => onAct('nudged_today')}
        >
          今天已催
        </button>

        <button
          type="button"
          className={SECONDARY_BUTTON}
          aria-expanded={menuOpen}
          aria-label={`推迟（${name}）`}
          disabled={busy}
          onClick={() => setMenuOpen((open) => !open)}
        >
          推迟
        </button>

        {menuOpen
          ? SNOOZE_DAYS.map((days) => (
              <button
                key={days}
                type="button"
                className={SECONDARY_BUTTON}
                disabled={busy}
                onClick={() => snooze(days)}
              >
                {`推迟 ${days} 天`}
              </button>
            ))
          : null}

        <button
          type="button"
          className={SECONDARY_BUTTON}
          aria-label={`线下已处理（${name}）`}
          disabled={busy}
          onClick={() => onAct('quiet')}
        >
          线下已处理
        </button>
      </div>
    </li>
  )
}
