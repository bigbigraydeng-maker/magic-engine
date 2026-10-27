import type { PrescriptionAction, PrescriptionContent, PrescriptionIntake, PrescriptionPhase } from '@/types/diagnostic'
import { adCurrencyPrefix } from '@/lib/ads/spend-figures'
import type { SelfGrade } from '@/lib/huatuo/types'
import { DIMENSION_LABEL, weaknessSentences } from './copy'

export function DraftCard({
  content,
  intake,
  selfGrade,
  problem,
}: {
  content: PrescriptionContent | null
  intake: PrescriptionIntake | null
  selfGrade: SelfGrade | null
  problem: string | null
}) {
  if (!content) return problem ? <p className="text-sm text-me-charcoal/70">{problem}</p> : null
  return (
    <article className="space-y-4 rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-me-ochre">处方草稿</p>
        <h2 className="mt-1 text-lg font-black text-me-charcoal">{content.summary}</h2>
      </header>
      {content.narrative && content.narrative !== content.summary && (
        <p className="text-sm leading-relaxed text-me-charcoal/80">{content.narrative}</p>
      )}
      {intake && <BudgetLine intake={intake} />}
      {(content.phases ?? []).map((phase) => <PhaseBlock key={phase.phase_number} phase={phase} />)}
      <OutcomeBlock content={content} weaknesses={weaknessSentences(selfGrade?.weaknesses)} />
    </article>
  )
}

function PhaseBlock({ phase }: { phase: PrescriptionPhase }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-black text-me-charcoal">
        {phase.name}
        <span className="ml-2 font-semibold text-me-charcoal/45">大约 {phase.duration_weeks} 周</span>
      </h3>
      <ul className="space-y-2">
        {phase.actions.map((action) => <ActionLine key={action.id} action={action} />)}
      </ul>
    </section>
  )
}

function ActionLine({ action }: { action: PrescriptionAction }) {
  return (
    <li className="rounded-lg border border-black/5 bg-[#f6f7f2] px-3 py-2">
      <p className="text-sm font-black text-me-charcoal">{action.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-me-charcoal/75">{action.description}</p>
      {action.measurement_method && (
        <p className="mt-1 text-xs text-me-charcoal/55">怎么知道做成了：{action.measurement_method}</p>
      )}
    </li>
  )
}

function OutcomeBlock({ content, weaknesses }: { content: PrescriptionContent; weaknesses: string[] }) {
  return (
    <>
      {(content.kpi_targets ?? []).length > 0 && <KpiList content={content} />}
      {(content.budget_allocation ?? []).length > 0 && (
        <p className="text-sm text-me-charcoal/70">
          预算大致这样分：
          {content.budget_allocation.map((item) => `${DIMENSION_LABEL[item.dimension] ?? '其他'} ${item.percentage}%`).join('，')}
        </p>
      )}
      {weaknesses.length > 0 && <WeaknessList lines={weaknesses} />}
    </>
  )
}

function KpiList({ content }: { content: PrescriptionContent }) {
  return (
    <section>
      <h3 className="text-sm font-black text-me-charcoal">想看到的变化</h3>
      <ul className="mt-2 space-y-1 text-sm text-me-charcoal/80">
        {content.kpi_targets.map((kpi) => (
          <li key={`${kpi.metric}-${kpi.unit}`}>
            {kpi.metric}：现在 {kpi.current_value ?? '还没有数'}，目标 {kpi.target_value} {kpi.unit}
          </li>
        ))}
      </ul>
    </section>
  )
}

function WeaknessList({ lines }: { lines: string[] }) {
  return (
    <section>
      <h3 className="text-sm font-black text-me-charcoal">这版还可以改的地方</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-me-charcoal/75">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </section>
  )
}

function BudgetLine({ intake }: { intake: PrescriptionIntake }) {
  const prefix = adCurrencyPrefix(intake.budget_currency)
  return <p className="text-sm font-semibold text-me-charcoal/70">每月预算 {prefix}{intake.monthly_budget_aud}</p>
}
