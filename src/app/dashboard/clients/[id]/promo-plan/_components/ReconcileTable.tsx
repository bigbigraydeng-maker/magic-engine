'use client'

import type { Reconciliation } from '@/lib/marketing-plan/promo/reconcile'
import { ROW_STATUS_META, formatRowValue } from '@/lib/marketing-plan/promo/labels'

export function ReconcileTable({ rec }: { rec: Reconciliation }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900">本周对账</h2>
        <p className="text-xs text-gray-500 mt-0.5">统计 {rec.window.start} 至 {rec.window.end}（最近 7 个完整的天，最新一天数据还会变，先不算）</p>
      </div>
      <ul className="divide-y divide-gray-100">
        {rec.rows.map(row => {
          const meta = ROW_STATUS_META[row.status]
          return (
            <li key={row.key} className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
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
