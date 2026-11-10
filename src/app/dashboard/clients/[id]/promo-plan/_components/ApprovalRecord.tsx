'use client'

import type { MarketingPlan } from '@/lib/marketing-plan/types'
import { describeApprovalRecord } from '@/lib/marketing-plan/promo/approval-record'

/** 已批准计划的批准记录：谁批的、什么时候、批准时检查清单状态、派出了什么。只读。 */
export function ApprovalRecord({ plan }: { plan: MarketingPlan }) {
  const view = describeApprovalRecord(plan)
  if (!view) return null
  const alert = view.tone === 'alert'
  const cls = alert ? 'text-[#8b2e26]' : 'text-[#1A1A1A]'
  return (
    <section className="-mx-1" aria-label="批准记录">
      <p className={`text-sm font-semibold ${cls}`}>{view.headline}</p>
      <ul className="mt-2 space-y-0.5">
        {view.lines.map((l, i) => <li key={i} className="text-xs text-black/65">{l}</li>)}
      </ul>
    </section>
  )
}
