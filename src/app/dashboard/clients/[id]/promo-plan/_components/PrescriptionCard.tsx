'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { GoalPrescriptionView } from '@/lib/marketing-plan/promo/goal-prescription'
import type { StoredSpend } from '@/lib/marketing-plan/promo/prescription-copy'
import { describeReview } from '@/lib/marketing-plan/promo/prescription-copy'
import { todayInNz } from '@/lib/marketing-plan/promo/schedule-view'
import { PlanSeedPanel } from '../../_components/plan-seed/PlanSeedPanel'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="mt-1 space-y-1 text-sm leading-6 text-gray-800">{children}</div>
    </div>
  )
}

function ItemList({ items, empty, ordered }: { items: string[]; empty: string; ordered: boolean }) {
  if (items.length === 0) return <p>{empty}</p>
  const rows = items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)
  if (ordered) return <ol className="list-decimal space-y-1 pl-5">{rows}</ol>
  return <ul className="list-disc space-y-1 pl-5">{rows}</ul>
}

function SpendBlock({ spend }: { spend: StoredSpend }) {
  const rows = [
    ['每天', spend.daily],
    ['总共', spend.total],
    ['配速', spend.pacing],
  ] as const
  if (rows.every(([, value]) => !value)) return <p>每天、总共、配速都还没写在这份处方里。</p>
  return (
    <ul className="space-y-1">
      {rows.map(([label, value]) => <li key={label}>{label}：{value ?? '还没写下'}</li>)}
    </ul>
  )
}

function prescriptionHref(clientId: string, goalId: string): string {
  const base = `/dashboard/clients/${clientId}/prescription/new`
  return goalId.trim() === '' ? base : `${base}?goal_id=${encodeURIComponent(goalId)}`
}

/** 只读。没有批准，也没有任何会写入的按钮。规矩默认收起。 */
export function PrescriptionCard({
  clientId,
  prescription,
  today,
}: {
  clientId: string
  prescription: GoalPrescriptionView
  today?: string
}) {
  const review = describeReview(prescription.review_anchor, today ?? todayInNz())
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-5 py-4" aria-label="处方">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-gray-900">处方</h2>
        <p className="text-xs text-gray-500">v{prescription.version} · {prescription.status_label}</p>
        <Link href={prescriptionHref(clientId, prescription.goal_id)} className="ml-auto text-xs text-indigo-600 hover:underline">去处方页查看</Link>
      </div>
      <p className="mt-1 text-xs text-gray-600">开方人：{prescription.prescriber ?? '未填写'}</p>
      <Section title="这周做什么">
        <ItemList items={prescription.todos} empty="这份处方没有单独列出要做的事。" ordered />
      </Section>
      <Section title="为什么">
        {prescription.why.length === 0
          ? <p>这份处方没有写下原因。</p>
          : prescription.why.map((sentence, index) => <p key={`${index}:${sentence}`}>{sentence}</p>)}
      </Section>
      <Section title="花多少">
        <SpendBlock spend={prescription.spend} />
      </Section>
      <Section title="什么时候复盘">
        {review.day7 && <p>第 7 天：{review.day7}</p>}
        {review.day14 && <p>第 14 天：{review.day14}</p>}
        <p>{review.note}</p>
      </Section>
      <details className="mt-4 rounded-lg border border-gray-200 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-gray-900">规矩</summary>
        <div className="mt-2 text-sm leading-6 text-gray-800">
          <ItemList items={prescription.rules} empty="没有单独的规矩。" ordered={false} />
        </div>
      </details>
      <PlanSeedPanel clientId={clientId} prescriptionId={prescription.id} />
    </section>
  )
}
