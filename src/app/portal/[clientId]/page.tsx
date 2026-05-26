import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import type { DiagnosticDimension } from '@/types/diagnostic'

interface Props {
  params: { clientId: string }
}

const DIMENSION_LABELS: Record<DiagnosticDimension, string> = {
  seo: 'Search',
  ai_visibility: 'AI visibility',
  ads: 'Ads',
  social: 'Social',
  reputation: 'Reputation',
  competitor: 'Competitors',
}

const ALL_DIMENSIONS: DiagnosticDimension[] = [
  'seo',
  'ai_visibility',
  'social',
  'reputation',
  'competitor',
  'ads',
]

function scoreTone(score: number | null) {
  if (score === null) {
    return {
      text: 'text-slate-400',
      border: 'border-slate-200',
      bg: 'bg-white',
      bar: 'bg-slate-200',
      label: 'Pending',
    }
  }
  if (score >= 70) {
    return {
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      bg: 'bg-emerald-50',
      bar: 'bg-emerald-500',
      label: 'Healthy',
    }
  }
  if (score >= 40) {
    return {
      text: 'text-amber-700',
      border: 'border-amber-200',
      bg: 'bg-amber-50',
      bar: 'bg-amber-500',
      label: 'Needs work',
    }
  }
  return {
    text: 'text-red-700',
    border: 'border-red-200',
    bg: 'bg-red-50',
    bar: 'bg-red-500',
    label: 'Priority',
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'No completed diagnostic yet'
  return new Date(value).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Pacific/Auckland',
  })
}

function heroScoreColor(score: number | null) {
  if (score === null) return 'text-slate-400'
  if (score >= 70) return 'text-emerald-200'
  if (score >= 40) return 'text-amber-200'
  return 'text-red-200'
}

function MetricCard({ label, value, body }: { label: string; value: string | number; body: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-5 text-4xl font-black tabular-nums text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </div>
  )
}

function DimensionTile({ label, score }: { label: string; score: number | null }) {
  const tone = scoreTone(score)
  const width = score === null ? 0 : Math.max(4, Math.min(100, Math.round(score)))

  return (
    <div className={`rounded-lg border p-4 ${tone.border} ${tone.bg}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
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
}

export default async function PortalOverviewPage({ params }: Props) {
  const { clientId } = params

  const { data: run } = await supabaseAdmin
    .from('diagnostic_runs')
    .select('id, overall_score, dimension_scores, completed_at, status')
    .eq('client_id', clientId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const [{ count: blogCount }, { count: socialCount }] = await Promise.all([
    supabaseAdmin
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'published'),
    supabaseAdmin
      .from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .in('status', ['approved', 'published', 'scheduled']),
  ])

  const dimensionScores = (run?.dimension_scores ?? {}) as Partial<Record<DiagnosticDimension, number | null>>
  const overallScore = run?.overall_score ?? null
  const totalContent = (blogCount ?? 0) + (socialCount ?? 0)

  return (
    <div className="space-y-6">
      <section className="rounded-lg bg-slate-950 p-6 text-white shadow-sm sm:p-8">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
              Client portal
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-5xl">
              Your growth cockpit
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Review the latest diagnostic, see what has shipped, and track the same execution
              loop introduced in your discovery report.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href={`/portal/${clientId}/report`}
                className="flex h-11 items-center rounded-lg bg-white px-4 text-sm font-black text-slate-950"
              >
                View monthly report
              </Link>
              <Link
                href={`/portal/${clientId}/content`}
                className="flex h-11 items-center rounded-lg border border-white/15 px-4 text-sm font-black text-white"
              >
                Browse content
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.08] p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              Overall score
            </p>
            <p className={`mt-4 text-6xl font-black tabular-nums ${heroScoreColor(overallScore)}`}>
              {overallScore === null ? '-' : Math.round(overallScore)}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-300">
              {formatDate(run?.completed_at)}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard
          label="Published articles"
          value={blogCount ?? 0}
          body="Long-form search and AI visibility assets already delivered."
        />
        <MetricCard
          label="Social assets"
          value={socialCount ?? 0}
          body="Approved, scheduled, or published social content in the library."
        />
        <MetricCard
          label="Execution proof"
          value={totalContent}
          body="Visible work shipped through the managed execution system."
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              Performance scores
            </p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Where the business is strong or exposed
            </h2>
          </div>
          {run && (
            <Link
              href={`/portal/${clientId}/report`}
              className="text-sm font-black text-slate-950 underline decoration-slate-300 underline-offset-4"
            >
              Open full report
            </Link>
          )}
        </div>

        {!run ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-sm font-bold text-slate-700">Your first diagnostic is being prepared.</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Once the first run is complete, this page will show the six signal areas and the
              recommended next actions.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ALL_DIMENSIONS.map(dim => (
              <DimensionTile
                key={dim}
                label={DIMENSION_LABELS[dim]}
                score={dimensionScores[dim] ?? null}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
