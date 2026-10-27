import type { KPITarget, PrescriptionAction, PrescriptionContent, PrescriptionIntake, PrescriptionPhase } from '@/types/diagnostic'
import { DIMENSION_LABEL, weaknessSentences } from './copy'
import type { SelfGrade } from '@/lib/huatuo/types'
import {
  FULL_TEXT_LABEL, FORMULA_LABEL, dailyBudgetLabel, goalLabel, keyNumbers, kpiChange,
  periodLabel, proseBlocks, splitMetricFormula, statusBadge, totalBudgetLabel, type KeyNumber,
} from './present'

export function DraftCard({
  content,
  intake,
  selfGrade,
  problem,
  status,
}: {
  content: PrescriptionContent | null
  intake: PrescriptionIntake | null
  selfGrade: SelfGrade | null
  problem: string | null
  status: string | null
}) {
  if (!content) return problem ? <p className="text-sm text-me-charcoal/80">{problem}</p> : null
  return (
    <div className="min-w-0 space-y-8">
      <SummaryCard content={content} intake={intake} status={status} />
      <StageList phases={content.phases ?? []} />
      <OutcomeBlock content={content} weaknesses={weaknessSentences(selfGrade?.weaknesses)} />
      <FullText content={content} />
    </div>
  )
}

function SummaryCard({
  content,
  intake,
  status,
}: {
  content: PrescriptionContent
  intake: PrescriptionIntake | null
  status: string | null
}) {
  const numbers = keyNumbers(content.kpi_targets)
  return (
    <section className="min-w-0 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Fact term="目标" value={goalLabel(intake)} large />
        <StatusBadge status={status} />
      </div>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Fact term="周期" value={periodLabel(content.phases)} />
        <Fact term="总预算" value={totalBudgetLabel(intake)} />
        <Fact term="每天预算" value={dailyBudgetLabel()} />
      </div>
      {numbers.length > 0 && <KeyNumberList numbers={numbers} />}
      <BudgetSplit content={content} />
    </section>
  )
}

function Fact({ term, value, large = false }: { term: string; value: string; large?: boolean }) {
  const valueClass = large
    ? 'mt-1 break-words text-2xl font-semibold leading-snug text-me-charcoal'
    : 'mt-1 break-words text-base font-semibold tabular-nums text-me-charcoal'
  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-me-charcoal/70">{term}</p>
      <p className={valueClass}>{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-sm font-semibold ring-1 ${badgeTone(status)}`}>
      {statusBadge(status)}
    </span>
  )
}

function KeyNumberList({ numbers }: { numbers: KeyNumber[] }) {
  return (
    <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
      {numbers.map((item, index) => (
        <li key={`${item.label}-${index}`} className="min-w-0">
          <p className="break-words text-lg font-semibold tabular-nums text-me-charcoal">{item.value}</p>
          <p className="mt-0.5 break-words text-sm leading-5 text-me-charcoal/80">{item.label}</p>
        </li>
      ))}
    </ul>
  )
}

function BudgetSplit({ content }: { content: PrescriptionContent }) {
  const items = content.budget_allocation ?? []
  if (items.length === 0) return null
  const parts = items.map((item) => `${DIMENSION_LABEL[item.dimension] ?? '其他'} ${item.percentage}%`)
  return <p className="mt-4 break-words text-sm text-me-charcoal/80">预算大致这样分：{parts.join('，')}</p>
}

function StageList({ phases }: { phases: PrescriptionPhase[] }) {
  if (phases.length === 0) return null
  return (
    <div className="space-y-8">
      {phases.map((phase) => <PhaseBlock key={phase.phase_number} phase={phase} />)}
    </div>
  )
}

function PhaseBlock({ phase }: { phase: PrescriptionPhase }) {
  const timing = Number.isFinite(phase.duration_weeks) ? `大约 ${phase.duration_weeks} 周` : null
  return (
    <section className="space-y-3">
      <h3 className="break-words text-base font-semibold text-me-charcoal">
        {phase.name}
        {timing && <span className="ml-2 text-sm font-normal text-me-charcoal/70">{timing}</span>}
      </h3>
      <ul className="space-y-3">
        {phase.actions.map((action) => <ActionLine key={action.id} action={action} />)}
      </ul>
    </section>
  )
}

function ActionLine({ action }: { action: PrescriptionAction }) {
  return (
    <li className="min-w-0 rounded-lg border border-black/10 bg-white px-4 py-3">
      <p className="whitespace-normal break-words text-sm font-semibold text-me-charcoal">{action.title}</p>
      <p className="mt-1 whitespace-normal break-words text-sm font-normal leading-6 text-me-charcoal/80">{action.description}</p>
      {action.measurement_method && (
        <p className="mt-2 whitespace-normal break-words text-sm leading-6 text-me-charcoal/70">
          怎么知道做成了：{action.measurement_method}
        </p>
      )}
    </li>
  )
}

function OutcomeBlock({ content, weaknesses }: { content: PrescriptionContent; weaknesses: string[] }) {
  return (
    <>
      <KpiTable content={content} />
      {weaknesses.length > 0 && <WeaknessList lines={weaknesses} />}
    </>
  )
}

function KpiTable({ content }: { content: PrescriptionContent }) {
  const rows = content.kpi_targets ?? []
  if (rows.length === 0) return null
  return (
    <section className="min-w-0">
      <h3 className="text-base font-semibold text-me-charcoal">想看到的变化</h3>
      <table className="mt-3 w-full table-fixed text-left text-sm">
        <thead>
          <tr className="text-me-charcoal/70">
            <th className="w-1/2 pb-2 font-medium">指标</th>
            <th className="w-1/2 pb-2 font-medium">现在 → 目标</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((kpi, index) => <KpiRow key={`${kpi.metric}-${kpi.unit}-${index}`} kpi={kpi} />)}
        </tbody>
      </table>
    </section>
  )
}

function KpiRow({ kpi }: { kpi: KPITarget }) {
  const parts = splitMetricFormula(kpi.metric)
  return (
    <tr className="border-t border-black/10 align-top">
      <td className="break-words py-3 pr-3 font-normal text-me-charcoal">
        {parts.label}
        {parts.formula && <FormulaToggle formula={parts.formula} />}
      </td>
      <td className="break-words py-3 font-normal tabular-nums text-me-charcoal">{kpiChange(kpi)}</td>
    </tr>
  )
}

function FormulaToggle({ formula }: { formula: string }) {
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs font-medium text-me-charcoal/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-charcoal">
        {FORMULA_LABEL}
      </summary>
      <p className="mt-1 break-words text-xs font-normal leading-5 text-me-charcoal/80">{formula}</p>
    </details>
  )
}

function WeaknessList({ lines }: { lines: string[] }) {
  return (
    <section>
      <h3 className="text-base font-semibold text-me-charcoal">这版还可以改的地方</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-me-charcoal/80">
        {lines.map((line) => <li key={line} className="break-words">{line}</li>)}
      </ul>
    </section>
  )
}

function FullText({ content }: { content: PrescriptionContent }) {
  const blocks = proseBlocks(content)
  if (blocks.length === 0) return null
  return (
    <details className="rounded-xl border border-black/10 bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-me-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-charcoal">
        {FULL_TEXT_LABEL}
      </summary>
      <div className="mt-3 space-y-2">
        {blocks.map((block, index) => (
          <p key={index} className="break-words text-sm font-normal leading-6 text-me-charcoal/80">{block}</p>
        ))}
      </div>
    </details>
  )
}

function badgeTone(status: string | null): string {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-950 ring-emerald-200'
  if (status === 'draft') return 'bg-amber-50 text-amber-950 ring-amber-200'
  if (status === 'rejected' || status === 'failed') return 'bg-rose-50 text-rose-950 ring-rose-200'
  return 'bg-black/5 text-me-charcoal ring-black/10'
}
