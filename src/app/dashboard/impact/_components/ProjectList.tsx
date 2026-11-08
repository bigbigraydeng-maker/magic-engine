import Link from 'next/link'
import { ChainProgress } from '@/components/prescription/ChainProgress'
import { goalLine } from '@/lib/project-console/links'
import type { ProjectView } from '@/lib/project-console/types'
import { STAGE_TONE } from './tone'

export function ProjectList({ projects }: { projects: ProjectView[] }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black text-me-charcoal">项目</h1>
          <p className="mt-1 max-w-[65ch] text-sm leading-6 text-me-charcoal/70">
            每个客户这一轮走到哪。点进去接着办。
          </p>
        </div>
        <Link
          href="/dashboard/impact/new"
          className="inline-flex min-h-11 items-center rounded-lg bg-me-charcoal px-4 text-sm font-semibold text-white hover:bg-me-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-ochre"
        >
          开始一个项目
        </Link>
      </div>
      {projects.length === 0 ? <Empty /> : (
        <ul className="space-y-3">
          {projects.map((project) => <Row key={project.clientId} project={project} />)}
        </ul>
      )}
    </div>
  )
}

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-me-charcoal/20 p-8 text-center">
      <p className="text-sm font-semibold text-me-charcoal">还没有客户。</p>
      <p className="mt-1 text-sm text-me-charcoal/70">有客户之后，从这里开始这一轮。</p>
    </div>
  )
}

function Row({ project }: { project: ProjectView }) {
  const tone = STAGE_TONE[project.current.state]
  return (
    <li className="rounded-xl border border-me-charcoal/12 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/dashboard/impact/${encodeURIComponent(project.clientId)}`}
            className="font-display text-lg font-black text-me-charcoal hover:text-me-ochre focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-ochre"
          >
            {project.clientName}
          </Link>
          <p className="mt-1 text-sm text-me-charcoal/70">{goalLine(project)}</p>
        </div>
        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${tone}`}>
          {project.current.label} · {project.current.stateLabel}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-me-charcoal">
        {project.waiting
          ? `等这一下：${project.waiting.card}。谁来点：${project.waiting.who}。`
          : '先不用点。'}
      </p>
      {project.numbers.length > 0 ? (
        <p className="mt-2 text-sm text-me-charcoal/80">
          {project.numbers.map((item) => `${item.label} ${item.value}`).join(' · ')}
        </p>
      ) : null}
      {project.numbersNote ? <p className="mt-1 text-sm text-me-charcoal/60">{project.numbersNote}</p> : null}
      {project.prescriptionId ? (
        <ChainProgress clientId={project.clientId} prescriptionId={project.prescriptionId} />
      ) : (
        <p className="mt-3 text-xs text-gray-500">还没有处方，九个点还没开始。</p>
      )}
    </li>
  )
}
