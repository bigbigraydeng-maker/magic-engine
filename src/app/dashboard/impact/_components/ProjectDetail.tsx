import Link from 'next/link'
import { ChainProgress } from '@/components/prescription/ChainProgress'
import { HeldCards } from '@/components/confirmation-card/HeldCards'
import { GoLiveCardPanel } from '@/components/go-live-card/GoLiveCardPanel'
import { ZhugePageChat } from '@/components/workbench/ZhugePageChat'
import { goalLine, prescriptionHref } from '@/lib/project-console/links'
import type { ProjectStageView, ProjectView } from '@/lib/project-console/types'
import { InlineConsent } from './InlineConsent'
import { STAGE_TONE } from './tone'

export function ProjectDetail({ project }: { project: ProjectView }) {
  const prescribeHref = prescriptionHref(project.clientId, project.prescriptionId, project.goalId)
  const context = `${project.clientName} · ${goalLine(project)} · 现在在${project.current.label}`
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
      <Link href="/dashboard/impact" className="text-sm font-bold text-me-ochre hover:underline">
        ← 全部项目
      </Link>
      <div className="mt-4">
        <ZhugePageChat clientId={project.clientId} contextLine={context} prescribeHref={prescribeHref} />
      </div>
      <header className="mt-8">
        <h1 className="font-display text-2xl font-black text-me-charcoal">{project.clientName}</h1>
        <p className="mt-1 text-sm text-me-charcoal/70">{goalLine(project)}</p>
        <p className="mt-3 text-base font-semibold text-me-charcoal">
          现在在{project.current.label}，{project.current.stateLabel}。
        </p>
        <p className="mt-1 max-w-[65ch] text-sm leading-6 text-me-charcoal/80">
          {project.waiting
            ? `等这一下：${project.waiting.card}。谁来点：${project.waiting.who}。`
            : '先不用点。'}
        </p>
        {project.numbers.length > 0 ? (
          <p className="mt-2 text-sm text-me-charcoal">
            {project.numbers.map((item) => `${item.label} ${item.value}`).join(' · ')}
          </p>
        ) : null}
        {project.numbersNote ? <p className="mt-1 text-sm text-me-charcoal/60">{project.numbersNote}</p> : null}
      </header>
      {project.prescriptionId ? (
        <ChainProgress clientId={project.clientId} prescriptionId={project.prescriptionId} />
      ) : (
        <p className="mt-4 text-sm text-me-charcoal/60">还没有处方，九个点还没开始。</p>
      )}
      <ol className="mt-8 space-y-4">
        {project.stages.map((stage) => (
          <Stage key={stage.id} stage={stage} project={project} />
        ))}
      </ol>
    </div>
  )
}

function Stage({ stage, project }: { stage: ProjectStageView; project: ProjectView }) {
  const tone = STAGE_TONE[stage.state]
  return (
    <li className={`rounded-xl border p-4 ${tone}`}>
      <h2 className="text-base font-black">{stage.label} · {stage.stateLabel}</h2>
      {stage.detail ? <p className="mt-1 max-w-[65ch] text-sm leading-6">{stage.detail}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {stage.links.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className="inline-flex min-h-11 items-center rounded-lg border border-current/20 bg-white/80 px-3 text-sm font-semibold text-me-charcoal hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-ochre"
          >
            {link.label}
          </Link>
        ))}
      </div>
      {stage.id === 'prescribe' && project.showConsent && project.prescriptionId ? (
        <InlineConsent clientId={project.clientId} prescriptionId={project.prescriptionId} />
      ) : null}
      {stage.id === 'act' ? <ActCards project={project} /> : null}
    </li>
  )
}

function ActCards({ project }: { project: ProjectView }) {
  const shown = project.goLiveDraftIds.slice(0, 5)
  const rest = project.goLiveDraftIds.length - shown.length
  return (
    <div className="mt-3">
      {project.goLiveUnread ? (
        <p className="text-sm leading-6">开投确认卡这次没读到。到审批页看，不要当成没有。</p>
      ) : null}
      {shown.map((draftId) => (
        <GoLiveCardPanel key={draftId} clientId={project.clientId} draftId={draftId} />
      ))}
      {rest > 0 ? <p className="mt-2 text-sm">还有 {rest} 张开投卡，到审批页看。</p> : null}
      <HeldCards clientId={project.clientId} hideWhenEmpty />
    </div>
  )
}
