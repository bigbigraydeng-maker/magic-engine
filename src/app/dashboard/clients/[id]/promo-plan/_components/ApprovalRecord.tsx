'use client'

import type { MarketingPlan } from '@/lib/marketing-plan/types'
import { describeApprovalRecord } from '@/lib/marketing-plan/promo/approval-record'

/** 已批准计划的批准记录：谁批的、什么时候、批准时检查清单状态、派出了什么。只读。 */
export function ApprovalRecord({ plan }: { plan: MarketingPlan }) {
  const view = describeApprovalRecord(plan)
  if (!view) return null
  const alert = view.tone === 'alert'
  const cls = alert ? 'border-red-200 bg-red-50' : view.tone === 'neutral' ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'
  return (
    <section className={`rounded-xl border px-4 py-3 ${cls}`} aria-label="批准记录">
      <h2 className={`text-sm font-bold ${alert ? 'text-red-800' : 'text-gray-900'}`}>{view.headline}</h2>
      <ul className="mt-1 space-y-0.5">
        {view.lines.map((l, i) => <li key={i} className="text-xs text-gray-700">{l}</li>)}
      </ul>
    </section>
  )
}
