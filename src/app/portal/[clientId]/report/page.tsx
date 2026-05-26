import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'

interface Props {
  params: { clientId: string }
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-red-200 bg-red-50 text-red-800',
  high: 'border-amber-200 bg-amber-50 text-amber-800',
  medium: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  low: 'border-slate-200 bg-slate-50 text-slate-700',
}

const DIMENSION_LABELS: Record<string, string> = {
  seo: 'Search',
  ai_visibility: 'AI visibility',
  ads: 'Advertising',
  social: 'Social media',
  reputation: 'Reputation',
  competitor: 'Competitive position',
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Date pending'
  return new Date(value).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Pacific/Auckland',
  })
}

function cleanMarkdown(value: string) {
  return value.replace(/[#*`]/g, '').trim()
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mb-5 border-b border-slate-200 pb-5">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-black text-slate-950">{title}</h2>
      {body && <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>}
    </div>
  )
}

export default async function PortalReportPage({ params }: Props) {
  const { clientId } = params

  const { data: run } = await supabaseAdmin
    .from('diagnostic_runs')
    .select('id, overall_score, dimension_scores, completed_at')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: narratives } = run
    ? await supabaseAdmin
        .from('diagnostic_narratives')
        .select('dimension, narrative_md, generated_at')
        .eq('run_id', run.id)
        .order('dimension')
    : { data: null }

  const { data: findings } = run
    ? await supabaseAdmin
        .from('diagnostic_findings')
        .select('dimension, severity, title, description')
        .eq('run_id', run.id)
        .in('severity', ['critical', 'high'])
        .order('severity')
        .limit(10)
    : { data: null }

  if (!run) {
    return (
      <div className="space-y-6">
        <section className="rounded-lg bg-slate-950 p-6 text-white sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
            Monthly report
          </p>
          <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
            Your first report is being prepared.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
            Once the first diagnostic is complete, the client portal will show the report, priority
            actions, and analysis by area here.
          </p>
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-slate-950 p-6 text-white shadow-sm sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
                Monthly report
              </p>
              <span className="rounded-lg bg-white/[0.08] px-3 py-1 text-xs font-bold text-slate-300">
                {formatDate(run.completed_at)}
              </span>
            </div>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-5xl">
              What changed, what matters, what to do next.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              This report turns the latest diagnostic into a focused view of exposure, priority
              actions, and the work your Magic Engine team is moving through the execution loop.
            </p>
          </div>

          {run.overall_score != null && (
            <div className="rounded-lg border border-white/10 bg-white/[0.08] p-5 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                Overall score
              </p>
              <p className="mt-4 text-6xl font-black tabular-nums text-cyan-200">
                {Math.round(run.overall_score)}
              </p>
              <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-300">
                Latest diagnostic
              </p>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {findings && findings.length > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionHeader
                eyebrow="Priority actions"
                title="The items most likely to move the needle"
                body="These are the highest-severity findings from the latest diagnostic, translated into client-readable work priorities."
              />
              <div className="space-y-3">
                {findings.map((finding, index) => (
                  <div
                    key={`${finding.title}-${index}`}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-lg border px-2.5 py-1 text-xs font-black capitalize ${SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.low}`}>
                        {finding.severity}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                        {DIMENSION_LABELS[finding.dimension] ?? finding.dimension}
                      </span>
                    </div>
                    <p className="text-base font-black text-slate-950">{finding.title}</p>
                    {finding.description && (
                      <p className="mt-2 text-sm leading-6 text-slate-600">{finding.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {narratives && narratives.length > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <SectionHeader
                eyebrow="Analysis by area"
                title="How each signal area is performing"
                body="A plain-English readout of the diagnostic narrative your team can use to discuss next steps."
              />
              <div className="grid gap-4">
                {narratives.map(narrative => {
                  const dimension = narrative.dimension ?? 'overall'
                  return (
                    <article key={dimension} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <h3 className="text-sm font-black text-slate-950">
                        {DIMENSION_LABELS[dimension] ?? dimension}
                      </h3>
                      <p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-600">
                        {cleanMarkdown(narrative.narrative_md)}
                      </p>
                    </article>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
              Client promise
            </p>
            <p className="mt-3 text-2xl font-black leading-tight text-emerald-950">
              The report is the proof layer, not the work itself.
            </p>
            <p className="mt-3 text-sm leading-6 text-emerald-900">
              Magic Engine uses this report to keep the conversation grounded in action:
              prioritise, execute, measure, and bring the result back here.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Next views
            </p>
            <div className="mt-4 grid gap-2">
              <Link
                href={`/portal/${clientId}`}
                className="flex h-11 items-center justify-between rounded-lg bg-slate-950 px-3 text-sm font-black text-white"
              >
                Overview
                <span aria-hidden="true">-&gt;</span>
              </Link>
              <Link
                href={`/portal/${clientId}/content`}
                className="flex h-11 items-center justify-between rounded-lg border border-slate-200 px-3 text-sm font-black text-slate-900"
              >
                Content library
                <span aria-hidden="true">-&gt;</span>
              </Link>
            </div>
          </div>
        </aside>
      </div>

      {!narratives?.length && !findings?.length && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-700">Detailed analysis will appear after the next diagnostic run.</p>
        </div>
      )}
    </div>
  )
}
