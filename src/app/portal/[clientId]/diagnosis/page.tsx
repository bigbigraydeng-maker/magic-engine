import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'

interface Props {
  params: { clientId: string }
}

const DIMENSION_LABELS: Record<string, string> = {
  seo: 'Search (SEO)',
  ai_visibility: 'AI visibility',
  ads: 'Advertising',
  social: 'Social media',
  reputation: 'Reputation',
  competitor: 'Competitive position',
}

const ALL_DIMENSIONS = ['seo', 'ai_visibility', 'social', 'reputation', 'competitor', 'ads']

const SEVERITY_STYLES: Record<string, { band: string; badge: string }> = {
  critical: { band: 'border-l-red-500',   badge: 'bg-red-100 text-red-800' },
  high:     { band: 'border-l-amber-500', badge: 'bg-amber-100 text-amber-800' },
  medium:   { band: 'border-l-yellow-400', badge: 'bg-yellow-100 text-yellow-800' },
  low:      { band: 'border-l-slate-300', badge: 'bg-slate-100 text-slate-700' },
}

function scoreTone(score: number | null) {
  if (score === null) return { text: 'text-slate-400', bg: 'bg-slate-50', border: 'border-slate-200', bar: 'bg-slate-200', label: 'Pending' }
  if (score >= 70)   return { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', bar: 'bg-emerald-500', label: 'Healthy' }
  if (score >= 40)   return { text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   bar: 'bg-amber-500',   label: 'Needs work' }
  return             { text: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200',     bar: 'bg-red-500',     label: 'Priority' }
}

function formatDate(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleDateString('en-NZ', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Pacific/Auckland',
  })
}

export default async function PortalDiagnosisPage({ params }: Props) {
  const { clientId } = params

  const { data: run } = await supabaseAdmin
    .from('diagnostic_runs')
    .select('id, overall_score, dimension_scores, completed_at')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: findings } = run
    ? await supabaseAdmin
        .from('diagnostic_findings')
        .select('dimension, severity, title, description')
        .eq('run_id', run.id)
        .order('severity')
        .limit(20)
    : { data: null }

  if (!run) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
        <p className="text-sm font-bold text-slate-700">Diagnosis not yet available.</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Your first diagnostic will run once your workspace has been set up.
        </p>
      </div>
    )
  }

  const dimensionScores = (run.dimension_scores ?? {}) as Record<string, number | null>
  const overallScore = run.overall_score ?? null

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-slate-950 p-6 text-white sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">Diagnosis</p>
            <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
              Health scorecard
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Six signal areas benchmarked and scored. Each dimension reflects public signals
              collected during the Discovery scan.
            </p>
            {formatDate(run.completed_at) && (
              <p className="mt-3 text-xs font-semibold text-slate-400">
                Last updated: {formatDate(run.completed_at)}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.08] p-5 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Overall</p>
            <p className={`mt-4 text-6xl font-black tabular-nums ${
              overallScore === null ? 'text-slate-400'
              : overallScore >= 70 ? 'text-emerald-300'
              : overallScore >= 40 ? 'text-amber-300'
              : 'text-red-300'
            }`}>
              {overallScore === null ? '-' : Math.round(overallScore)}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 border-b border-slate-200 pb-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Signal areas</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Six dimensions, one picture</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_DIMENSIONS.map(dim => {
            const score = dimensionScores[dim] ?? null
            const tone = scoreTone(score)
            const width = score === null ? 0 : Math.max(4, Math.min(100, Math.round(score)))
            return (
              <div key={dim} className={`rounded-lg border p-4 ${tone.border} ${tone.bg}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      {DIMENSION_LABELS[dim]}
                    </p>
                    <p className={`mt-2 text-3xl font-black tabular-nums ${tone.text}`}>
                      {score === null ? '-' : Math.round(score)}
                    </p>
                  </div>
                  <span className={`rounded-lg bg-white px-2.5 py-1 text-[11px] font-black ${tone.text}`}>
                    {tone.label}
                  </span>
                </div>
                <div className="mt-5 h-2 rounded-lg bg-white/80">
                  <div className={`h-2 rounded-lg ${tone.bar}`} style={{ width: `${width}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {findings && findings.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 border-b border-slate-200 pb-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Findings</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">What the scan uncovered</h2>
          </div>
          <div className="space-y-3">
            {findings.map((finding, index) => {
              const styles = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.low
              return (
                <div
                  key={`${finding.title}-${index}`}
                  className={`rounded-lg border-l-4 border border-slate-200 bg-slate-50 p-4 ${styles.band}`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-black capitalize ${styles.badge}`}>
                      {finding.severity}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      {DIMENSION_LABELS[finding.dimension] ?? finding.dimension}
                    </span>
                  </div>
                  <p className="text-sm font-black text-slate-950">{finding.title}</p>
                  {finding.description && (
                    <p className="mt-1 text-sm leading-6 text-slate-600">{finding.description}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div className="flex gap-3">
        <Link
          href={`/portal/${clientId}/prescription`}
          className="flex h-11 items-center rounded-lg bg-slate-950 px-4 text-sm font-black text-white"
        >
          See the action plan →
        </Link>
        <Link
          href={`/portal/${clientId}`}
          className="flex h-11 items-center rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-950"
        >
          Back to overview
        </Link>
      </div>
    </div>
  )
}
