'use client'

import Link from 'next/link'
import type { GoalPrescriptionKpi, GoalPrescriptionPhase, GoalPrescriptionView } from '@/lib/marketing-plan/promo/goal-prescription'

function kpiText(kpi: GoalPrescriptionKpi): string {
  const current = kpi.current_value === null ? '—' : String(kpi.current_value)
  const target = kpi.target_value === null ? '—' : String(kpi.target_value)
  const unit = kpi.unit === '' ? '' : ` ${kpi.unit}`
  const when = kpi.timeframe ? `（${kpi.timeframe}）` : ''
  return `${kpi.metric}：${current} → ${target}${unit}${when}`
}

function PhaseBlock({ phase }: { phase: GoalPrescriptionPhase }) {
  const weeks = phase.duration_weeks === null ? '' : ` · ${phase.duration_weeks} 周`
  const index = phase.phase_number === null ? '' : `阶段 ${phase.phase_number}`
  const title = [index, phase.name].filter(part => part !== '').join(' · ')
  return (
    <li>
      <p className="text-sm font-medium text-gray-900">{title}{weeks}</p>
      <ul className="mt-1 space-y-1">
        {phase.actions.map(action => (
          <li key={action.id} className="text-sm text-gray-800">
            {action.title}
            {action.manual && (
              <span className="ml-2 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">人工执行</span>
            )}
            {action.description !== '' && <p className="text-xs text-gray-500">{action.description}</p>}
          </li>
        ))}
      </ul>
    </li>
  )
}

/** 只读。没有批准，也没有任何会写入的按钮。 */
export function PrescriptionCard({ clientId, prescription }: { clientId: string; prescription: GoalPrescriptionView }) {
  const href = `/dashboard/clients/${clientId}/prescription/new?goal_id=${encodeURIComponent(prescription.goal_id)}`
  return (
    <section className="rounded-xl border border-gray-200 bg-white px-5 py-4" aria-label="处方">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-gray-900">处方</h2>
        <p className="text-xs text-gray-500">v{prescription.version} · {prescription.status_label}</p>
        <Link href={href} className="ml-auto text-xs text-indigo-600 hover:underline">看完整处方</Link>
      </div>
      <p className="mt-1 text-xs text-gray-600">开方人：{prescription.prescriber ?? '未填写'}</p>
      {prescription.summary !== '' && <p className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{prescription.summary}</p>}
      {prescription.currency !== null && <p className="mt-2 text-xs text-gray-500">币种：{prescription.currency}</p>}
      {prescription.kpis.length > 0 && (
        <ul className="mt-3 space-y-1">
          {prescription.kpis.map((kpi, index) => <li key={`${kpi.metric}:${index}`} className="text-sm text-gray-800">{kpiText(kpi)}</li>)}
        </ul>
      )}
      {prescription.phases.length > 0 && (
        <ol className="mt-3 space-y-3">
          {prescription.phases.map(phase => <PhaseBlock key={`${phase.phase_number ?? 'x'}:${phase.name}`} phase={phase} />)}
        </ol>
      )}
    </section>
  )
}
