import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import type { Prescription, PrescriptionContent, PrescriptionPhase } from '@/types/diagnostic'

interface Props {
  params: { clientId: string }
}

const DIMENSION_LABELS: Record<string, string> = {
  seo: 'Search',
  ai_visibility: 'AI visibility',
  ads: 'Advertising',
  social: 'Social media',
  reputation: 'Reputation',
  competitor: 'Competitive position',
}

const FIX_TYPE_LABELS: Record<string, string> = {
  quick_fix:    'Quick win',
  important:    'Important',
  talk_to_us:   'Talk to us',
  monitor:      'Monitor',
}

const EFFORT_COLORS: Record<string, string> = {
  low:    'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  high:   'bg-red-100 text-red-700',
}

function formatDate(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland',
  })
}

function PhaseSection({ phase }: { phase: PrescriptionPhase }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-4">
        <span className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white">
          Phase {phase.phase_number}
        </span>
        <h3 className="text-lg font-black text-slate-950">{phase.name}</h3>
        <span className="ml-auto text-xs font-semibold text-slate-400">
          {phase.duration_weeks} {phase.duration_weeks === 1 ? 'week' : 'weeks'}
        </span>
      </div>
      <div className="space-y-3">
        {phase.actions.map((action, index) => (
          <div key={action.id ?? index} className="rounded-lg border border-slate-100 bg-slate-50 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded px-2 py-0.5 text-[11px] font-black bg-slate-200 text-slate-700 uppercase tracking-wide">
                {FIX_TYPE_LABELS[action.fix_type] ?? action.fix_type}
              </span>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-[0.12em]">
                {DIMENSION_LABELS[action.dimension] ?? action.dimension}
              </span>
              {action.effort && (
                <span className={`ml-auto rounded px-2 py-0.5 text-[11px] font-bold ${EFFORT_COLORS[action.effort] ?? EFFORT_COLORS.medium}`}>
                  {action.effort} effort
                </span>
              )}
            </div>
            <p className="text-sm font-black text-slate-950">{action.title}</p>
            {action.description && (
              <p className="mt-1 text-sm leading-6 text-slate-600">{action.description}</p>
            )}
            {action.measurement_method && (
              <p className="mt-2 text-xs text-slate-400">
                <span className="font-bold">Measured by:</span> {action.measurement_method}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default async function PortalPrescriptionPage({ params }: Props) {
  const { clientId } = params

  const { data: prescription } = await supabaseAdmin
    .from('prescriptions')
    .select('id, status, content, generated_at, approved_at')
    .eq('client_id', clientId)
    .in('status', ['approved', 'draft'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<Pick<Prescription, 'id' | 'status' | 'content' | 'generated_at' | 'approved_at'>>()

  if (!prescription?.content) {
    return (
      <div className="space-y-6">
        <section className="rounded-lg bg-slate-950 p-6 text-white sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">Action plan</p>
          <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
            Your plan is being prepared.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
            After the diagnostic runs, your Magic Engine team will produce a phased action plan
            for each growth area. It will appear here once ready.
          </p>
        </section>
      </div>
    )
  }

  const content = prescription.content as unknown as PrescriptionContent

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-slate-950 p-6 text-white sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">Action plan</p>
              {prescription.status === 'approved' && (
                <span className="rounded-lg bg-emerald-400/20 px-2.5 py-1 text-xs font-bold text-emerald-300">
                  Approved
                </span>
              )}
            </div>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-5xl">
              The prioritised growth playbook.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              {content.summary}
            </p>
            {formatDate(prescription.approved_at ?? prescription.generated_at) && (
              <p className="mt-3 text-xs font-semibold text-slate-400">
                {prescription.approved_at ? 'Approved' : 'Generated'}{' '}
                {formatDate(prescription.approved_at ?? prescription.generated_at)}
              </p>
            )}
          </div>

          {content.kpi_targets && content.kpi_targets.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-white/[0.08] p-4 lg:min-w-[220px]">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                KPI targets
              </p>
              <div className="space-y-2">
                {content.kpi_targets.slice(0, 4).map((kpi, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-300 leading-tight">{kpi.metric}</p>
                    <p className="shrink-0 text-xs font-black text-cyan-200">
                      {kpi.target_value}{kpi.unit ? ` ${kpi.unit}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {content.phases && content.phases.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Execution phases
            </p>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          {content.phases.map(phase => (
            <PhaseSection key={phase.phase_number} phase={phase} />
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Link
          href={`/portal/${clientId}/plan`}
          className="flex h-11 items-center rounded-lg bg-slate-950 px-4 text-sm font-black text-white"
        >
          See execution progress →
        </Link>
        <Link
          href={`/portal/${clientId}/diagnosis`}
          className="flex h-11 items-center rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-950"
        >
          Back to diagnosis
        </Link>
      </div>
    </div>
  )
}
