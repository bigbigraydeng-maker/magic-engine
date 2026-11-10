'use client'

import type { Reconciliation } from '@/lib/marketing-plan/promo/reconcile'
import { ROW_STATUS_META, formatRowValue } from '@/lib/marketing-plan/promo/labels'

export function ReconcileTable({ rec }: { rec: Reconciliation }) {
  return (
    <section className="-mx-1" aria-label="本周对账明细">
      <p className="pb-3 text-xs text-black/50">
        统计 {rec.window.start} 至 {rec.window.end}（最近 7 个完整的天，最新一天数据还会变，先不算）
      </p>
      <ul className="divide-y divide-black/[.06]">
        {rec.rows.map(row => {
          const meta = ROW_STATUS_META[row.status]
          return (
            <li key={row.key} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="text-sm font-medium text-gray-900">{row.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{row.reason}</p>
                {row.as_of && <p className="text-[11px] text-gray-400 mt-0.5">数据更新于 {row.as_of.slice(0, 10)}</p>}
              </div>
              <div className="flex items-center gap-4 sm:justify-end text-sm">
                <span className="text-gray-500">计划 <strong className="text-gray-900">{formatRowValue(row, row.planned)}</strong></span>
                <span className="text-gray-500">实际 <strong className="text-gray-900">{formatRowValue(row, row.actual)}</strong></span>
                <span className={`text-xs font-medium border rounded-full px-2 py-0.5 ${meta.cls}`}>{meta.label}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
